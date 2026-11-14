import { PaymentProvider } from "@medbuddy/shared";
import type { CallbackResult, CreatePaymentResult, PaymentProviderAdapter } from "./types";

/**
 * 模拟支付：仅本地/联调用，生产环境一律不可用。
 * 支付确认走 POST /api/payments/mock/pay（需登录），回调格式与真实渠道保持一致以便测试幂等。
 */
export const mockPaymentProvider: PaymentProviderAdapter = {
  id: PaymentProvider.MOCK,

  isConfigured() {
    return process.env.NODE_ENV !== "production";
  },

  async createPayment(params): Promise<CreatePaymentResult> {
    return {
      payParams: {
        outTradeNo: params.outTradeNo,
        amountFen: String(params.amountFen),
      },
    };
  },

  async verifyCallback(req: Request): Promise<CallbackResult> {
    if (process.env.NODE_ENV === "production") {
      throw new Error("模拟支付在生产环境不可用");
    }
    const body = (await req.json().catch(() => null)) as {
      outTradeNo?: string;
      transactionId?: string;
      amountFen?: number;
      success?: boolean;
    } | null;

    if (!body?.outTradeNo || typeof body.amountFen !== "number") {
      throw new Error("模拟支付回调参数不完整");
    }
    return {
      outTradeNo: body.outTradeNo,
      transactionId: body.transactionId || `MOCK-${body.outTradeNo}`,
      amountFen: body.amountFen,
      success: body.success !== false,
      raw: body,
    };
  },
};
