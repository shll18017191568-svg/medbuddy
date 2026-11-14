import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReviewStatus, TaskStatus } from "@medbuddy/shared";

/**
 * 合规审核台列表
 * - status=PENDING（默认）：待审核任务（状态机处于 REVIEWING）
 * - status=APPROVED/REJECTED：已审核记录
 */
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? ReviewStatus.PENDING;

  const where =
    status === ReviewStatus.PENDING
      ? { status: TaskStatus.REVIEWING }
      : { reviewStatus: status };

  const tasks = await prisma.task.findMany({
    where,
    include: {
      user: {
        select: {
          phone: true,
          profile: { select: { name: true, hospital: true, department: true, title: true } },
        },
      },
    },
    orderBy: status === ReviewStatus.PENDING ? { updatedAt: "asc" } : { reviewedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ tasks, total: tasks.length });
}
