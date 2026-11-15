import { NextResponse } from "next/server";
import {
  INVITE_REWARD_INVITEE,
  INVITE_REWARD_INVITER,
  REGISTER_CREDIT_BONUS,
} from "@medbuddy/shared";
import { getCurrentUser } from "@/lib/auth";
import { ensureInviteCode } from "@/lib/invite";
import { prisma } from "@/lib/prisma";

/** 我的邀请码与邀请战绩（邀请码首次访问时生成） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const code = await ensureInviteCode(user.id);
  const [invitedCount, earned] = await Promise.all([
    prisma.user.count({ where: { invitedById: user.id } }),
    prisma.creditLedger.aggregate({
      where: { userId: user.id, type: "INVITE" },
      _sum: { amount: true },
    }),
  ]);

  return NextResponse.json({
    code,
    invitedCount,
    inviteEarned: earned._sum.amount ?? 0,
    inviterReward: INVITE_REWARD_INVITER,
    inviteeReward: INVITE_REWARD_INVITEE,
    registerBonus: REGISTER_CREDIT_BONUS,
    inviteLink: `/login?invite=${code}`,
  });
}
