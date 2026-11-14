import { PAYMENT_PROVIDER_LABEL, PaymentProvider } from "@medbuddy/shared";
import { alipayPaymentProvider } from "./alipay";
import { mockPaymentProvider } from "./mock";
import { wechatPaymentProvider } from "./wechat";
import type { PaymentProviderAdapter } from "./types";

const providers: Record<string, PaymentProviderAdapter> = {
  [PaymentProvider.MOCK]: mockPaymentProvider,
  [PaymentProvider.WECHAT]: wechatPaymentProvider,
  [PaymentProvider.ALIPAY]: alipayPaymentProvider,
};

export function getPaymentProvider(id: string): PaymentProviderAdapter | null {
  return providers[id] ?? null;
}

/**
 * 选择支付渠道：未配置商户号/证书时回退模拟支付（fallback=true），
 * 由调用方向用户明确提示「当前为模拟支付，不产生真实扣款」。
 */
export function resolvePaymentProvider(requested?: string | null): {
  adapter: PaymentProviderAdapter;
  fallback: boolean;
} {
  const id = requested || process.env.PAYMENT_PROVIDER || PaymentProvider.MOCK;
  const adapter = providers[id];
  if (adapter?.isConfigured()) return { adapter, fallback: false };
  return { adapter: mockPaymentProvider, fallback: id !== PaymentProvider.MOCK };
}

/** 各渠道配置状态（充值页展示「未配置」并禁用真实渠道按钮） */
export function paymentProviderStatus() {
  return Object.values(providers).map((provider) => ({
    id: provider.id,
    label: PAYMENT_PROVIDER_LABEL[provider.id] ?? provider.id,
    configured: provider.isConfigured(),
  }));
}
