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

/** 技能 2：文献解读（PMID → 结构化拆解，只认原文） */
async function runLiteratureDigest(prompt: string, fallbackTitle: string) {
  const matched = prompt.match(/\b\d{5,9}\b/);
  if (!matched) {
    throw new Error("未找到 PMID：请在需求描述中提供 5-9 位 PMID（如 38453898）");
  }
  const pmid = matched[0];

  const res = await fetch(`${AI_URL}/api/skills/literature-digest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pmid }),
  });
  if (!res.ok) throw new Error(`解读服务返回 ${res.status}`);

  const data = (await res.json()) as {
    error?: string;
    title?: string;
    mode?: string;
    meta?: Record<string, unknown>;
    sections?: { key: string; label: string; content: string }[];
    evidence?: string;
  };
  if (data.error) throw new Error(data.error);

  return {
    kind: "literature_digest",
    summary: `「${data.title ?? fallbackTitle}」解读完成（PMID ${pmid}）`,
    pmid,
    title: data.title ?? fallbackTitle,
    mode: data.mode ?? "structured",
    meta: data.meta ?? {},
    sections: data.sections ?? [],
    evidence: data.evidence ?? "",
  };
}

/** 从需求文本中拆出「说明」与「CSV 数据」 */
function extractTable(prompt: string): { instruction: string; csv: string } | null {
  const parts = prompt.split(/数据[:：]/);
  if (parts.length >= 2) {
    const csv = parts.slice(1).join("数据：").trim();
    return csv ? { instruction: parts[0].trim(), csv } : null;
  }

  const lines = prompt.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length >= 2 && lines[0].includes(",") && lines[1].includes(",")) {
    return { instruction: "", csv: prompt.trim() };
  }
  return null;
}

/** 技能 8：数据分析与可视化（服务端确定性绘图） */
async function runVisualize(prompt: string, title: string) {
  const parsed = extractTable(prompt);
  if (!parsed) {
    throw new Error("未找到数据：请粘贴 CSV（首行为表头），并用「数据：」分隔需求说明与数据");
  }

  const res = await fetch(`${AI_URL}/api/skills/visualize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "inline.csv",
      content_base64: Buffer.from(parsed.csv, "utf-8").toString("base64"),
      instruction: parsed.instruction || title,
    }),
  });
  if (!res.ok) throw new Error(`绘图服务返回 ${res.status}`);

  const data = (await res.json()) as {
    error?: string;
    chart_type?: string;
    chart_label?: string;
    image?: string;
    interpretation?: string;
    rows?: number;
    stats?: Record<string, unknown>;
  };
  if (data.error) throw new Error(data.error);

  return {
    kind: "chart",
    summary: `「${title}」已生成${data.chart_label ?? "图表"}（${data.rows ?? 0} 行数据）`,
    chart_type: data.chart_type,
    chart_label: data.chart_label,
    image: data.image,
    interpretation: data.interpretation,
    stats: data.stats,
  };
}

/** 技能 5：综述写作（真实建库 + 分章生成 + 引用校验） */
async function runReviewDraft(prompt: string, title: string) {
  const res = await fetch(`${AI_URL}/api/skills/review-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: prompt.trim().slice(0, 500),
      max_refs: 30,
      years: 10,
      citation_style: "gb7714",
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string; detail?: unknown }
      | null;
    if (body?.error) throw new Error(body.error);
    if (res.status === 422) throw new Error("综述主题过短或参数不合法，请补充主题后重试");
    throw new Error(`写作服务返回 ${res.status}`);
  }

  const data = (await res.json()) as {
    error?: string;
    title?: string;
    markdown?: string;
    abstract?: string;
    outline?: unknown[];
    references?: unknown[];
    stats?: Record<string, unknown>;
    warnings?: string[];
  };
  if (data.error) throw new Error(data.error);

  const stats = data.stats ?? {};
  return {
    kind: "review_draft",
    summary: `「${data.title ?? title}」综述初稿已生成：${String(stats.word_count ?? 0)} 字，引用 ${
      String(stats.references ?? 0)
    } 篇真实文献`,
    title: data.title ?? title,
    markdown: data.markdown ?? "",
    abstract: data.abstract ?? "",
    outline: data.outline ?? [],
    references: data.references ?? [],
    stats,
    warnings: data.warnings ?? [],
  };
}

/** 技能 3：实验设计（可选核心文献 PMID） */
async function runExperimentDesign(prompt: string, title: string) {
  const matched = prompt.match(/\b\d{5,9}\b/);
  const res = await fetch(`${AI_URL}/api/skills/experiment-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: prompt.trim().slice(0, 500),
      pmid: matched?.[0],
    }),
  });

  const data = (await res.json().catch(() => null)) as {
    error?: string;
    title?: string;
    markdown?: string;
    design?: Record<string, unknown>;
    seed?: { pmid?: string; title?: string } | null;
    stats?: Record<string, unknown>;
    warnings?: string[];
  } | null;

  if (!res.ok || !data) throw new Error(`方案服务返回 ${res.status}`);
  if (data.error) throw new Error(data.error);

  const stats = data.stats ?? {};
  return {
    kind: "experiment_design",
    summary: `「${data.title ?? title}」实验方案已生成：${String(stats.experiments ?? 0)} 个主实验，${String(
      stats.sub_experiments ?? 0,
    )} 个子实验`,
    title: data.title ?? title,
    markdown: data.markdown ?? "",
    design: data.design ?? {},
    seed: data.seed ?? null,
    stats,
    warnings: data.warnings ?? [],
  };
}

