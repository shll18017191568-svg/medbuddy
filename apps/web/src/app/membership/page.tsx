"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  MEMBERSHIP_PERIOD_DAYS,
  MEMBER_PLANS,
  PAYMENT_ORDER_STATUS_LABEL,
  PAYMENT_PROVIDER_LABEL,
  MemberLevel,
  type MemberPlan,
} from "@medbuddy/shared";

type Status = {
  level: string;
  name: string;
  discount: number;
  dailyCheckinBonus: number;
  monthlyCredits: number;
  expireAt: string | null;
  expired: boolean;
};

type ProviderStatus = { id: string; label: string; configured: boolean };

type MembershipOrder = {
  id: string;
  level: string;
  periodDays: number;
  provider: string;
  amountFen: number;
  status: string;
  createdAt: string;
};

type Resp = {
  plans: MemberPlan[];
  current: Status;
  balance: number;
  providers?: ProviderStatus[];
  paymentReady?: boolean;
  recentOrders?: MembershipOrder[];
};

type PendingOrder = {
  id: string;
  outTradeNo: string;
  provider: string;
  amountFen: number;
  level: MemberLevel;
  periodDays: number;
  payUrl: string | null;
  message: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function MembershipPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    fetch("/api/membership")
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

  async function createOrder(level: MemberLevel) {
    setBusy(level);
    setError("");
    setMessage("");
    setPending(null);
    const res = await fetch("/api/membership/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, provider: provider || undefined }),
    });
    const body = (await res.json().catch(() => null)) as
      | {
          message?: string;
          error?: string;
          order?: {
            id: string;
            outTradeNo: string;
            provider: string;
            amountFen: number;
            level: MemberLevel;
            periodDays: number;
          };
          payUrl?: string | null;
        }
      | null;

    if (res.ok && body?.order) {
      setPending({
        id: body.order.id,
        outTradeNo: body.order.outTradeNo,
        provider: body.order.provider,
        amountFen: body.order.amountFen,
        level: body.order.level,
        periodDays: body.order.periodDays,
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
      setMessage(`支付成功，${MEMBER_PLANS[pending.level].name}已开通`);
      setPending(null);
      await load();
    } else {
      setError("支付已提交，但暂未查到开通结果，请稍后刷新");
    }
    setPaying(false);
  }

  async function checkPaid() {
    if (!pending) return;
    setPaying(true);
    const paid = await pollOrder(pending.id);
    if (paid) {
      setMessage("支付成功，会员已开通");
      setPending(null);
      await load();
    } else {
      setError("尚未收到支付结果，请完成支付后再试");
    }
    setPaying(false);
  }

  const current = data?.current;
  const providers: ProviderStatus[] =
    data?.providers ?? [{ id: "mock", label: "模拟支付", configured: true }];

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
            {MEMBER_PLANS[pending.level].name} {pending.periodDays} 天 · ¥
            {(pending.amountFen / 100).toFixed(2)} · 订单号 {pending.outTradeNo}
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
                  onClick={() => createOrder(plan.level)}
                  disabled={busy !== null}
                  className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
                >
                  {busy === plan.level ? "下单中…" : isCurrent ? `续费 ${MEMBERSHIP_PERIOD_DAYS} 天` : "立即开通"}
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

      {data?.recentOrders && data.recentOrders.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">最近会员订单</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="pb-2">时间</th>
                <th className="pb-2">套餐</th>
                <th className="pb-2">渠道</th>
                <th className="pb-2">金额</th>
                <th className="pb-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {data.recentOrders.map((o) => (
                <tr key={o.id} className="border-t border-slate-100 text-slate-600">
                  <td className="py-2">{new Date(o.createdAt).toLocaleString("zh-CN")}</td>
                  <td className="py-2">
                    {MEMBER_PLANS[o.level as MemberLevel]?.name ?? o.level} {o.periodDays} 天
                  </td>
                  <td className="py-2">{PAYMENT_PROVIDER_LABEL[o.provider] ?? o.provider}</td>
                  <td className="py-2">¥{(o.amountFen / 100).toFixed(2)}</td>
                  <td className="py-2 text-xs">{PAYMENT_ORDER_STATUS_LABEL[o.status] ?? o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">
        {data?.paymentReady
          ? "支付成功后会员自动开通并赠送积分；未过期续费将从原到期时间顺延。"
          : "微信/支付宝商户号尚未配置，当前使用模拟支付联调，不产生真实扣款。支付成功后才会开通会员并赠送积分。"}
      </p>
    </main>
  );
}
