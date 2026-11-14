import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RECHARGE_PACKAGES } from "@medbuddy/shared";

/** 充值包列表 + 当前余额 + 最近充值记录 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const recent = await prisma.rechargeOrder.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return NextResponse.json({
    packages: RECHARGE_PACKAGES,
    balance: user.credits?.balance ?? 0,
    paymentReady: false,
    recent,
  });
}
