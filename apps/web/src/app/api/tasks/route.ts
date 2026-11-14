import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runMockTask } from "@/lib/task-runner";
import { TASK_TYPE_META, TaskMode, TaskStatus, TaskType } from "@medbuddy/shared";

const bodySchema = z.object({
  type: z.nativeEnum(TaskType),
  mode: z.nativeEnum(TaskMode).default(TaskMode.CRAFT),
  title: z.string().min(2, "标题至少 2 个字符").max(50),
  prompt: z.string().min(1, "请描述任务需求").max(2000),
});

/** 创建任务单：扣积分（事务含流水）→ 入队 → 异步执行 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!user.profile) {
    return NextResponse.json({ error: "请先完善医生资料再提交任务" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }
  const { type, mode, title, prompt } = parsed.data;
  const price = TASK_TYPE_META[type].price;

  try {
    const task = await prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId: user.id } });
      if (account.balance < price) {
        throw new Error("INSUFFICIENT_CREDITS");
      }
      const balanceAfter = account.balance - price;

      const created = await tx.task.create({
        data: {
          userId: user.id,
          type,
          mode,
          title,
          status: TaskStatus.QUEUED, // 显式用枚举值，杜绝与 schema 默认值的大小写漂移
          inputJson: JSON.stringify({ prompt }),
          creditCost: price,
        },
      });
      await tx.creditLedger.create({
        data: {
          userId: user.id,
          taskId: created.id,
          type: "CONSUME",
          amount: -price,
          balanceAfter,
          note: `任务扣费：${TASK_TYPE_META[type].label}`,
        },
      });
      await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter },
      });
      return created;
    });

    // 事务成功后触发模拟执行（S2 替换为真实技能调用）
    runMockTask(task.id);

    return NextResponse.json({ ok: true, task });
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_CREDITS") {
      return NextResponse.json(
        { error: `积分不足：本任务需 ${price} 分，请签到或邀请好友获取积分` },
        { status: 402 },
      );
    }
    console.error("[tasks/create]", err);
    return NextResponse.json({ error: "创建任务失败，请稍后重试" }, { status: 500 });
  }
}

/** 我的任务列表（分页 + 状态筛选） */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = 20;

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where: { userId: user.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.task.count({ where: { userId: user.id, ...(status ? { status } : {}) } }),
  ]);

  return NextResponse.json({ tasks, total, page, pageSize });
}
