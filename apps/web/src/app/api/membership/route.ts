import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { memberStatus } from "@/lib/membership";
import { paymentProviderStatus } from "@/lib/payments";
import { MEMBER_PLANS } from "@medbuddy/shared";

/** 会员套餐列表 + 当前会员状态 + 支付渠道 + 最近会员订单 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const providers = paymentProviderStatus();
  const recentOrders = await prisma.membershipOrder.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return NextResponse.json({
    plans: Object.values(MEMBER_PLANS),
    current: memberStatus({
      memberLevel: user.memberLevel,
      memberExpireAt: user.memberExpireAt,
    }),
    balance: user.credits?.balance ?? 0,
    providers,
    paymentReady: providers.some((p) => p.id !== "mock" && p.configured),
    recentOrders,
  });
}
