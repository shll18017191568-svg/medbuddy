import { Prisma } from "@prisma/client";
import {
  MEMBER_PLANS,
  MemberLevel,
  PaymentOrderStatus,
} from "@medbuddy/shared";
import { prisma } from "@/lib/prisma";
import type { SettleInput, SettleOutcome } from "./settle";

export interface MembershipSettleResult {
  outcome: SettleOutcome;
  orderId?: string;
  balance?: number;
  credits?: number;
  memberLevel?: string;
  memberExpireAt?: string;
}

/**
 * 会员订单支付成功开通/续费（回调与模拟支付共用）。
 * 幂等：status=PAID 直接返回 ALREADY_PAID；transactionId 唯一约束兜底并发回调。
 * 开通、赠送积分、GRANT 流水与订单状态更新在同一事务。
 */
export async function settleMembershipPayment(
  input: SettleInput,
): Promise<MembershipSettleResult> {
  const order = await prisma.membershipOrder.findUnique({
    where: { outTradeNo: input.outTradeNo },
  });
  if (!order) return { outcome: "NOT_FOUND" };

  if (order.status === PaymentOrderStatus.PAID) {
    return { outcome: "ALREADY_PAID", orderId: order.id };
  }
  if (order.status === PaymentOrderStatus.REFUNDED) {
    return { outcome: "REFUNDED", orderId: order.id };
  }
  if (order.provider !== input.provider) {
    return { outcome: "PROVIDER_MISMATCH", orderId: order.id };
  }
  if (order.amountFen !== input.amountFen) {
    return { outcome: "AMOUNT_MISMATCH", orderId: order.id };
  }

  const plan = MEMBER_PLANS[order.level as MemberLevel];
  if (!plan || plan.priceMonthly <= 0) {
    return { outcome: "NOT_FOUND", orderId: order.id };
  }

  const reused = await prisma.membershipOrder.findUnique({
    where: { transactionId: input.transactionId },
  });
  if (reused && reused.id !== order.id) {
    return { outcome: "TRANSACTION_REUSED", orderId: order.id };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.membershipOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (fresh.status === PaymentOrderStatus.PAID) return null;

      const user = await tx.user.findUniqueOrThrow({ where: { id: fresh.userId } });
      // 未过期则从原到期时间续期，否则从当前时间起算
      const base =
        user.memberExpireAt && user.memberExpireAt.getTime() > Date.now()
          ? user.memberExpireAt
          : new Date();
      const expireAt = new Date(base.getTime() + fresh.periodDays * 24 * 60 * 60 * 1000);

      await tx.user.update({
        where: { id: user.id },
        data: { memberLevel: fresh.level, memberExpireAt: expireAt },
      });

      const grant = plan.monthlyCredits;
      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId: user.id } });
      const balanceAfter = account.balance + grant;
      await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter, totalEarn: { increment: grant } },
      });
      await tx.creditLedger.create({
        data: {
          userId: user.id,
          type: "GRANT",
          amount: grant,
          balanceAfter,
          note: `${plan.name}开通赠送积分`,
        },
      });
      await tx.membershipOrder.update({
        where: { id: fresh.id },
        data: {
          status: PaymentOrderStatus.PAID,
          paidAt: new Date(),
          transactionId: input.transactionId,
          callbackJson: JSON.stringify(input.raw ?? {}).slice(0, 8000),
        },
      });

      return { balance: balanceAfter, level: fresh.level, expireAt };
    });

    if (!result) return { outcome: "ALREADY_PAID", orderId: order.id };

    return {
      outcome: "PAID",
      orderId: order.id,
      balance: result.balance,
      credits: plan.monthlyCredits,
      memberLevel: result.level,
      memberExpireAt: result.expireAt.toISOString(),
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { outcome: "ALREADY_PAID", orderId: order.id };
    }
    throw err;
  }
}
