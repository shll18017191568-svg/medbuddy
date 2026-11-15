import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runTask } from "@/lib/task-runner";
import { effectiveLevel } from "@/lib/membership";
import {
  TASK_TYPE_META,
  TaskStatus,
  applyMemberDiscount,
} from "@medbuddy/shared";

/**
 * 医生确认 PLAN 方案：扣积分 → 入队 → 正式执行。
 * 仅本人可确认，且任务必须处于「方案待确认」状态。
 */
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
    return NextResponse.json({ error: "当前任务状态不可确认执行" }, { status: 409 });
  }

  const level = effectiveLevel(user.memberLevel, user.memberExpireAt);
  const basePrice = TASK_TYPE_META[task.type as keyof typeof TASK_TYPE_META].price;
  const price = applyMemberDiscount(basePrice, level);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId: user.id } });
      if (account.balance < price) {
        throw new Error("INSUFFICIENT_CREDITS");
      }
      const balanceAfter = account.balance - price;

      const u = await tx.task.update({
        where: { id },
        data: { status: TaskStatus.QUEUED, creditCost: price },
      });
      await tx.creditLedger.create({
        data: {
          userId: user.id,
          taskId: id,
          type: "CONSUME",
          amount: -price,
          balanceAfter,
          note:
            price === basePrice
              ? `任务扣费：${TASK_TYPE_META[task.type as keyof typeof TASK_TYPE_META].label}`
              : `任务扣费：${TASK_TYPE_META[task.type as keyof typeof TASK_TYPE_META].label}（会员价 ${price}/${basePrice}）`,
        },
      });
      await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter },
      });
      return u;
    });

    runTask(id, "execute");
    return NextResponse.json({ ok: true, task: updated });
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_CREDITS") {
      return NextResponse.json(
        { error: `积分不足：执行本任务需 ${price} 分，请签到或邀请好友获取积分` },
        { status: 402 },
      );
    }
    console.error("[tasks/confirm]", err);
    return NextResponse.json({ error: "确认执行失败，请稍后重试" }, { status: 500 });
  }
}
