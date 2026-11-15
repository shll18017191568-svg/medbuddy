"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  findRechargePackage,
  MEMBER_PLANS,
  MemberLevel,
  PAYMENT_ORDER_STATUS_LABEL,
  PAYMENT_PROVIDER_LABEL,
  PaymentOrderStatus,
  PaymentProvider,
} from "@medbuddy/shared";

type OrderKind = "recharge" | "membership";

type AdminOrder = {
  id: string;
  userId: string;
  user: { phone: string; profile: { name: string } | null };
  packageId?: string;
  priceYuan?: number;
  credits?: number;
  level?: string;
  periodDays?: number;
  provider: string;
  outTradeNo: string;
  transactionId: string | null;
  amountFen: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

type ReconciliationBucket = {
  receivedFen: number;
  refundedFen: number;
  netFen: number;
};

type Reconciliation = {
  recharge: ReconciliationBucket;
  membership: ReconciliationBucket;
  total: ReconciliationBucket;
};

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: PaymentOrderStatus.CREATED, label: "已创建" },
  { value: PaymentOrderStatus.PENDING, label: "待支付" },
  { value: PaymentOrderStatus.PAID, label: "已支付" },
  { value: PaymentOrderStatus.FAILED, label: "支付失败" },
  { value: PaymentOrderStatus.REFUNDED, label: "已退款" },
];

