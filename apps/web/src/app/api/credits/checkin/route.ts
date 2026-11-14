import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { effectiveLevel } from "@/lib/membership";
import { getMemberPlan } from "@medbuddy/shared";

/** 当前中国时区自然日（YYYY-MM-DD） */
function todayCN(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

/** 连续签到天数：今天已签从今天数，否则从昨天数 */
async function calcStreak(userId: string): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - 60); // 最多回看 60 天，足够
  const records = await prisma.checkIn.findMany({
    where: { userId, date: { gte: since.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) } },
    select: { date: true },
  });
  const dates = new Set(records.map((r) => r.date));

  const cursor = new Date();
  if (!dates.has(todayCN())) cursor.setDate(cursor.getDate() - 1); // 今天没签，从昨天起算
  let streak = 0;
  for (;;) {
    const key = cursor.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    if (!dates.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 签到状态：今日是否已签 + 连续天数 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const [checkedIn, streak] = await Promise.all([
    prisma.checkIn.findUnique({ where: { userId_date: { userId: user.id, date: todayCN() } } }),
    calcStreak(user.id),
  ]);

  const plan = getMemberPlan(effectiveLevel(user.memberLevel, user.memberExpireAt));

  return NextResponse.json({
    checkedIn: !!checkedIn,
    streak,
    reward: plan.dailyCheckinBonus,
    balance: user.credits?.balance ?? 0,
  });
}

/** 每日签到：按会员等级发放积分（唯一约束防重，流水留痕） */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const plan = getMemberPlan(effectiveLevel(user.memberLevel, user.memberExpireAt));
  const reward = plan.dailyCheckinBonus;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 唯一约束兜底防重（并发下也不会重复发分）
      await tx.checkIn.create({ data: { userId: user.id, date: todayCN() } });

      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId: user.id } });
      const balanceAfter = account.balance + reward;
      await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter, totalEarn: { increment: reward } },
      });
      await tx.creditLedger.create({
        data: {
          userId: user.id,
          type: "BONUS",
          amount: reward,
          balanceAfter,
          note: plan.level === "free" ? "每日签到" : `每日签到（${plan.name}）`,
        },
      });
      return balanceAfter;
    });

    const streak = await calcStreak(user.id);
    return NextResponse.json({ ok: true, reward, balance: result, streak });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "今天已经签到过啦，明天再来" }, { status: 409 });
    }
    console.error("[checkin]", err);
    return NextResponse.json({ error: "签到失败，请稍后重试" }, { status: 500 });
  }
}
