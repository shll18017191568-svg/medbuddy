import crypto from "node:crypto";
import { PaymentProvider } from "@medbuddy/shared";
import { missingEnv, normalizePem } from "./keys";
import {
  PaymentNotConfiguredError,
  type CallbackResult,
  type CreatePaymentResult,
  type PaymentProviderAdapter,
} from "./types";

const ENV_NAMES = ["ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY", "ALIPAY_NOTIFY_URL"];
const GATEWAY = "https://openapi.alipay.com/gateway.do";

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/** 支付宝待签名串：剔除 sign/sign_type 后按参数名 ASCII 升序用 & 拼接 */
function signContent(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type" && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function rsa2Sign(params: Record<string, string>, privateKey: string): string {
  return crypto
    .createSign("RSA-SHA256")
    .update(signContent(params), "utf8")
    .sign(privateKey, "base64");
}

function rsa2Verify(params: Record<string, string>, publicKey: string): boolean {
  const signature = params.sign ?? "";
  return crypto
    .createVerify("RSA-SHA256")
    .update(signContent(params), "utf8")
    .verify(publicKey, signature, "base64");
}

/** 支付宝要求 yyyy-MM-dd HH:mm:ss（北京时间） */
function timestamp(): string {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
    .replace("T", " ");
}

/**
 * 支付宝（电脑网站支付 alipay.trade.page.pay，RSA2）。
 * 未配置应用私钥/支付宝公钥时 isConfigured 为 false，路由层回退模拟支付。
 */
export const alipayPaymentProvider: PaymentProviderAdapter = {
  id: PaymentProvider.ALIPAY,

  isConfigured() {
    return missingEnv(ENV_NAMES).length === 0;
  },

  async createPayment(params): Promise<CreatePaymentResult> {
    const missing = missingEnv(ENV_NAMES);
    if (missing.length > 0) throw new PaymentNotConfiguredError("支付宝", missing);

    const bizContent = JSON.stringify({
      out_trade_no: params.outTradeNo,
      total_amount: (params.amountFen / 100).toFixed(2),
      subject: params.subject,
      product_code: "FAST_INSTANT_TRADE_PAY",
    });

    const signed: Record<string, string> = {
      app_id: env("ALIPAY_APP_ID"),
      method: "alipay.trade.page.pay",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: timestamp(),
      version: "1.0",
      notify_url: env("ALIPAY_NOTIFY_URL"),
      biz_content: bizContent,
    };
    const sign = rsa2Sign(signed, normalizePem(env("ALIPAY_PRIVATE_KEY"), "PRIVATE KEY"));

    const query = new URLSearchParams({ ...signed, sign }).toString();
    return { payUrl: `${GATEWAY}?${query}` };
  },

  async verifyCallback(req: Request): Promise<CallbackResult> {
    const missing = missingEnv(ENV_NAMES);
    if (missing.length > 0) throw new PaymentNotConfiguredError("支付宝", missing);

    const text = await req.text();
    const params: Record<string, string> = {};
    new URLSearchParams(text).forEach((value, key) => {
      params[key] = value;
    });

    const verified = rsa2Verify(
      params,
      normalizePem(env("ALIPAY_PUBLIC_KEY"), "PUBLIC KEY"),
    );
    if (!verified) throw new Error("支付宝回调验签失败");

    return {
      outTradeNo: params.out_trade_no ?? "",
      transactionId: params.trade_no ?? "",
      amountFen: Math.round(Number(params.total_amount ?? 0) * 100),
      success: params.trade_status === "TRADE_SUCCESS" || params.trade_status === "TRADE_FINISHED",
      raw: params,
    };
  },
};
