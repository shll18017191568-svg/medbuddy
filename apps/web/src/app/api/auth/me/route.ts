import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

/** 当前登录用户信息（含医生资料与积分），未登录返回 401 */
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
    },
  });
}
