import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { memberStatus } from "@/lib/membership";
import { MEMBER_PLANS } from "@medbuddy/shared";

/** 会员套餐列表 + 当前用户会员状态 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  return NextResponse.json({
    plans: Object.values(MEMBER_PLANS),
    current: memberStatus({
      memberLevel: user.memberLevel,
      memberExpireAt: user.memberExpireAt,
    }),
    balance: user.credits?.balance ?? 0,
    paymentReady: false, // 支付通道未接入，当前为测试开通
  });
}
