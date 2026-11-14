"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  const phoneValid = /^1[3-9]\d{9}$/.test(phone);

  async function sendSms() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "发送失败");
      setDevCode(data.devCode ?? null);
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) clearInterval(timer);
          return c - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/sms/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "登录失败");
      if (data.user?.role === "ADMIN") {
        router.push("/admin");
      } else {
        router.push(data.needsProfile ? "/onboarding" : "/");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-center text-2xl font-bold">
        登录 <span className="text-blue-600">MedBuddy</span>
      </h1>
      <p className="mt-2 text-center text-sm text-slate-500">手机号验证码登录 · 面向医生的工作台</p>

      <div className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label className="text-sm font-medium text-slate-700">手机号</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
            inputMode="numeric"
            placeholder="请输入 11 位手机号"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-slate-700">验证码</label>
          <div className="mt-1 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              placeholder="6 位验证码"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            />
            <button
              onClick={sendSms}
              disabled={!phoneValid || countdown > 0 || loading}
              className="whitespace-nowrap rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
            >
              {countdown > 0 ? `${countdown}s` : "获取验证码"}
            </button>
          </div>
          {devCode && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
              开发模式验证码：<b>{devCode}</b>（生产环境将发送短信）
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={verify}
          disabled={!phoneValid || code.length !== 6 || loading}
          className="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          {loading ? "处理中…" : "登录 / 注册"}
        </button>
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        登录即代表同意
        <Link href="/legal/terms" className="mx-1 text-blue-600 hover:underline">
          《用户协议》
        </Link>
        与
        <Link href="/legal/privacy" className="mx-1 text-blue-600 hover:underline">
          《隐私政策》
        </Link>
      </p>
    </main>
  );
}
