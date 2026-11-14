import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** 运营概览：用户/医生认证/任务/积分消耗 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const [userCount, verifiedCount, pendingCount, taskCount, statusGroups, consumed, pendingReview] =
    await Promise.all([
      prisma.user.count(),
      prisma.doctorProfile.count({ where: { verifyStatus: "APPROVED" } }),
      prisma.doctorProfile.count({ where: { verifyStatus: "PENDING" } }),
      prisma.task.count(),
      prisma.task.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.creditLedger.aggregate({ where: { type: "CONSUME" }, _sum: { amount: true } }),
      prisma.task.count({ where: { status: "reviewing" } }),
    ]);

  const statusMap: Record<string, number> = {};
  for (const g of statusGroups) statusMap[g.status] = g._count._all;

  return NextResponse.json({
    userCount,
    verifiedCount,
    pendingCount,
    taskCount,
    pendingReview,
    statusMap,
    creditsConsumed: Math.abs(consumed._sum.amount ?? 0),
  });
}
