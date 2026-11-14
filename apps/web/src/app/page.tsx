"use client";

import { useEffect, useState } from "react";
import { TaskStatus, TaskMode } from "@medbuddy/shared";

type HealthState =
  | { loading: true }
  | { loading: false; web: string; ai: unknown; detail?: string };

export default function Home() {
  const [health, setHealth] = useState<HealthState>({ loading: true });

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth({ loading: false, ...d }))
      .catch(() =>
        setHealth({ loading: false, web: "ok", ai: "unreachable", detail: "fetch failed" }),
      );
  }, []);

  const aiOk =
    !health.loading &&
    typeof health.ai === "object" &&
    health.ai !== null &&
    (health.ai as { status?: string }).status === "ok";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-10 px-6">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          MedBuddy <span className="text-blue-600">医生智能工作台</span>
        </h1>
        <p className="mt-3 text-slate-500">
          AI 数字人 + Agent 任务执行 · S0 里程碑 M0 联调演示
        </p>
      </header>

      <section className="w-full space-y-4">
        <h2 className="text-lg font-semibold">双服务健康检查</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Web 服务 (Next.js)</p>
            <p className="mt-1 text-2xl font-semibold text-green-600">
              {health.loading ? "…" : "OK"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">AI 服务 (FastAPI)</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                health.loading
                  ? "text-slate-400"
                  : aiOk
                    ? "text-green-600"
                    : "text-red-500"
              }`}
            >
              {health.loading ? "…" : aiOk ? "OK" : "UNREACHABLE"}
            </p>
          </div>
        </div>
        {aiOk && (
          <p className="text-sm text-slate-500">
            AI 服务版本：{(health.ai as { version: string }).version} ·
            环境：{(health.ai as { env: string }).env}
          </p>
        )}
      </section>

      <section className="w-full space-y-4">
        <h2 className="text-lg font-semibold">任务系统契约（packages/shared 联调）</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">
            任务状态机：{Object.values(TaskStatus).length} 个状态 ·{" "}
            {Object.values(TaskMode).length} 种模式
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.values(TaskStatus).map((s) => (
              <span
                key={s}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      <footer className="text-xs text-slate-400">
        开发总纲：docs/DEVELOPMENT-MASTER-PLAN.md · Sprint 0 / M0
      </footer>
    </main>
  );
}
