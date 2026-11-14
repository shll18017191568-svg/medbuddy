"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TASK_TYPE_META, TaskMode, TaskType } from "@medbuddy/shared";

export default function NewTaskPage() {
  const router = useRouter();
  const [type, setType] = useState<TaskType>(TaskType.LITERATURE_SEARCH);
  const [mode, setMode] = useState<TaskMode>(TaskMode.CRAFT);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setBalance(d.user.creditBalance))
      .catch(() => {});
  }, []);

  const meta = TASK_TYPE_META[type];
  const insufficient = balance !== null && balance < meta.price;

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, mode, title, prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提交失败");
      router.push(`/tasks/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">提交任务</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500">
            余额 <b className="text-blue-600">{balance ?? "…"}</b> 积分
          </span>
          <Link href="/tasks" className="text-blue-600 hover:underline">
            我的任务
          </Link>
        </div>
      </div>

      {/* 任务类型 */}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-slate-700">选择任务类型</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(Object.keys(TASK_TYPE_META) as TaskType[]).map((t) => {
            const m = TASK_TYPE_META[t];
            const active = t === type;
            return (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded-xl border p-4 text-left transition ${
                  active
                    ? "border-blue-600 bg-blue-50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <p className="font-semibold">{m.label}</p>
                <p className="mt-1 text-xs text-slate-500">{m.description}</p>
                <p className="mt-2 text-sm font-medium text-blue-600">{m.price} 积分/次</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* 工作模式 */}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-slate-700">工作模式</h2>
        <div className="mt-3 flex gap-3">
          {(
            [
              [TaskMode.CRAFT, "直接执行", "明确需求，立即开工"],
              [TaskMode.PLAN, "先出方案", "AI 先给执行方案，您确认后开工"],
              [TaskMode.ASK, "仅问答", "只分析不给交付物"],
            ] as const
          ).map(([m, label, desc]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-xl border p-3 text-left transition ${
                mode === m ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"
              }`}
            >
              <p className="text-sm font-semibold">{label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* 表单 */}
      <section className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label className="text-sm font-medium text-slate-700">任务标题</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如：铁死亡在肿瘤免疫中作用的文献调研"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">需求描述</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="用大白话描述您的需求，如：帮我找铁死亡在肿瘤免疫中作用近 3 年的高质量综述，优先 Review，排除 Letter"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          />
        </div>

        {insufficient && (
          <p className="text-sm text-red-600">
            积分不足：本任务需 {meta.price} 分，当前余额 {balance} 分
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={submit}
          disabled={title.trim().length < 2 || prompt.trim().length < 1 || insufficient || loading}
          className="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          {loading ? "提交中…" : `提交任务（扣 ${meta.price} 积分）`}
        </button>
        <p className="text-xs text-slate-400">
          提交后任务云端执行，关闭浏览器不影响；完成后在任务中心查看交付结果
        </p>
      </section>
    </main>
  );
}
