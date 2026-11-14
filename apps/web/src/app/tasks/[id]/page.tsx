"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
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
          {Array.isArray(result.items) && (
            <ul className="mt-3 space-y-2">
              {(result.items as { pmid: string; title: string; journal: string; oa: boolean }[]).map((it) => (
                <li key={it.pmid} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <p className="font-medium">{it.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    PMID: {it.pmid} · {it.journal} · {it.oa ? "OA 免费全文" : "付费"}
                  </p>
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
