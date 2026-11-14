import { Prisma } from "@prisma/client";
import { PaymentOrderStatus } from "@medbuddy/shared";
import { prisma } from "@/lib/prisma";

export type SettleOutcome =
  | "PAID"
  | "ALREADY_PAID"
  | "NOT_FOUND"
  | "AMOUNT_MISMATCH"
  | "PROVIDER_MISMATCH"
  | "TRANSACTION_REUSED"
  | "REFUNDED";

export interface SettleInput {
  provider: string;
  outTradeNo: string;
  transactionId: string;
  amountFen: number;
  raw: unknown;
}

export interface SettleResult {
  outcome: SettleOutcome;
  orderId?: string;
  balance?: number;
  credits?: number;
}

/**
 * 支付成功入账（回调与模拟支付共用）。
 * 幂等保证：status=PAID 直接返回 ALREADY_PAID；transactionId 唯一约束兜底并发重复回调。
 * 入账与积分流水同事务，金额不一致一律拒绝。
 */
export async function settlePayment(input: SettleInput): Promise<SettleResult> {
  const order = await prisma.rechargeOrder.findUnique({
    where: { outTradeNo: input.outTradeNo },
  });
  if (!order) return { outcome: "NOT_FOUND" };

  if (order.status === PaymentOrderStatus.PAID || order.status === "MOCK_PAID") {
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

  const reused = await prisma.rechargeOrder.findUnique({
    where: { transactionId: input.transactionId },
  });
  if (reused && reused.id !== order.id) {
    return { outcome: "TRANSACTION_REUSED", orderId: order.id };
  }

  try {
    const balance = await prisma.$transaction(async (tx) => {
      // 事务内重读，避免两个并发回调同时入账
      const fresh = await tx.rechargeOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (fresh.status === PaymentOrderStatus.PAID) return null;

      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId: fresh.userId } });
      const balanceAfter = account.balance + fresh.credits;

      await tx.rechargeOrder.update({
        where: { id: fresh.id },
        data: {
          status: PaymentOrderStatus.PAID,
          paidAt: new Date(),
          transactionId: input.transactionId,
          callbackJson: JSON.stringify(input.raw ?? {}).slice(0, 8000),
        },
      });
      await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter, totalEarn: { increment: fresh.credits } },
      });
      await tx.creditLedger.create({
        data: {
          userId: fresh.userId,
          type: "RECHARGE",
          amount: fresh.credits,
          balanceAfter,
          note: `充值${fresh.packageId} ¥${fresh.priceYuan}（${fresh.provider}）`,
        },
      });
      return balanceAfter;
    });

    if (balance === null) {
      return { outcome: "ALREADY_PAID", orderId: order.id };
    }
    return {
      outcome: "PAID",
      orderId: order.id,
      balance,
      credits: order.credits,
    };
  } catch (err) {
    // transactionId 唯一约束兜底：并发重复回调只入账一次
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { outcome: "ALREADY_PAID", orderId: order.id };
    }
    throw err;
  }
}
