import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { settlePayment } from "@/lib/payments/settle";
import { settleMembershipPayment } from "@/lib/payments/membership-settle";
import { PaymentOrderStatus, PaymentProvider } from "@medbuddy/shared";

const bodySchema = z.object({ outTradeNo: z.string().min(1) });

/**
 * 开发环境模拟支付确认（仅 mock 订单、仅本人）。
 * 支持积分充值单（MB）与会员订单（MM），走与真实回调相同的入账函数。
 */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "模拟支付仅限开发环境" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "缺少订单号" }, { status: 400 });
  }

  const outTradeNo = parsed.data.outTradeNo;
  const isMembership = outTradeNo.startsWith("MM");

  try {
    if (isMembership) {
      const order = await prisma.membershipOrder.findUnique({ where: { outTradeNo } });
      if (!order || order.userId !== user.id) {
        return NextResponse.json({ error: "订单不存在" }, { status: 404 });
      }
      if (order.provider !== PaymentProvider.MOCK) {
        return NextResponse.json({ error: "该订单不是模拟支付订单" }, { status: 400 });
      }

      const result = await settleMembershipPayment({
        provider: PaymentProvider.MOCK,
        outTradeNo,
        transactionId: `MOCK-${outTradeNo}`,
        amountFen: order.amountFen,
        raw: { source: "dev-confirm", confirmedAt: new Date().toISOString() },
      });
      if (result.outcome !== "PAID" && result.outcome !== "ALREADY_PAID") {
        return NextResponse.json({ error: `入账失败：${result.outcome}` }, { status: 409 });
      }

      return NextResponse.json({
        ok: true,
        kind: "membership",
        status: PaymentOrderStatus.PAID,
        balance: result.balance ?? user.credits?.balance ?? 0,
        memberLevel: result.memberLevel ?? null,
        memberExpireAt: result.memberExpireAt ?? null,
        mock: true,
      });
    }

    const order = await prisma.rechargeOrder.findUnique({ where: { outTradeNo } });
    if (!order || order.userId !== user.id) {
      return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    }
    if (order.provider !== PaymentProvider.MOCK) {
      return NextResponse.json({ error: "该订单不是模拟支付订单" }, { status: 400 });
    }

    const result = await settlePayment({
      provider: PaymentProvider.MOCK,
      outTradeNo,
      transactionId: `MOCK-${outTradeNo}`,
      amountFen: order.amountFen,
      raw: { source: "dev-confirm", confirmedAt: new Date().toISOString() },
    });
    if (result.outcome !== "PAID" && result.outcome !== "ALREADY_PAID") {
      return NextResponse.json({ error: `入账失败：${result.outcome}` }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      kind: "recharge",
      status: PaymentOrderStatus.PAID,
      balance: result.balance ?? user.credits?.balance ?? 0,
      mock: true,
    });
  } catch (err) {
    console.error("[payments/mock/pay]", err);
    return NextResponse.json({ error: "模拟支付失败，请稍后重试" }, { status: 500 });
  }
}
