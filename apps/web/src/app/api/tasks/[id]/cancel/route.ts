import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@medbuddy/shared";

/** 医生取消 PLAN 方案：仅本人、且任务处于方案待确认状态可取消 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.userId !== user.id) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  if (task.status !== TaskStatus.PLAN_READY) {
    return NextResponse.json({ error: "当前任务状态不可取消" }, { status: 409 });
  }

  const updated = await prisma.task.update({
    where: { id },
    data: { status: TaskStatus.FAILED, failReason: "医生取消执行方案" },
  });
  return NextResponse.json({ ok: true, task: updated });
}
