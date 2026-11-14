import type { PaymentProvider } from "@medbuddy/shared";

/** 创建支付时需要的订单信息（金额一律为分） */
export interface PaymentOrderInput {
  outTradeNo: string;
  amountFen: number;
  subject: string;
}

export interface CreatePaymentResult {
  /** 扫码/网页支付跳转地址 */
  payUrl?: string;
  /** 小程序/APP 等客户端支付参数 */
  payParams?: Record<string, string>;
}

/** 回调解析结果（amountFen 用于与订单金额比对，防篡改） */
export interface CallbackResult {
  outTradeNo: string;
  transactionId: string;
  amountFen: number;
  success: boolean;
  /** 回调原文，落库用于对账与审计 */
  raw: unknown;
}

export interface PaymentProviderAdapter {
  id: PaymentProvider;
  /** 商户号/证书/密钥是否齐备；不齐备时路由层回退 mock */
  isConfigured(): boolean;
  createPayment(order: PaymentOrderInput): Promise<CreatePaymentResult>;
  /** 验签并解析回调；验签失败直接抛错 */
  verifyCallback(req: Request): Promise<CallbackResult>;
}

/** 支付通道未配置（缺商户号/证书/密钥） */
export class PaymentNotConfiguredError extends Error {
  constructor(provider: string, missing: string[]) {
    super(`${provider} 支付未配置：缺少 ${missing.join(", ")}`);
    this.name = "PaymentNotConfiguredError";
  }
}
