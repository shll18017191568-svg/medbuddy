import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { paymentProviderStatus } from "@/lib/payments";
import { RECHARGE_PACKAGES } from "@medbuddy/shared";

/** 充值包列表 + 当前余额 + 支付渠道状态 + 最近充值记录 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const recent = await prisma.rechargeOrder.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const providers = paymentProviderStatus();

  return NextResponse.json({
    packages: RECHARGE_PACKAGES,
    balance: user.credits?.balance ?? 0,
    providers,
    // 真实支付渠道是否已配置（未配置时前端明确提示「模拟支付」）
    paymentReady: providers.some((p) => p.id !== "mock" && p.configured),
    recent,
  });
}
