/**
 * 任务执行器：按任务类型调用真实技能，推进状态机直至回传。
 * - 文献检索（S2）：调用 AI 服务 PubMed 真实检索；
 * - 其他类型：暂用模拟交付物（后续 Sprint 逐个替换）。
 * 注意：fire-and-forget 在 serverless 环境会被冻结，部署前需迁移到队列（S3 BullMQ）。
 */
import { prisma } from "@/lib/prisma";
import { TaskStatus, canTransition, TaskType } from "@medbuddy/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const AI_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

/** 推进状态机（校验流转合法性） */
async function transition(
  taskId: string,
  to: TaskStatus,
  extra: Record<string, unknown> = {},
) {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  if (!canTransition(task.status as TaskStatus, to)) {
    throw new Error(`非法状态流转: ${task.status} -> ${to}`);
  }
  await prisma.task.update({ where: { id: taskId }, data: { status: to, ...extra } });
}

/** 技能 1：PubMed 文献检索（真实数据） */
async function runLiteratureSearch(prompt: string, title: string) {
  const res = await fetch(`${AI_URL}/api/skills/literature-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: prompt, limit: 10, years: 5 }),
  });
  if (!res.ok) throw new Error(`检索服务返回 ${res.status}`);

  const data = (await res.json()) as {
    error?: string;
    query?: string;
    translated?: boolean;
    count?: number;
    items?: unknown[];
  };
  if (data.error) throw new Error(data.error);

  const count = data.count ?? 0;
  if (count === 0) {
    return {
      kind: "literature_list",
      summary: `「${title}」未检索到符合条件的文献，建议放宽年限或调整关键词`,
      query: data.query ?? prompt,
      total: 0,
      items: [],
    };
  }

  return {
    kind: "literature_list",
    summary: `「${title}」检索完成：命中 ${count} 篇（PubMed 近 5 年实时数据）${
      data.translated ? "，已将您的需求自动转为专业检索式" : ""
    }`,
    query: data.query ?? prompt,
    total: count,
    items: data.items ?? [],
  };
}

/** 其他任务类型的占位交付物（待后续 Sprint 替换为真实技能） */
function mockDeliverable(type: string, title: string) {
  if (type === TaskType.AVATAR_CHAT) {
    return { kind: "chat_reply", summary: "数字人回复（模拟）：基于《中国高尿酸血症指南 2023》，建议…" };
  }
  return { kind: "generic", summary: `任务「${title}」执行完成（模拟交付物，后续 Sprint 替换为真实技能产出）` };
}

/** 执行一个任务（异步推进状态机直至回传） */
export function runTask(taskId: string) {
  void (async () => {
    try {
      await sleep(800);
      await transition(taskId, TaskStatus.RUNNING, { startedAt: new Date() });

      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      const input = JSON.parse(task.inputJson) as { prompt: string };

      const result =
        task.type === TaskType.LITERATURE_SEARCH
          ? await runLiteratureSearch(input.prompt, task.title)
          : (await sleep(1200), mockDeliverable(task.type, task.title));

      // 审核环节：S2 为状态占位，S4 接入 AI 合规预审 + 人工抽审
      await transition(taskId, TaskStatus.REVIEWING);
      await sleep(500);

      // 回传交付（总纲：结果定向回传提交医生）
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.DELIVERED,
          resultJson: JSON.stringify(result),
          deliveredAt: new Date(),
        },
      });
    } catch (err) {
      await prisma.task
        .update({
          where: { id: taskId },
          data: { status: TaskStatus.FAILED, failReason: err instanceof Error ? err.message : String(err) },
        })
        .catch(() => {});
    }
  })();
}
