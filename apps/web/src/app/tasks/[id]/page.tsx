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
  reviewStatus: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  createdAt: string;
  startedAt: string | null;
  deliveredAt: string | null;
};

type FollowUpMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 交付后追问会话
  const [messages, setMessages] = useState<FollowUpMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

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

  // 交付后加载追问记录
  useEffect(() => {
    if (task?.status !== TaskStatus.DELIVERED) return;
    fetch(`/api/tasks/${id}/messages`)
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data) => setMessages(data.messages ?? []))
      .catch(() => setMessages([]));
  }, [task?.status, id]);

  async function sendFollowUp() {
    if (!task || !draft.trim() || sending) return;
    const content = draft.trim();
    const temp: FollowUpMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setSending(true);
    setChatError(null);
    setDraft("");
    setMessages((prev) => [...prev, temp]);
    try {
      const res = await fetch(`/api/tasks/${task.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatError(data.error ?? "发送失败，请重试");
        setMessages((prev) => prev.filter((m) => m.id !== temp.id));
        setDraft(content);
        return;
      }
      setMessages((prev) => [...prev.filter((m) => m.id !== temp.id), ...data.messages]);
    } catch {
      setChatError("网络异常，请重试");
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      setDraft(content);
    } finally {
      setSending(false);
    }
  }

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
  const FLOW: TaskStatus[] =
    task.mode === TaskMode.PLAN
      ? [
          TaskStatus.QUEUED,
          TaskStatus.RUNNING,
          TaskStatus.PLAN_READY,
          TaskStatus.REVIEWING,
          TaskStatus.DELIVERED,
        ]
      : [TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.REVIEWING, TaskStatus.DELIVERED];
  const currentIndex = FLOW.indexOf(task.status as TaskStatus);
  const isPlan = result?.kind === "plan";
  const isAnswer = result?.kind === "answer";

  async function confirmPlan() {
    if (!task) return;
    if (!confirm("确认按此方案执行？确认后将扣除积分并开始生成交付物。")) return;
    const res = await fetch(`/api/tasks/${task.id}/confirm`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error ?? "确认失败");
      return;
    }
    setTask(data.task);
    void load();
  }

  async function cancelPlan() {
    if (!task) return;
    if (!confirm("确定取消此方案？取消后任务将结束，可重新提交。")) return;
    const res = await fetch(`/api/tasks/${task.id}/cancel`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error ?? "取消失败");
      return;
    }
    setTask(data.task);
  }

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
        {task.status === TaskStatus.REVIEWING && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            交付物已生成，正在合规审核中；审核通过后自动回传，无需守候
          </p>
        )}
        {task.status === TaskStatus.DELIVERED && task.reviewStatus === "APPROVED" && (
          <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            已通过合规审核{task.reviewerName ? `（审核人 ${task.reviewerName}` : ""}
            {task.reviewedAt ? `，${new Date(task.reviewedAt).toLocaleString("zh-CN")}` : ""}
            {task.reviewerName ? "）" : ""}
          </p>
        )}
        {task.status === TaskStatus.FAILED && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            失败原因：{task.failReason ?? "未知"}（{task.creditCost} 积分已自动退回账户）
          </p>
        )}
      </section>

      {/* 需求描述 */}
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">需求描述</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{input.prompt}</p>
      </section>

      {/* 交付物 */}
      {result && isPlan && (
        <section className="mt-4 rounded-xl border border-blue-200 bg-blue-50/40 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-blue-700">执行预案（确认后开始执行）</h2>
            {task.status === TaskStatus.PLAN_READY && (
              <span className="text-xs text-slate-400">待您确认</span>
            )}
          </div>
          <p className="mt-3 font-medium text-slate-700">{String(result.summary ?? "")}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-slate-600">执行步骤</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                {(result.steps as string[]).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-slate-600">预计交付</p>
                <ul className="mt-1 space-y-1 text-sm text-slate-600">
                  {(result.deliverables as string[]).map((d, i) => (
                    <li key={i}>· {d}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg bg-white p-3 text-xs text-slate-500">
                <p>预计耗时：{String(result.eta ?? "-")}</p>
                <p className="mt-1">确认执行将扣除 {task.creditCost || String(result.cost ?? 0)} 积分</p>
              </div>
            </div>
          </div>
          {Array.isArray(result.risks) && result.risks.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">
              {(result.risks as string[]).map((r, i) => (
                <p key={i}>· {r}</p>
              ))}
            </div>
          )}
          {task.status === TaskStatus.PLAN_READY && (
            <div className="mt-5 flex gap-3">
              <button
                onClick={confirmPlan}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                确认执行（扣 {task.creditCost || String(result.cost ?? 0)} 积分）
              </button>
              <button
                onClick={cancelPlan}
                className="rounded-lg bg-slate-100 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
              >
                取消方案
              </button>
            </div>
          )}
        </section>
      )}

      {/* ASK 问答回答 */}
      {result && isAnswer && (
        <section className="mt-4 rounded-xl border border-sky-200 bg-sky-50/40 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-sky-700">AI 回答</h2>
            <span className="text-xs text-slate-400">
              回传时间：{task.deliveredAt ? new Date(task.deliveredAt).toLocaleString("zh-CN") : "-"}
            </span>
          </div>
          <div className="prose prose-sm mt-3 max-w-none whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {String(result.answer ?? "")}
          </div>
          <p className="mt-4 rounded-lg bg-white p-3 text-xs text-slate-500">
            以上内容由 AI 辅助生成，仅供医学专业人士参考，不构成诊疗建议。
          </p>
        </section>
      )}

      {result && !isPlan && !isAnswer && (
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

      {/* 交付后追问会话 */}
      {task.status === TaskStatus.DELIVERED && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">追问</h2>
            <span className="text-xs text-slate-400">交付后免费追问，本任务最多 20 条</span>
          </div>

          <div className="mt-3 space-y-3">
            {messages.length === 0 && (
              <p className="text-sm text-slate-400">还没有追问，可以就本次交付结果继续提问。</p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-lg p-3 text-sm ${
                  m.role === "user" ? "bg-blue-50 text-slate-700" : "bg-slate-50 text-slate-700"
                }`}
              >
                <p className="text-xs font-semibold text-slate-500">
                  {m.role === "user" ? "我" : "AI 助手"}
                </p>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed">{m.content}</p>
              </div>
            ))}
          </div>

          {chatError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{chatError}</p>
          )}

          <div className="mt-3 flex gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="就本次交付结果继续提问…"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
            <button
              onClick={sendFollowUp}
              disabled={sending || !draft.trim()}
              className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? "发送中…" : "发送"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
