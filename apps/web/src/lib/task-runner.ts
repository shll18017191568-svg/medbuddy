/**
 * S1 模拟任务执行器：演示"提交→排队→执行→审核→回传"全状态流转。
 * S2 起此函数替换为调用 FastAPI 真实技能；S3 长任务迁 BullMQ 队列
 * （注意：fire-and-forget 在 serverless 环境会被冻结，部署前必须迁移）。
 */
import { prisma } from "@/lib/prisma";
import { TaskStatus, canTransition, TaskType } from "@medbuddy/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** 按任务类型生成模拟交付物（S2 由真实技能替换） */
function mockDeliverable(type: string, title: string) {
  switch (type) {
    case TaskType.LITERATURE_SEARCH:
      return {
        kind: "literature_list",
        summary: `「${title}」检索完成：命中 3 篇高质量文献（模拟数据，S2 接 PubMed/万方真实检索）`,
        items: [
          { pmid: "38123456", title: "铁死亡在肿瘤免疫微环境中的作用", journal: "Cell Death Differ.", oa: true },
          { pmid: "38234567", title: "Ferroptosis and tumor immunity: mechanisms", journal: "Nat Rev Immunol", oa: false },
          { pmid: "38345678", title: "Targeting ferroptosis for cancer therapy", journal: "Signal Transduct Target Ther", oa: true },
        ],
      };
    case TaskType.AVATAR_CHAT:
      return { kind: "chat_reply", summary: "数字人回复（模拟）：基于《中国高尿酸血症指南 2023》，建议…" };
    default:
      return { kind: "generic", summary: `任务「${title}」执行完成（模拟交付物，S2 替换为真实技能产出）` };
  }
}

/** 执行一个任务（异步推进状态机直至回传） */
export function runMockTask(taskId: string) {
  void (async () => {
    try {
      await sleep(1500);
      await transition(taskId, TaskStatus.RUNNING, { startedAt: new Date() });
      await sleep(3000);
      await transition(taskId, TaskStatus.REVIEWING);
      await sleep(1500);
      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      const result = mockDeliverable(task.type, task.title);
      // 审核通过 → 回传交付（总纲：结果定向回传提交医生，S1 以状态+列表展示实现）
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
