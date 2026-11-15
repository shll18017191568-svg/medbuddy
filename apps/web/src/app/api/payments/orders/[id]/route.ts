import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** 订单状态查询（充值页/会员中心轮询）：支持充值单与会员单，仅本人可见 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const balance = user.credits?.balance ?? 0;

  const recharge = await prisma.rechargeOrder.findUnique({ where: { id } });
  if (recharge) {
    if (recharge.userId !== user.id) {
      return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    }
    return NextResponse.json({
      kind: "recharge",
      order: {
        id: recharge.id,
        outTradeNo: recharge.outTradeNo,
        packageId: recharge.packageId,
        provider: recharge.provider,
        amountFen: recharge.amountFen,
        credits: recharge.credits,
        status: recharge.status,
        paidAt: recharge.paidAt,
      },
      balance,
    });
  }

  const membership = await prisma.membershipOrder.findUnique({ where: { id } });
  if (!membership || membership.userId !== user.id) {
    return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  }

  return NextResponse.json({
    kind: "membership",
    order: {
      id: membership.id,
      outTradeNo: membership.outTradeNo,
      level: membership.level,
      periodDays: membership.periodDays,
      provider: membership.provider,
      amountFen: membership.amountFen,
      status: membership.status,
      paidAt: membership.paidAt,
    },
    balance,
  });
}
