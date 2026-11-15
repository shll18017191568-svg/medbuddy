import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createOutTradeNo, resolvePaymentProvider } from "@/lib/payments";
import {
  MEMBERSHIP_PERIOD_DAYS,
  MEMBER_PLANS,
  MemberLevel,
  PaymentOrderStatus,
  yuanToFen,
} from "@medbuddy/shared";

const bodySchema = z.object({
  level: z.enum([MemberLevel.PRO, MemberLevel.FLAGSHIP]),
  provider: z.enum(["mock", "wechat", "alipay"]).optional(),
});

/**
 * 创建会员开通/续费订单并获取支付参数。
 * 不再直接生效：支付回调（或开发环境模拟支付）成功后才开通并赠送积分。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请选择专业版或旗舰版" }, { status: 400 });
  }
  const level = parsed.data.level;
  const plan = MEMBER_PLANS[level];

  // 高等级会员未过期时不允许降级购买（避免旗舰版被专业版订单覆盖）
  const rank: Record<string, number> = { free: 0, pro: 1, flagship: 2 };
  const activeLevel =
    user.memberExpireAt && user.memberExpireAt.getTime() > Date.now()
      ? user.memberLevel
      : "free";
  if ((rank[activeLevel] ?? 0) > rank[level]) {
    return NextResponse.json(
      { error: "当前为旗舰版且未过期，无需购买专业版" },
      { status: 400 },
    );
  }

  const { adapter, fallback } = resolvePaymentProvider(parsed.data.provider);
  if (!adapter.isConfigured()) {
    return NextResponse.json(
      { error: "模拟支付仅限开发环境，生产环境请配置支付商户号" },
      { status: 503 },
    );
  }

  const amountFen = yuanToFen(plan.priceMonthly);
  const outTradeNo = createOutTradeNo("MM");

  const order = await prisma.membershipOrder.create({
    data: {
      userId: user.id,
      level,
      periodDays: MEMBERSHIP_PERIOD_DAYS,
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
      subject: `MedBuddy ${plan.name} ${MEMBERSHIP_PERIOD_DAYS}天`,
    });
  } catch (err) {
    await prisma.membershipOrder.update({
      where: { id: order.id },
      data: { status: PaymentOrderStatus.FAILED },
    });
    console.error("[membership/subscribe] createPayment", err);
    return NextResponse.json({ error: "支付下单失败，请稍后重试" }, { status: 502 });
  }

  await prisma.membershipOrder.update({
    where: { id: order.id },
    data: { status: PaymentOrderStatus.PENDING },
  });

  const fallbackHint =
    fallback && parsed.data.provider
      ? `${parsed.data.provider} 支付未配置商户号，已切换为模拟支付（不产生真实扣款）`
      : null;

  return NextResponse.json({
    ok: true,
    kind: "membership",
    order: {
      id: order.id,
      outTradeNo,
      provider: adapter.id,
      amountFen,
      level,
      periodDays: MEMBERSHIP_PERIOD_DAYS,
      status: PaymentOrderStatus.PENDING,
    },
    payUrl: payment.payUrl ?? null,
    payParams: payment.payParams ?? null,
    fallback,
    mock: adapter.id === "mock",
    message:
      fallbackHint ??
      (adapter.id === "mock"
        ? `已创建${plan.name}订单，请点击「模拟支付」完成开通`
        : "订单已创建，请完成支付"),
  });
}
