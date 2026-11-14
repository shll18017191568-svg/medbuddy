"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RECHARGE_PACKAGES, TASK_TYPE_META, TaskType } from "@medbuddy/shared";

type Order = {
  id: string;
  packageId: string;
  priceYuan: number;
  credits: number;
  status: string;
  createdAt: string;
};

type Resp = { packages: typeof RECHARGE_PACKAGES; balance: number; recent: Order[] };

const PRICE_LIST = Object.values(TaskType)
  .filter((t) => !["avatar_chat", "avatar_clone", "content_gen"].includes(t))
  .map((t) => ({ label: TASK_TYPE_META[t].label, price: TASK_TYPE_META[t].price }));

export default function RechargePage() {
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    fetch("/api/credits/packages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null));

  useEffect(() => {
    load();
  }, []);

  async function recharge(packageId: string) {
    setBusy(packageId);
    setMessage("");
    setError("");
    const res = await fetch("/api/credits/recharge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId }),
    });
    const body = (await res.json().catch(() => null)) as
      | { message?: string; error?: string }
      | null;
    if (res.ok) {
      setMessage(body?.message ?? "充值成功");
      await load();
    } else {
      setError(body?.error ?? "充值失败，请稍后重试");
    }
    setBusy(null);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">积分充值</h1>
          <p className="mt-1 text-sm text-slate-500">
            当前余额 <b className="text-blue-600">{data?.balance ?? "—"}</b> 积分
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/membership" className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">
            会员中心
          </Link>
          <Link href="/" className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">
            返回工作台
          </Link>
        </div>
      </header>

      {message && <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">{message}</p>}
      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(data?.packages ?? RECHARGE_PACKAGES).map((pack) => {
          const unit = (pack.priceYuan / pack.credits).toFixed(4);
          return (
            <div key={pack.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{pack.name}</h2>
                {pack.bonusRate > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                    赠 {Math.round(pack.bonusRate * 100)}%
                  </span>
                )}
              </div>
              <p className="mt-2 text-2xl font-bold">¥{pack.priceYuan}</p>
              <p className="mt-1 text-sm text-slate-600">{pack.credits.toLocaleString()} 积分</p>
              <p className="mt-1 text-xs text-slate-400">约 ¥{unit}/积分</p>
              <button
                onClick={() => recharge(pack.id)}
                disabled={busy !== null}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {busy === pack.id ? "处理中…" : "充值（测试）"}
              </button>
            </div>
          );
        })}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">积分能做什么（单次任务标准价）</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {PRICE_LIST.map((item) => (
            <div key={item.label} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-slate-600">{item.label}</span>
              <span className="font-medium text-slate-800">{item.price} 分</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-400">专业版任务 8 折、旗舰版 7 折，实际扣费以提交时为准。</p>
      </section>

      {data && data.recent.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">最近充值</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="pb-2">时间</th>
                <th className="pb-2">金额</th>
                <th className="pb-2">积分</th>
                <th className="pb-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((o) => (
                <tr key={o.id} className="border-t border-slate-100 text-slate-600">
                  <td className="py-2">{new Date(o.createdAt).toLocaleString("zh-CN")}</td>
                  <td className="py-2">¥{o.priceYuan}</td>
                  <td className="py-2">{o.credits.toLocaleString()}</td>
                  <td className="py-2 text-xs">{o.status === "MOCK_PAID" ? "测试支付" : o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">
        支付通道（微信/支付宝）尚未接入，当前为<strong>测试充值</strong>，不产生真实扣款。
        接入后订单状态将由支付回调更新，入账逻辑不变。
      </p>
    </main>
  );
}
