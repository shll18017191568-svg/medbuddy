import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { memberStatus } from "@/lib/membership";

/** 当前登录用户信息（含医生资料、积分与会员状态），未登录返回 401 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  return NextResponse.json({
    user: {
      id: user.id,
      phone: user.phone,
      role: user.role,
      profile: user.profile,
      creditBalance: user.credits?.balance ?? 0,
      membership: memberStatus({
        memberLevel: user.memberLevel,
        memberExpireAt: user.memberExpireAt,
      }),
    },
  });
}
