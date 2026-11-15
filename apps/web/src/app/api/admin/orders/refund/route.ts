import { NextResponse } from "next/server";
import {
  MEMBER_PLANS,
  MemberLevel,
  PaymentOrderStatus,
  PaymentProvider,
} from "@medbuddy/shared";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

class RefundError extends Error {
  constructor(
    message: string,
    readonly status: number = 409,
  ) {
    super(message);
  }
}

function ensureRefundable(order: { status: string; provider: string }) {
  if (order.status === PaymentOrderStatus.REFUNDED) {
    throw new RefundError("订单已退款，请勿重复操作");
  }
  if (order.status !== PaymentOrderStatus.PAID) {
    throw new RefundError("仅已支付订单可退款");
  }
  if (order.provider !== PaymentProvider.MOCK) {
    throw new RefundError("真实支付渠道订单请先在支付商户后台退款，再执行账务冲正");
  }
}

async function refundRecharge(orderId: string, reason: string) {
  const existing = await prisma.rechargeOrder.findUnique({ where: { id: orderId } });
  if (!existing) throw new RefundError("充值订单不存在", 404);
  ensureRefundable(existing);

  return prisma.$transaction(async (tx) => {
    const order = await tx.rechargeOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new RefundError("充值订单不存在", 404);
    ensureRefundable(order);

    const account = await tx.creditAccount.findUnique({ where: { userId: order.userId } });
    if (!account) throw new RefundError("用户积分账户不存在");
    if (account.balance < order.credits) {
      throw new RefundError("用户积分余额不足，积分已消耗，请人工处理");
    }

    const balanceAfter = account.balance - order.credits;
    await tx.rechargeOrder.update({
      where: { id: order.id },
      data: { status: PaymentOrderStatus.REFUNDED },
    });
    await tx.creditAccount.update({
      where: { id: account.id },
      data: { balance: balanceAfter },
    });
    await tx.creditLedger.create({
      data: {
        userId: order.userId,
        type: "REFUND",
        amount: -order.credits,
        balanceAfter,
        note: `充值订单 ${order.outTradeNo} 退款：${reason}`,
      },
    });
    return { balance: balanceAfter, refundedCredits: order.credits };
  });
}

async function refundMembership(orderId: string, reason: string) {
  const existing = await prisma.membershipOrder.findUnique({ where: { id: orderId } });
  if (!existing) throw new RefundError("会员订单不存在", 404);
  ensureRefundable(existing);

  return prisma.$transaction(async (tx) => {
    const order = await tx.membershipOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new RefundError("会员订单不存在", 404);
    ensureRefundable(order);

    const renewed = await tx.membershipOrder.findFirst({
      where: {
        userId: order.userId,
        id: { not: order.id },
        status: PaymentOrderStatus.PAID,
        createdAt: { gt: order.createdAt },
      },
      select: { id: true },
    });
    if (renewed) throw new RefundError("该订单之后已有续费订单，请先处理后续订单");

    const plan = MEMBER_PLANS[order.level as MemberLevel];
    if (!plan || plan.monthlyCredits <= 0) {
      throw new RefundError("订单会员等级无效，请人工处理");
    }
    const account = await tx.creditAccount.findUnique({ where: { userId: order.userId } });
    if (!account) throw new RefundError("用户积分账户不存在");
    if (account.balance < plan.monthlyCredits) {
      throw new RefundError("用户积分余额不足，赠送积分已消耗，请人工处理");
    }

    const balanceAfter = account.balance - plan.monthlyCredits;
    await tx.membershipOrder.update({
      where: { id: order.id },
      data: { status: PaymentOrderStatus.REFUNDED },
    });
    await tx.user.update({
      where: { id: order.userId },
      data: { memberLevel: MemberLevel.FREE, memberExpireAt: null },
    });
    await tx.creditAccount.update({
      where: { id: account.id },
      data: { balance: balanceAfter },
    });
    await tx.creditLedger.create({
      data: {
        userId: order.userId,
        type: "REFUND",
        amount: -plan.monthlyCredits,
        balanceAfter,
        note: `${plan.name}订单 ${order.outTradeNo} 退款：${reason}`,
      },
    });
    return { balance: balanceAfter, refundedCredits: plan.monthlyCredits };
  });
}

/** 运营退款冲正：仅 mock 已支付订单；真实渠道须先在商户后台完成退款 */
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    kind?: string;
    orderId?: string;
    reason?: string;
  };
  const kind = body.kind;
  const orderId = body.orderId?.trim();
  const reason = body.reason?.trim();
  if (kind !== "recharge" && kind !== "membership") {
    return NextResponse.json({ error: "订单类型不正确" }, { status: 400 });
  }
  if (!orderId) return NextResponse.json({ error: "订单编号不能为空" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "退款原因不能为空" }, { status: 400 });
  if (reason.length > 200) {
    return NextResponse.json({ error: "退款原因不能超过 200 字" }, { status: 400 });
  }

  try {
    const result =
      kind === "recharge"
        ? await refundRecharge(orderId, reason)
        : await refundMembership(orderId, reason);
    return NextResponse.json({
      ok: true,
      kind,
      orderId,
      ...result,
      ...(kind === "membership" ? { memberLevel: MemberLevel.FREE } : {}),
    });
  } catch (error) {
    if (error instanceof RefundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
