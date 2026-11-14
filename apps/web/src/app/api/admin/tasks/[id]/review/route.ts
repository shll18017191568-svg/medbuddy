import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReviewStatus, TaskStatus, canTransition } from "@medbuddy/shared";

const bodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  note: z.string().max(500).optional(),
});

/**
 * 人工合规审核
 * - APPROVE：审核通过 → 回传提交医生（REVIEWING → DELIVERED）
 * - REJECT：审核驳回 → 失败并全额退还积分（审核意见同步给医生）
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }
  const { action, note } = parsed.data;

  const { id } = await params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (task.status !== TaskStatus.REVIEWING) {
    return NextResponse.json({ error: "该任务不在待审核状态" }, { status: 409 });
  }
  if (action === "REJECT" && !note?.trim()) {
    return NextResponse.json({ error: "驳回必须填写审核意见，便于医生修改后重提" }, { status: 400 });
  }

  const reviewerName = admin.profile?.name ?? admin.phone;
  const reviewFields = {
    reviewNote: note?.trim() || null,
    reviewedAt: new Date(),
    reviewerId: admin.id,
    reviewerName,
  };

  if (action === "APPROVE") {
    if (!canTransition(TaskStatus.REVIEWING, TaskStatus.DELIVERED)) {
      return NextResponse.json({ error: "状态流转不合法" }, { status: 409 });
    }
    const delivered = await prisma.task.update({
      where: { id },
      data: {
        status: TaskStatus.DELIVERED,
        deliveredAt: new Date(),
        reviewStatus: ReviewStatus.APPROVED,
        ...reviewFields,
      },
    });
    return NextResponse.json({ ok: true, task: delivered });
  }

  // 驳回：医生不应为未交付的服务付费，事务内退款 + 留痕
  const reason = `合规审核未通过：${note?.trim()}`;
  await prisma.$transaction(async (tx) => {
    const failed = await tx.task.update({
      where: { id },
      data: {
        status: TaskStatus.FAILED,
        failReason: reason,
        reviewStatus: ReviewStatus.REJECTED,
        ...reviewFields,
      },
    });
    if (failed.creditCost > 0) {
      const account = await tx.creditAccount.update({
        where: { userId: failed.userId },
        data: { balance: { increment: failed.creditCost } },
      });
      await tx.creditLedger.create({
        data: {
          userId: failed.userId,
          taskId: failed.id,
          type: "REFUND",
          amount: failed.creditCost,
          balanceAfter: account.balance,
          note: "合规审核驳回自动退还",
        },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