/** 技能 4：临床方案设计（PICO + 统计 + 伦理） */
async function runClinicalDesign(prompt: string, title: string) {
  const matched = prompt.match(/\b\d{5,9}\b/);
  const res = await fetch(`${AI_URL}/api/skills/clinical-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: prompt.trim().slice(0, 500),
      pmid: matched?.[0],
    }),
  });

  const data = (await res.json().catch(() => null)) as {
    error?: string;
    title?: string;
    study_type?: string;
    markdown?: string;
    plan?: Record<string, unknown>;
    seed?: { pmid?: string; title?: string } | null;
    stats?: Record<string, unknown>;
    warnings?: string[];
  } | null;

  if (!res.ok || !data) throw new Error(`方案服务返回 ${res.status}`);
  if (data.error) throw new Error(data.error);

  return {
    kind: "clinical_design",
    summary: `「${data.title ?? title}」临床方案已生成（${data.study_type ?? "研究类型待明确"}）`,
    title: data.title ?? title,
    study_type: data.study_type ?? "",
    markdown: data.markdown ?? "",
    plan: data.plan ?? {},
    seed: data.seed ?? null,
    stats: data.stats ?? {},
    warnings: data.warnings ?? [],
  };
}

/** 技能 9：参考文献管理（PMID → 多格式引文 + BibTeX/RIS） */
async function runReferences(prompt: string, title: string) {
  const lower = prompt.toLowerCase();
  const style = ["apa", "ama", "ieee", "nature", "vancouver"].find((s) => lower.includes(s)) ?? "gb7714";

  const res = await fetch(`${AI_URL}/api/skills/references`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: prompt.slice(0, 5000), style }),
  });

  const data = (await res.json().catch(() => null)) as {
    error?: string;
    style_label?: string;
    count?: number;
    markdown?: string;
    text?: string;
    bibtex?: string;
    ris?: string;
    missing?: string[];
    warnings?: string[];
  } | null;

  if (!res.ok || !data) throw new Error(`排版服务返回 ${res.status}`);
  if (data.error) throw new Error(data.error);

  return {
    kind: "references",
    summary: `「${title}」已生成 ${String(data.count ?? 0)} 条 ${data.style_label ?? ""} 格式引文`,
    markdown: data.markdown ?? "",
    text: data.text ?? "",
    bibtex: data.bibtex ?? "",
    ris: data.ris ?? "",
    count: data.count ?? 0,
    missing: data.missing ?? [],
    warnings: data.warnings ?? [],
  };
}

/** S5 内容工厂（科普图文 / 短视频脚本 / 患教卡片，类型由服务端按主题识别） */
async function runContentGen(prompt: string, title: string) {
  const res = await fetch(`${AI_URL}/api/skills/content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: prompt.trim().slice(0, 500) }),
  });

  const data = (await res.json().catch(() => null)) as {
    error?: string;
    title?: string;
    content_type?: string;
    markdown?: string;
    stats?: Record<string, unknown>;
    warnings?: string[];
  } | null;

  if (!res.ok || !data) throw new Error(`内容服务返回 ${res.status}`);
  if (data.error) throw new Error(data.error);

  const stats = data.stats ?? {};
  const label = String(stats.type_label ?? "内容");
  return {
    kind: "content",
    summary: `「${data.title ?? title}」${label}已生成（${String(stats.word_count ?? 0)} 字${
      stats.total_seconds ? `，约 ${String(stats.total_seconds)} 秒` : ""
    }）`,
    title: data.title ?? title,
    content_type: data.content_type ?? "article",
    markdown: data.markdown ?? "",
    stats,
    warnings: data.warnings ?? [],
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
          : task.type === TaskType.LITERATURE_DIGEST
            ? await runLiteratureDigest(input.prompt, task.title)
            : task.type === TaskType.CHART
              ? await runVisualize(input.prompt, task.title)
              : task.type === TaskType.REVIEW_DRAFT
                ? await runReviewDraft(input.prompt, task.title)
                : task.type === TaskType.EXPERIMENT_DESIGN
                  ? await runExperimentDesign(input.prompt, task.title)
                  : task.type === TaskType.CLINICAL_DESIGN
                    ? await runClinicalDesign(input.prompt, task.title)
                    : task.type === TaskType.REFERENCE_FORMAT
                      ? await runReferences(input.prompt, task.title)
                      : task.type === TaskType.CONTENT_GEN
                        ? await runContentGen(input.prompt, task.title)
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
      const reason = err instanceof Error ? err.message : String(err);

      // 失败退还积分：医生不应为未交付的服务付费
      await prisma
        .$transaction(async (tx) => {
          const failed = await tx.task.update({
            where: { id: taskId },
            data: { status: TaskStatus.FAILED, failReason: reason },
          });
          if (failed.creditCost > 0) {
            const account = await tx.creditAccount.update({
              where: { userId: failed.userId },
              data: { balance: { increment: failed.creditCost } },
            });
            await tx.creditLedger.create({
              data: {
                userId: failed.userId,
                taskId,
                type: "REFUND",
                amount: failed.creditCost,
                balanceAfter: account.balance,
                note: "任务失败自动退还",
              },
            });
          }
        })
        .catch(() => {});
    }
  })();
}
