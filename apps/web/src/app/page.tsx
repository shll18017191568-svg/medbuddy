"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TaskStatus } from "@medbuddy/shared";

type Me = {
  user: {
    id: string;
    phone: string;
    role: string;
    profile: { name: string; hospital: string; department: string; title: string; verifyStatus: string } | null;
    creditBalance: number;
  };
};

type HealthState = { loading: boolean; ai?: unknown; detail?: string };

type CheckInState = { checkedIn: boolean; streak: number; reward: number; balance: number };

export default function Home() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [checkin, setCheckin] = useState<CheckInState | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [health, setHealth] = useState<HealthState>({ loading: true });

  const loadCheckin = () =>
    fetch("/api/credits/checkin")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCheckin(d))
      .catch(() => {});

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d))
      .catch(() => setMe(null))
      .finally(() => setAuthLoading(false));

    loadCheckin();

    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth({ loading: false, ai: d.ai, detail: d.detail }))
      .catch(() => setHealth({ loading: false, ai: "unreachable", detail: "fetch failed" }));
  }, []);

  async function doCheckin() {
    const res = await fetch("/api/credits/checkin", { method: "POST" });
    if (res.ok) await loadCheckin();
  }

  const aiOk =
    !health.loading && typeof health.ai === "object" && health.ai !== null &&
    (health.ai as { status?: string }).status === "ok";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          MedBuddy <span className="text-blue-600">医生智能工作台</span>
        </h1>
        <p className="mt-3 text-slate-500">AI 数字人 + Agent 任务执行 · S1 用户认证演示</p>
      </header>

      {/* 登录态卡片 */}
      <section className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {authLoading ? (
          <p className="text-slate-400">加载中…</p>
        ) : me ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-semibold">
                  {me.user.profile?.name ?? "医生"} {me.user.profile && <span className="ml-1 text-sm font-normal text-slate-500">{me.user.profile.title} · {me.user.profile.hospital}</span>}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {me.user.phone} · 积分 <b className="text-blue-600">{me.user.creditBalance}</b>
                  {me.user.profile && (
                    <span className={`ml-3 rounded-full px-2 py-0.5 text-xs ${me.user.profile.verifyStatus === "APPROVED" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {me.user.profile.verifyStatus === "APPROVED" ? "已认证" : "待审核"}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href="/chat"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  数字人对话
                </Link>
                <Link
                  href="/tasks"
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                >
                  任务中心
                </Link>
                {!me.user.profile && (
                  <Link href="/onboarding" className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
                    完善资料
                  </Link>
                )}
                {me.user.role === "ADMIN" && (
                  <Link href="/admin" className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
                    运营后台
                  </Link>
                )}
                <button onClick={logout} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
                  退出
                </button>
              </div>
            </div>
            {/* 每日签到 */}
            {checkin && (
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                <p className="text-sm text-slate-600">
                  每日签到 +{checkin.reward} 积分
                  {checkin.streak > 0 && (
                    <span className="ml-2 text-xs text-amber-600">已连续 {checkin.streak} 天</span>
                  )}
                </p>
                <button
                  onClick={doCheckin}
                  disabled={checkin.checkedIn}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium ${
                    checkin.checkedIn
                      ? "bg-slate-200 text-slate-400"
                      : "bg-amber-500 text-white hover:bg-amber-600"
                  }`}
                >
                  {checkin.checkedIn ? "今日已签到" : "签到"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-slate-500">您还未登录</p>
            <Link href="/login" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              手机号登录
            </Link>
          </div>
        )}
      </section>

      {/* M0 双服务联调面板 */}
      <section className="w-full space-y-4">
        <h2 className="text-lg font-semibold">双服务健康检查</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Web 服务 (Next.js)</p>
            <p className="mt-1 text-2xl font-semibold text-green-600">OK</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">AI 服务 (FastAPI)</p>
            <p className={`mt-1 text-2xl font-semibold ${health.loading ? "text-slate-400" : aiOk ? "text-green-600" : "text-red-500"}`}>
              {health.loading ? "…" : aiOk ? "OK" : "UNREACHABLE"}
            </p>
          </div>
        </div>
      </section>

      <section className="w-full space-y-4">
        <h2 className="text-lg font-semibold">任务系统契约（packages/shared）</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {Object.values(TaskStatus).map((s) => (
              <span key={s} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      <footer className="text-xs text-slate-400">
        开发总纲：docs/DEVELOPMENT-MASTER-PLAN.md · Sprint 1 / 用户认证
      </footer>
    </main>
  );
}
