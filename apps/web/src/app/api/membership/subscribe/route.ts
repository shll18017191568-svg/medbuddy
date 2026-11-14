import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { memberStatus } from "@/lib/membership";
import { MEMBER_PLANS, MemberLevel } from "@medbuddy/shared";

const bodySchema = z.object({
  level: z.enum([MemberLevel.PRO, MemberLevel.FLAGSHIP]),
});

const PERIOD_DAYS = 30;

/**
 * 开通/续费会员（当前为测试开通，未接支付）。
 * 接入微信/支付宝后改为支付回调里调用同一段逻辑。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请选择专业版或旗舰版" }, { status: 400 });
  }
  const level = parsed.data.level;
  const plan = MEMBER_PLANS[level];

  // 未过期则从原到期时间续期，否则从当前时间起算
  const base =
    user.memberExpireAt && user.memberExpireAt.getTime() > Date.now()
      ? user.memberExpireAt
      : new Date();
  const expireAt = new Date(base.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000);

  try {
    const grant = plan.monthlyCredits;
    const balance = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { memberLevel: level, memberExpireAt: expireAt },
      });

      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId: user.id } });
      const balanceAfter = account.balance + grant;
      await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter, totalEarn: { increment: grant } },
      });
      await tx.creditLedger.create({
        data: {
          userId: user.id,
          type: "GRANT",
          amount: grant,
          balanceAfter,
          note: `${plan.name}开通赠送积分`,
        },
      });
      return balanceAfter;
    });

    return NextResponse.json({
      ok: true,
      mock: true,
      message: `已测试开通${plan.name}（${PERIOD_DAYS} 天），赠送 ${grant} 积分`,
      current: memberStatus({ memberLevel: level, memberExpireAt: expireAt }),
      balance,
    });
  } catch (err) {
    console.error("[membership/subscribe]", err);
    return NextResponse.json({ error: "开通失败，请稍后重试" }, { status: 500 });
  }
}
