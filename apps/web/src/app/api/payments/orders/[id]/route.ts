import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** 订单状态查询（充值页轮询到账）：仅本人可见 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const order = await prisma.rechargeOrder.findUnique({ where: { id } });
  if (!order || order.userId !== user.id) {
    return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  }

  return NextResponse.json({
    order: {
      id: order.id,
      outTradeNo: order.outTradeNo,
      packageId: order.packageId,
      provider: order.provider,
      amountFen: order.amountFen,
      credits: order.credits,
      status: order.status,
      paidAt: order.paidAt,
    },
    balance: user.credits?.balance ?? 0,
  });
}
