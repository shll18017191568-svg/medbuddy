"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MemberLevel, type MemberPlan } from "@medbuddy/shared";

type Status = {
  level: string;
  name: string;
  discount: number;
  dailyCheckinBonus: number;
  monthlyCredits: number;
  expireAt: string | null;
  expired: boolean;
};

type Resp = {
  plans: MemberPlan[];
  current: Status;
  balance: number;
  paymentReady: boolean;
};

export default function MembershipPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    fetch("/api/membership")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null));

  useEffect(() => {
    load();
  }, []);

  async function activate(level: MemberLevel) {
    setBusy(level);
    setError("");
    setMessage("");
    const res = await fetch("/api/membership/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level }),
    });
    const body = (await res.json().catch(() => null)) as
      | { message?: string; error?: string }
      | null;
    if (res.ok) {
      setMessage(body?.message ?? "开通成功");
      await load();
    } else {
      setError(body?.error ?? "开通失败，请稍后重试");
    }
    setBusy(null);
  }

  const current = data?.current;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">会员中心</h1>
          <p className="mt-1 text-sm text-slate-500">
            当前：<b className="text-blue-600">{current?.name ?? "—"}</b>
            {current?.expireAt && (
              <span className="ml-2 text-xs text-slate-400">
                到期 {new Date(current.expireAt).toLocaleDateString("zh-CN")}
              </span>
            )}
            {current?.expired && <span className="ml-2 text-xs text-amber-600">已过期，按免费版计费</span>}
            {typeof data?.balance === "number" && (
              <span className="ml-3 text-xs text-slate-500">积分余额 {data.balance}</span>
            )}
          </p>
        </div>
        <Link href="/" className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">
          返回工作台
        </Link>
      </header>

      {message && <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">{message}</p>}
      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        {(data?.plans ?? []).map((plan) => {
          const isCurrent = current?.level === plan.level;
          const canBuy = plan.level !== MemberLevel.FREE;
          return (
            <section
              key={plan.level}
              className={`flex flex-col rounded-xl border bg-white p-5 shadow-sm ${
                isCurrent ? "border-blue-500 ring-1 ring-blue-200" : "border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                {isCurrent && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">当前</span>
                )}
              </div>
              <p className="mt-2 text-2xl font-bold">
                {plan.priceMonthly === 0 ? "免费" : `¥${plan.priceMonthly}`}
                {plan.priceMonthly > 0 && <span className="text-sm font-normal text-slate-400"> /月</span>}
              </p>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm text-slate-600">
                {plan.benefits.map((b) => (
                  <li key={b}>· {b}</li>
                ))}
              </ul>
              {canBuy ? (
                <button
                  onClick={() => activate(plan.level)}
                  disabled={busy !== null}
                  className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
                >
                  {busy === plan.level ? "开通中…" : isCurrent ? "续费 30 天" : "开通（测试）"}
                </button>
              ) : (
                <p className="mt-4 rounded-lg bg-slate-50 px-4 py-2 text-center text-sm text-slate-500">
                  默认等级
                </p>
              )}
            </section>
          );
        })}
      </div>

      <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">
        说明：支付通道（微信/支付宝）尚未接入，当前按钮为<strong>测试开通</strong>，不产生真实扣款；
        开通后立即生效并按等级赠送积分。接入支付后将改为支付成功后回调开通。
      </p>
    </main>
  );
}
