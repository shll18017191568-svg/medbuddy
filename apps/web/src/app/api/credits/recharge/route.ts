import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOutTradeNo, resolvePaymentProvider } from "@/lib/payments";
import { PaymentOrderStatus, yuanToFen, findRechargePackage } from "@medbuddy/shared";

const bodySchema = z.object({
  packageId: z.string().min(1),
  provider: z.enum(["mock", "wechat", "alipay"]).optional(),
});

/**
 * 创建充值订单并获取支付参数。
 * 未配置商户号的真实渠道自动回退模拟支付（fallback=true），明确提示不产生真实扣款。
 * 入账只在支付回调中进行（见 /api/payments/callback/[provider]）。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请选择充值包" }, { status: 400 });
  }

  const pack = findRechargePackage(parsed.data.packageId);
  if (!pack) return NextResponse.json({ error: "充值包不存在" }, { status: 404 });

  const { adapter, fallback } = resolvePaymentProvider(parsed.data.provider);
  if (!adapter.isConfigured()) {
    return NextResponse.json(
      { error: "模拟支付仅限开发环境，生产环境请配置支付商户号" },
      { status: 503 },
    );
  }

  const amountFen = yuanToFen(pack.priceYuan);
  const outTradeNo = createOutTradeNo("MB");

  const order = await prisma.rechargeOrder.create({
    data: {
      userId: user.id,
      packageId: pack.id,
      priceYuan: pack.priceYuan,
      credits: pack.credits,
      provider: adapter.id,
      outTradeNo,
      amountFen,
      status: PaymentOrderStatus.CREATED,
    },
  });

  let payment;
  try {
    payment = await adapter.createPayment({
      outTradeNo,
      amountFen,
      subject: `MedBuddy ${pack.name} ${pack.credits}积分`,
    });
  } catch (err) {
    await prisma.rechargeOrder.update({
      where: { id: order.id },
      data: { status: PaymentOrderStatus.FAILED },
    });
    console.error("[credits/recharge] createPayment", err);
    return NextResponse.json({ error: "支付下单失败，请稍后重试" }, { status: 502 });
  }

  await prisma.rechargeOrder.update({
    where: { id: order.id },
    data: { status: PaymentOrderStatus.PENDING },
  });

  const fallbackHint =
    fallback && parsed.data.provider
      ? `${parsed.data.provider} 支付未配置商户号，已切换为模拟支付（不产生真实扣款）`
      : null;

  return NextResponse.json({
    ok: true,
    order: {
      id: order.id,
      outTradeNo,
      provider: adapter.id,
      amountFen,
      credits: pack.credits,
      status: PaymentOrderStatus.PENDING,
    },
    payUrl: payment.payUrl ?? null,
    payParams: payment.payParams ?? null,
    fallback,
    mock: adapter.id === "mock",
    message: fallbackHint ?? (adapter.id === "mock" ? "已创建模拟支付订单，请点击「模拟支付」完成" : "订单已创建，请完成支付"),
  });
}
