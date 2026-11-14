"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AVATAR_JOB_STATUS_LABEL,
  TASK_STATUS_LABEL,
  TASK_TYPE_META,
  TaskMode,
  TaskStatus,
  TaskType,
  canTransition,
} from "@medbuddy/shared";

type Task = {
  id: string;
  type: string;
  mode: string;
  title: string;
  inputJson: string;
  status: TaskStatus;
  creditCost: number;
  resultJson: string | null;
  failReason: string | null;
  createdAt: string;
  startedAt: string | null;
  deliveredAt: string | null;
};

const FLOW: TaskStatus[] = [
  TaskStatus.QUEUED,
  TaskStatus.RUNNING,
  TaskStatus.REVIEWING,
  TaskStatus.DELIVERED,
];

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${id}`);
    if (res.ok) {
      const data = await res.json();
      setTask(data.task);
    } else {
      setError("任务不存在或无权查看");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // 非终态时 3s 轮询直到回传
  const active = task && [TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.REVIEWING].includes(task.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [active, load]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-slate-500">{error}</p>
        <Link href="/tasks" className="mt-4 inline-block text-blue-600 hover:underline">
          返回任务列表
        </Link>
      </main>
    );
  }
  if (!task) {
    return <main className="mx-auto max-w-3xl px-6 py-20 text-center text-slate-400">加载中…</main>;
  }

  const input = JSON.parse(task.inputJson) as { prompt: string };
  const result = task.resultJson ? (JSON.parse(task.resultJson) as Record<string, unknown>) : null;
  const currentIndex = FLOW.indexOf(task.status as TaskStatus);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <Link href="/tasks" className="text-sm text-blue-600 hover:underline">
        ← 返回任务列表
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{task.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {TASK_TYPE_META[task.type as TaskType]?.label ?? task.type} ·{" "}
            {task.mode === TaskMode.PLAN ? "先出方案" : task.mode === TaskMode.ASK ? "仅问答" : "直接执行"} ·{" "}
            {task.creditCost} 积分 · 提交于 {new Date(task.createdAt).toLocaleString("zh-CN")}
          </p>
        </div>
        <span
          className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium ${
            task.status === TaskStatus.DELIVERED
              ? "bg-green-100 text-green-700"
              : task.status === TaskStatus.FAILED
                ? "bg-red-100 text-red-700"
                : "bg-blue-100 text-blue-700"
          }`}
        >
          {TASK_STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>

      {/* 状态时间线 */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center">
          {FLOW.map((s, i) => {
            const done = task.status === TaskStatus.DELIVERED ? i <= currentIndex : i < currentIndex;
            const isCurrent = task.status === s;
            return (
              <div key={s} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                      done || isCurrent ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <p className={`mt-1 text-xs ${isCurrent ? "font-semibold text-blue-600" : "text-slate-500"}`}>
                    {TASK_STATUS_LABEL[s]}
                  </p>
                </div>
                {i < FLOW.length - 1 && (
                  <div className={`mx-2 h-0.5 flex-1 ${done ? "bg-blue-600" : "bg-slate-200"}`} />
                )}
              </div>
            );
          })}
        </div>
        {task.status === TaskStatus.FAILED && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            失败原因：{task.failReason ?? "未知"}（积分将自动退回——退款逻辑 S4 支付卡实现）
          </p>
        )}
      </section>

      {/* 需求描述 */}
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">需求描述</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{input.prompt}</p>
      </section>

      {/* 交付物 */}
      {result && (
        <section className="mt-4 rounded-xl border border-green-200 bg-green-50/50 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-green-700">交付结果</h2>
            <span className="text-xs text-slate-400">
              回传时间：{task.deliveredAt ? new Date(task.deliveredAt).toLocaleString("zh-CN") : "-"}
            </span>
          </div>
          <p className="mt-3 font-medium">{String(result.summary ?? "")}</p>
          {typeof result.image === "string" && result.image.startsWith("data:image") && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.image}
                alt={String(result.chart_label ?? "图表")}
                className="mx-auto max-h-96"
              />
              <a
                href={result.image}
                download={`medbuddy-${String(result.chart_type ?? "chart")}.png`}
                className="mt-2 inline-block text-xs text-blue-600 hover:underline"
              >
                下载 PNG
              </a>
            </div>
          )}
          {typeof result.interpretation === "string" && (
            <div className="mt-3 rounded-lg bg-white p-3">
              <p className="text-xs font-semibold text-slate-600">AI 解读</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                {result.interpretation}
              </p>
            </div>
          )}
          {Array.isArray(result.warnings) && result.warnings.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">
              {(result.warnings as string[]).map((w, i) => (
                <p key={i}>· {w}</p>
              ))}
            </div>
          )}
          {result.kind === "avatar_video" && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-600">
                  {String(result.provider_label ?? "供应商")}
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-600">
                  {String(result.voice_label ?? "")}
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-600">
                  {String(result.aspect_label ?? "")}
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-600">
                  约 {String(result.total_seconds ?? 0)} 秒
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 ${
                    result.job_status === "COMPLETED"
                      ? "bg-green-100 text-green-700"
                      : result.job_status === "FAILED"
                        ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {AVATAR_JOB_STATUS_LABEL[String(result.job_status ?? "")] ??
                    String(result.job_status ?? "")}
                </span>
              </div>

              {typeof result.video_url === "string" && result.video_url.length > 0 ? (
                <video
                  controls
                  src={result.video_url}
                  className="w-full rounded-lg border border-slate-200 bg-black"
                />
              ) : (
                <p className="rounded-md bg-white/70 px-3 py-2 text-xs text-slate-500">
                  成片尚未生成：任务单号 <span className="font-mono">{String(result.job_id ?? "-")}</span>
                  ，可在数字人工作室查看进度
                </p>
              )}

              {typeof result.narration === "string" && result.narration.length > 0 && (
                <details open className="rounded-lg border border-slate-200 bg-white p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                    完整口播稿
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                    {result.narration}
                  </p>
                </details>
              )}

              {Array.isArray(result.shots) && result.shots.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">镜头</th>
                        <th className="px-3 py-2">字幕 / 口播</th>
                        <th className="px-3 py-2">画面提示</th>
                        <th className="px-3 py-2">时长</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        result.shots as {
                          index: number;
                          subtitle: string;
                          visual: string;
                          seconds: number;
                        }[]
                      ).map((s) => (
                        <tr key={s.index} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2 text-slate-500">{s.index}</td>
                          <td className="px-3 py-2 text-slate-700">{s.subtitle}</td>
                          <td className="px-3 py-2 text-slate-500">{s.visual}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-500">{s.seconds}s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {Array.isArray(result.compliance_notes) && result.compliance_notes.length > 0 && (
                <div className="rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-500">
                  <p className="font-semibold text-slate-600">合规提示</p>
                  {(result.compliance_notes as string[]).map((note, i) => (
                    <p key={i} className="mt-1">
                      · {note}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          {result.kind === "avatar_clone" && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-600">
                  {String(result.type_label ?? "克隆")}
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-600">
                  {String(result.provider_label ?? "供应商")}
                </span>
                <span className="rounded-full bg-white px-2.5 py-1 font-mono text-slate-600">
                  单号 {String(result.job_id ?? "-")}
                </span>
                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700">
                  {AVATAR_JOB_STATUS_LABEL[String(result.job_status ?? "")] ??
                    String(result.job_status ?? "")}
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-700">需准备的材料（缺一不可）</p>
                <ul className="mt-1 space-y-1 text-sm text-slate-600">
                  {((result.materials as string[]) ?? []).map((m, i) => (
                    <li key={i}>· {m}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {typeof result.markdown === "string" && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-5">
              <div className="mb-2 flex justify-end">
                <a
                  href={`data:text/markdown;charset=utf-8,${encodeURIComponent(result.markdown)}`}
                  download="medbuddy-review.md"
                  className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  下载 Markdown
                </a>
              </div>
              <div className="text-sm leading-relaxed text-slate-700 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_p]:mt-2 [&_strong]:text-slate-900">
                <ReactMarkdown>{result.markdown}</ReactMarkdown>
              </div>
            </div>
          )}
          {(typeof result.bibtex === "string" || typeof result.ris === "string") && (
            <div className="mt-3 flex gap-2">
              {typeof result.bibtex === "string" && result.bibtex.length > 0 && (
                <a
                  href={`data:application/x-bibtex;charset=utf-8,${encodeURIComponent(result.bibtex)}`}
                  download="references.bib"
                  className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  下载 BibTeX
                </a>
              )}
              {typeof result.ris === "string" && result.ris.length > 0 && (
                <a
                  href={`data:application/x-research-info-systems;charset=utf-8,${encodeURIComponent(result.ris)}`}
                  download="references.ris"
                  className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  下载 RIS
                </a>
              )}
            </div>
          )}
          {typeof result.query === "string" && (
            <p className="mt-2 rounded-md bg-white/70 px-3 py-2 text-xs text-slate-500">
              检索式：<span className="font-mono">{result.query}</span>
            </p>
          )}
          {typeof result.pmid === "string" && (
            <p className="mt-2 text-xs text-slate-500">
              PMID{" "}
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${result.pmid}/`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
              >
                {result.pmid} · 查看原文 ↗
              </a>
            </p>
          )}
          {Array.isArray(result.sections) && (
            <div className="mt-3 space-y-2">
            {(
              result.sections as { key: string; label: string; content: string }[]
            ).map((s) => (
              <div key={s.key} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-700">{s.label}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{s.content}</p>
              </div>
            ))}
            </div>
          )}
          {typeof result.evidence === "string" && result.evidence.length > 0 && (
            <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
              <summary className="cursor-pointer text-xs font-medium text-slate-600">
                查看原文摘要（核对依据）
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-500">
                {result.evidence}
              </p>
            </details>
          )}
          {Array.isArray(result.items) && (
            <ul className="mt-3 space-y-2">
              {(
                result.items as {
                  pmid: string;
                  title: string;
                  authors?: string;
                  journal: string;
                  pubdate?: string;
                  pubtype?: string;
                  oa: boolean;
                  url?: string;
                }[]
              ).map((it) => (
                <li key={it.pmid} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{it.title}</p>
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] ${
                        it.oa ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {it.oa ? "OA 免费" : "付费"}
                    </span>
                  </div>
                  {it.authors && <p className="mt-1 text-xs text-slate-500">{it.authors}</p>}
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="italic">{it.journal}</span>
                    {it.pubdate ? ` · ${it.pubdate}` : ""}
                    {it.pubtype && it.pubtype !== "Not specified" ? ` · ${it.pubtype.split(",")[0]}` : ""}
                  </p>
                  <a
                    href={it.url ?? `https://pubmed.ncbi.nlm.nih.gov/${it.pmid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-blue-600 hover:underline"
                  >
                    PMID {it.pmid} · 查看原文 ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-400">
            AI 辅助生成，仅供参考；重要决策请以原始文献与临床判断为准
          </p>
        </section>
      )}
    </main>
  );
}
