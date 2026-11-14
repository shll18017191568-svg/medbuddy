import crypto from "node:crypto";
import { PaymentProvider } from "@medbuddy/shared";
import { missingEnv, normalizePem } from "./keys";
import {
  PaymentNotConfiguredError,
  type CallbackResult,
  type CreatePaymentResult,
  type PaymentProviderAdapter,
} from "./types";

const ENV_NAMES = [
  "WECHAT_PAY_APPID",
  "WECHAT_PAY_MCHID",
  "WECHAT_PAY_SERIAL_NO",
  "WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_PLATFORM_CERT",
];

const API_BASE = "https://api.mch.weixin.qq.com";
const NATIVE_PATH = "/v3/pay/transactions/native";

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function notifyUrl(): string {
  return (
    env("WECHAT_PAY_NOTIFY_URL") ||
    `${env("PUBLIC_BASE_URL") || "http://localhost:3000"}/api/payments/callback/wechat`
  );
}

/** 微信支付 v3 签名串：method\nurl\ntimestamp\nnonce\nbody\n */
function buildAuthorization(method: string, urlPath: string, body: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(message)
    .sign(normalizePem(env("WECHAT_PAY_PRIVATE_KEY"), "PRIVATE KEY"), "base64");

  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${env("WECHAT_PAY_MCHID")}",` +
    `nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",` +
    `serial_no="${env("WECHAT_PAY_SERIAL_NO")}"`
  );
}

/** 回调 resource 使用 APIv3 密钥 AES-256-GCM 解密 */
function decryptResource(resource: {
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}): string {
  const key = Buffer.from(env("WECHAT_PAY_API_V3_KEY"), "utf8");
  const buf = Buffer.from(resource.ciphertext, "base64");
  const authTag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(resource.nonce, "utf8"));
  decipher.setAuthTag(authTag);
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, "utf8"));
  }
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/**
 * 微信支付（Native 扫码，v3）。
 * 需在 .env 配置商户号/证书/APIv3 密钥；未配置时 isConfigured 为 false，路由层回退模拟支付。
 */
export const wechatPaymentProvider: PaymentProviderAdapter = {
  id: PaymentProvider.WECHAT,

  isConfigured() {
    return missingEnv(ENV_NAMES).length === 0;
  },

  async createPayment(params): Promise<CreatePaymentResult> {
    const missing = missingEnv(ENV_NAMES);
    if (missing.length > 0) throw new PaymentNotConfiguredError("微信支付", missing);

    const body = JSON.stringify({
      appid: env("WECHAT_PAY_APPID"),
      mchid: env("WECHAT_PAY_MCHID"),
      description: params.subject.slice(0, 127),
      out_trade_no: params.outTradeNo,
      notify_url: notifyUrl(),
      amount: { total: params.amountFen, currency: "CNY" },
    });

    const res = await fetch(API_BASE + NATIVE_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: buildAuthorization("POST", NATIVE_PATH, body),
      },
      body,
    });
    const data = (await res.json().catch(() => null)) as
      | { code_url?: string; message?: string }
      | null;

    if (!res.ok || !data?.code_url) {
      throw new Error(`微信下单失败：${data?.message ?? `HTTP ${res.status}`}`);
    }
    return { payUrl: data.code_url };
  },

  async verifyCallback(req: Request): Promise<CallbackResult> {
    const missing = missingEnv(ENV_NAMES);
    if (missing.length > 0) throw new PaymentNotConfiguredError("微信支付", missing);

    const timestamp = req.headers.get("wechatpay-timestamp") ?? "";
    const nonce = req.headers.get("wechatpay-nonce") ?? "";
    const signature = req.headers.get("wechatpay-signature") ?? "";
    const bodyText = await req.text();

    const verified = crypto
      .createVerify("RSA-SHA256")
      .update(`${timestamp}\n${nonce}\n${bodyText}\n`)
      .verify(normalizePem(env("WECHAT_PAY_PLATFORM_CERT"), "PUBLIC KEY"), signature, "base64");
    if (!verified) throw new Error("微信回调验签失败");

    const event = JSON.parse(bodyText) as {
      event_type?: string;
      resource?: { ciphertext: string; nonce: string; associated_data?: string };
    };
    if (!event.resource) throw new Error("微信回调缺少 resource");

    const payload = JSON.parse(decryptResource(event.resource)) as {
      out_trade_no: string;
      transaction_id: string;
      trade_state: string;
      amount?: { total?: number };
    };

    return {
      outTradeNo: payload.out_trade_no,
      transactionId: payload.transaction_id,
      amountFen: payload.amount?.total ?? 0,
      success: event.event_type === "TRANSACTION.SUCCESS" && payload.trade_state === "SUCCESS",
      raw: { event: event.event_type, payload },
    };
  },
};