function formatMoney(fen: number) {
  return `¥${(fen / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AdminOrdersPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [kind, setKind] = useState<OrderKind>("recharge");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [refunding, setRefunding] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAuthorized(data?.user?.role === "ADMIN"))
      .catch(() => setAuthorized(false));
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ kind, page: String(page) });
    if (status) params.set("status", status);
    try {
      const response = await fetch(`/api/admin/orders?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "订单加载失败");
      setOrders(data.orders);
      setTotal(data.total);
      setReconciliation(data.reconciliation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "订单加载失败");
    } finally {
      setLoading(false);
    }
  }, [kind, page, status]);

  useEffect(() => {
    if (authorized === true) void loadOrders();
  }, [authorized, loadOrders]);

  function switchKind(next: OrderKind) {
    setKind(next);
    setStatus("");
    setPage(1);
  }

  async function refund(order: AdminOrder) {
    const reason = (reasons[order.id] ?? "").trim();
    if (!reason) {
      alert("请填写退款原因");
      return;
    }
    const target = kind === "recharge" ? `扣回 ${order.credits ?? 0} 积分` : "撤销会员等级并扣回赠送积分";
    if (!window.confirm(`确认退款 ${formatMoney(order.amountFen)} 并${target}？此操作不可重复执行。`)) return;

    setRefunding(order.id);
    try {
      const response = await fetch("/api/admin/orders/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, orderId: order.id, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "退款失败");
      setReasons((prev) => {
        const next = { ...prev };
        delete next[order.id];
        return next;
      });
      alert(`退款冲正完成，已扣回 ${data.refundedCredits} 积分`);
      await loadOrders();
    } catch (err) {
      alert(err instanceof Error ? err.message : "退款失败");
    } finally {
      setRefunding("");
    }
  }

  if (authorized === null) {
    return <main className="p-10 text-center text-slate-400">加载中…</main>;
  }
  if (!authorized) {
    return (
      <main className="p-10 text-center">
        <p className="text-slate-500">无权限访问运营后台</p>
        <Link href="/" className="mt-4 inline-block text-blue-600 hover:underline">
          返回工作台
        </Link>
      </main>
    );
  }

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            订单管理 <span className="text-blue-600">与支付对账</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">退款仅支持模拟支付订单，真实渠道请先在商户后台退款</p>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href="/admin" className="text-blue-600 hover:underline">返回运营后台</Link>
          <Link href="/" className="text-slate-500 hover:underline">返回工作台</Link>
        </div>
      </div>

      {reconciliation && (
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "充值累计实收",
              value: reconciliation.recharge.receivedFen,
              detail: `退款 ${formatMoney(reconciliation.recharge.refundedFen)} · 净收入 ${formatMoney(reconciliation.recharge.netFen)}`,
            },
            {
              label: "会员累计实收",
              value: reconciliation.membership.receivedFen,
              detail: `退款 ${formatMoney(reconciliation.membership.refundedFen)} · 净收入 ${formatMoney(reconciliation.membership.netFen)}`,
            },
            {
              label: "累计退款",
              value: reconciliation.total.refundedFen,
              detail: `充值 + 会员，共 ${formatMoney(reconciliation.total.receivedFen)} 实收`,
            },
            {
              label: "净收入",
              value: reconciliation.total.netFen,
              detail: "累计实收扣除已退款金额",
            },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-800">{formatMoney(item.value)}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{item.detail}</p>
            </div>
          ))}
        </section>
      )}

      <section className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {([
            ["recharge", "充值订单"],
            ["membership", "会员订单"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => switchKind(value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                kind === value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </section>

      {error && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <section className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">用户</th>
              <th className="px-4 py-3">商户订单号</th>
              <th className="px-4 py-3">订单内容</th>
              <th className="px-4 py-3">金额</th>
              <th className="px-4 py-3">渠道</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3">退款冲正</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-700">{order.user.profile?.name ?? "未填写姓名"}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{order.user.phone}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-mono text-xs text-slate-600">{order.outTradeNo}</p>
                  {order.transactionId && <p className="mt-1 font-mono text-[11px] text-slate-400">{order.transactionId}</p>}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {kind === "recharge" ? (
                    <>
                      <p>{findRechargePackage(order.packageId ?? "")?.name ?? order.packageId}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{order.credits ?? 0} 积分</p>
                    </>
                  ) : (
                    <>
                      <p>{MEMBER_PLANS[order.level as MemberLevel]?.name ?? order.level}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{order.periodDays ?? 0} 天</p>
                    </>
                  )}
                </td>
                <td className="px-4 py-3 font-medium text-slate-700">{formatMoney(order.amountFen)}</td>
                <td className="px-4 py-3 text-slate-600">{PAYMENT_PROVIDER_LABEL[order.provider] ?? order.provider}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs ${
                    order.status === PaymentOrderStatus.PAID || order.status === "MOCK_PAID"
                      ? "bg-green-100 text-green-700"
                      : order.status === PaymentOrderStatus.REFUNDED
                        ? "bg-slate-100 text-slate-600"
                        : order.status === PaymentOrderStatus.FAILED
                          ? "bg-red-100 text-red-600"
                          : "bg-amber-100 text-amber-700"
                  }`}>
                    {PAYMENT_ORDER_STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs leading-relaxed text-slate-500">
                  <p>创建 {new Date(order.createdAt).toLocaleString("zh-CN")}</p>
                  {order.paidAt && <p className="mt-1">支付 {new Date(order.paidAt).toLocaleString("zh-CN")}</p>}
                </td>
                <td className="px-4 py-3">
                  {order.status === PaymentOrderStatus.PAID ? (
                    order.provider === PaymentProvider.MOCK ? (
                      <div className="w-56 space-y-2">
                        <input
                          value={reasons[order.id] ?? ""}
                          onChange={(event) => setReasons((prev) => ({ ...prev, [order.id]: event.target.value }))}
                          maxLength={200}
                          placeholder="退款原因（必填）"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs outline-none focus:border-blue-500"
                        />
                        <button
                          onClick={() => refund(order)}
                          disabled={refunding === order.id}
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                        >
                          {refunding === order.id ? "处理中…" : "退款并冲正"}
                        </button>
                      </div>
                    ) : (
                      <p className="w-40 text-xs leading-relaxed text-amber-600">请先在支付商户后台退款</p>
                    )
                  ) : (
                    <span className="text-xs text-slate-400">-</span>
                  )}
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                  {loading ? "加载中…" : "暂无订单"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>共 {total} 笔 · 第 {page} / {totalPages} 页</span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || loading}
            className="rounded-lg bg-slate-100 px-3 py-1.5 disabled:opacity-40"
          >
            上一页
          </button>
          <button
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages || loading}
            className="rounded-lg bg-slate-100 px-3 py-1.5 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      </div>
    </main>
  );
}
