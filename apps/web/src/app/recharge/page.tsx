"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  PAYMENT_ORDER_STATUS_LABEL,
  PAYMENT_PROVIDER_LABEL,
  RECHARGE_PACKAGES,
  TASK_TYPE_META,
  TaskType,
} from "@medbuddy/shared";

type Order = {
  id: string;
  packageId: string;
  priceYuan: number;
  credits: number;
  provider: string;
  amountFen: number;
  status: string;
  createdAt: string;
};

type ProviderStatus = { id: string; label: string; configured: boolean };

type Resp = {
  packages: typeof RECHARGE_PACKAGES;
  balance: number;
  providers?: ProviderStatus[];
  paymentReady?: boolean;
  recent: Order[];
};

type PendingOrder = {
  id: string;
  outTradeNo: string;
  provider: string;
  amountFen: number;
  credits: number;
  payUrl: string | null;
  message: string;
};

const PRICE_LIST = Object.values(TaskType)
  .filter((t) => !["avatar_chat", "avatar_clone", "content_gen"].includes(t))
  .map((t) => ({ label: TASK_TYPE_META[t].label, price: TASK_TYPE_META[t].price }));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function RechargePage() {
  const [data, setData] = useState<Resp | null>(null);
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    fetch("/api/credits/packages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Resp | null) => {
        setData(d);
        if (d?.providers) {
          const preferred =
            d.providers.find((p) => p.id !== "mock" && p.configured)?.id ??
            d.providers.find((p) => p.id === "mock" && p.configured)?.id ??
            "mock";
          setProvider((prev) => prev || preferred);
        }
      })
      .catch(() => setData(null));

  useEffect(() => {
    load();
  }, []);

  async function createOrder(packageId: string) {
    setBusy(packageId);
    setMessage("");
    setError("");
    setPending(null);
    const res = await fetch("/api/credits/recharge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageId, provider: provider || undefined }),
    });
    const body = (await res.json().catch(() => null)) as
      | {
          error?: string;
          message?: string;
          order?: { id: string; outTradeNo: string; provider: string; amountFen: number; credits: number };
          payUrl?: string | null;
        }
      | null;

    if (res.ok && body?.order) {
      setPending({
        id: body.order.id,
        outTradeNo: body.order.outTradeNo,
        provider: body.order.provider,
        amountFen: body.order.amountFen,
        credits: body.order.credits,
        payUrl: body.payUrl ?? null,
        message: body.message ?? "",
      });
      setMessage(body.message ?? "订单已创建");
    } else {
      setError(body?.error ?? "下单失败，请稍后重试");
    }
    setBusy(null);
  }

  async function pollOrder(orderId: string): Promise<boolean> {
    for (let i = 0; i < 10; i += 1) {
      const res = await fetch(`/api/payments/orders/${orderId}`);
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { order?: { status: string } }
          | null;
        if (body?.order?.status === "PAID") return true;
      }
      await sleep(800);
    }
    return false;
  }

  async function confirmMock() {
    if (!pending) return;
    setPaying(true);
    setMessage("");
    setError("");
    const res = await fetch("/api/payments/mock/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outTradeNo: pending.outTradeNo }),
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setError(body?.error ?? "模拟支付失败");
      setPaying(false);
      return;
    }

    const paid = await pollOrder(pending.id);
    if (paid) {
      setMessage(`支付成功：${pending.credits.toLocaleString()} 积分已到账`);
      setPending(null);
      await load();
    } else {
      setError("支付已提交，但暂未查到到账，请稍后刷新");
    }
    setPaying(false);
  }

  async function checkPaid() {
    if (!pending) return;
    setPaying(true);
    const paid = await pollOrder(pending.id);
    if (paid) {
      setMessage("支付成功，积分已到账");
      setPending(null);
      await load();
    } else {
      setError("尚未收到支付结果，请完成支付后再试");
    }
    setPaying(false);
  }

  const providers: ProviderStatus[] =
    data?.providers ?? [{ id: "mock", label: "模拟支付", configured: true }];

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

      <section className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">支付方式</span>
        {providers.map((item) => {
          const active = provider === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setProvider(item.id)}
              disabled={!item.configured}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                active
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              } disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-50 disabled:text-slate-300`}
            >
              {item.label}
              {!item.configured && <span className="ml-1 text-xs">（未配置）</span>}
            </button>
          );
        })}
      </section>

      {pending && (
        <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-5">
          <h2 className="text-sm font-semibold text-blue-800">待支付订单</h2>
          <p className="mt-1 text-sm text-blue-700">
            订单号 {pending.outTradeNo} · ¥{(pending.amountFen / 100).toFixed(2)} ·{" "}
            {pending.credits.toLocaleString()} 积分
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {pending.payUrl && (
              <a
                href={pending.payUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                打开支付页面
              </a>
            )}
            {pending.provider === "mock" ? (
              <button
                onClick={confirmMock}
                disabled={paying}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {paying ? "支付中…" : "模拟支付"}
              </button>
            ) : (
              <button
                onClick={checkPaid}
                disabled={paying}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {paying ? "查询中…" : "我已完成支付"}
              </button>
            )}
            <button
              onClick={() => setPending(null)}
              className="rounded-lg bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              取消
            </button>
          </div>
          <p className="mt-2 text-xs text-blue-600">{pending.message}</p>
        </section>
      )}

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
                onClick={() => createOrder(pack.id)}
                disabled={busy !== null}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                {busy === pack.id ? "下单中…" : "立即充值"}
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
                <th className="pb-2">渠道</th>
                <th className="pb-2">金额</th>
                <th className="pb-2">积分</th>
                <th className="pb-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((o) => (
                <tr key={o.id} className="border-t border-slate-100 text-slate-600">
                  <td className="py-2">{new Date(o.createdAt).toLocaleString("zh-CN")}</td>
                  <td className="py-2">{PAYMENT_PROVIDER_LABEL[o.provider] ?? o.provider ?? "—"}</td>
                  <td className="py-2">
                    ¥{o.amountFen ? (o.amountFen / 100).toFixed(2) : o.priceYuan}
                  </td>
                  <td className="py-2">{o.credits.toLocaleString()}</td>
                  <td className="py-2 text-xs">
                    {PAYMENT_ORDER_STATUS_LABEL[o.status] ?? o.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">
        {data?.paymentReady
          ? "支付成功后积分自动到账；若未到账，请稍候刷新或联系客服。"
          : "微信/支付宝商户号尚未配置，当前使用模拟支付联调，不产生真实扣款。配置商户号后将自动走真实支付回调。"}
      </p>
    </main>
  );
}
