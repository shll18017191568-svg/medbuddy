import { NextResponse } from "next/server";
import { PaymentProvider } from "@medbuddy/shared";
import { getPaymentProvider } from "@/lib/payments";
import { settlePayment } from "@/lib/payments/settle";

/** 按渠道返回约定格式：微信 JSON，支付宝纯文本 success/failure */
function reply(provider: string, ok: boolean, message: string) {
  if (provider === PaymentProvider.WECHAT) {
    return NextResponse.json(
      { code: ok ? "SUCCESS" : "FAIL", message },
      { status: ok ? 200 : 400 },
    );
  }
  return new Response(ok ? "success" : "failure", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * 支付回调：验签 → 金额/渠道校验 → 幂等入账。
 * 重复回调返回成功（各支付平台会持续重推，必须幂等）。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const adapter = getPaymentProvider(provider);
  if (!adapter) return reply(provider, false, "未知支付渠道");
  if (!adapter.isConfigured()) return reply(provider, false, "支付渠道未配置");

  let callback;
  try {
    callback = await adapter.verifyCallback(req);
  } catch (err) {
    console.error(`[payments/callback/${provider}] 验签失败`, err);
    return reply(provider, false, "验签失败");
  }

  if (!callback.success) return reply(provider, false, "支付未成功");

  try {
    const result = await settlePayment({
      provider,
      outTradeNo: callback.outTradeNo,
      transactionId: callback.transactionId,
      amountFen: callback.amountFen,
      raw: callback.raw,
    });
    if (result.outcome === "PAID" || result.outcome === "ALREADY_PAID") {
      return reply(provider, true, "成功");
    }
    console.error(`[payments/callback/${provider}] 入账拒绝`, result.outcome, callback.outTradeNo);
    return reply(provider, false, result.outcome);
  } catch (err) {
    console.error(`[payments/callback/${provider}] 入账失败`, err);
    return reply(provider, false, "入账失败");
  }
}
