"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TASK_STATUS_LABEL, TASK_TYPE_META, TaskStatus, TaskType } from "@medbuddy/shared";

type Task = {
  id: string;
  type: string;
  title: string;
  status: TaskStatus;
  creditCost: number;
  createdAt: string;
};

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "", label: "全部" },
  { key: TaskStatus.QUEUED, label: TASK_STATUS_LABEL[TaskStatus.QUEUED] },
  { key: TaskStatus.RUNNING, label: TASK_STATUS_LABEL[TaskStatus.RUNNING] },
  { key: TaskStatus.REVIEWING, label: TASK_STATUS_LABEL[TaskStatus.REVIEWING] },
  { key: TaskStatus.DELIVERED, label: TASK_STATUS_LABEL[TaskStatus.DELIVERED] },
  { key: TaskStatus.FAILED, label: TASK_STATUS_LABEL[TaskStatus.FAILED] },
];

const STATUS_STYLE: Record<string, string> = {
  [TaskStatus.QUEUED]: "bg-slate-100 text-slate-600",
  [TaskStatus.RUNNING]: "bg-blue-100 text-blue-700",
  [TaskStatus.REVIEWING]: "bg-amber-100 text-amber-700",
  [TaskStatus.DELIVERED]: "bg-green-100 text-green-700",
  [TaskStatus.FAILED]: "bg-red-100 text-red-700",
};

export default function TaskListPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks${status ? `?status=${status}` : ""}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks);
    }
    setLoading(false);
  }, [status]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // 存在进行中的任务时 5s 自动轮询（体验"回传"效果）
  const hasActive = tasks.some((t) =>
    [TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.REVIEWING].includes(t.status),
  );
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的任务</h1>
        <Link
          href="/tasks/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + 新建任务
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              status === t.key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-slate-400">加载中…</p>
        ) : tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
            还没有任务，点击右上角「新建任务」开始
          </div>
        ) : (
          tasks.map((t) => (
            <Link
              key={t.id}
              href={`/tasks/${t.id}`}
              className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{t.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {TASK_TYPE_META[t.type as TaskType]?.label ?? t.type} · {t.creditCost} 积分 ·{" "}
                    {new Date(t.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
                <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[t.status] ?? ""}`}>
                  {TASK_STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
      {hasActive && (
        <p className="mt-4 text-center text-xs text-slate-400">
          任务云端执行中，列表每 5 秒自动刷新，关闭页面不影响执行
        </p>
      )}
    </main>
  );
}
