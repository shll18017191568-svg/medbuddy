import { NextResponse } from "next/server";
import { PaymentOrderStatus } from "@medbuddy/shared";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type StatusGroup = {
  status: string;
  _sum: { amountFen: number | null };
  _count: { _all: number };
};

function summarize(groups: StatusGroup[]) {
  let receivedFen = 0;
  let refundedFen = 0;
  let netFen = 0;
  for (const group of groups) {
    const amount = group._sum.amountFen ?? 0;
    if (group.status === PaymentOrderStatus.REFUNDED) {
      receivedFen += amount;
      refundedFen += amount;
    } else if (group.status === PaymentOrderStatus.PAID || group.status === "MOCK_PAID") {
      receivedFen += amount;
      netFen += amount;
    }
  }
  return { receivedFen, refundedFen, netFen };
}

/** 订单列表（充值/会员）与全量支付对账概览，金额单位均为分 */
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "recharge";
  if (kind !== "recharge" && kind !== "membership") {
    return NextResponse.json({ error: "订单类型不正确" }, { status: 400 });
  }
  const status = url.searchParams.get("status") ?? "";
  const statuses = new Set([...Object.values(PaymentOrderStatus), "MOCK_PAID"]);
  if (status && !statuses.has(status as PaymentOrderStatus)) {
    return NextResponse.json({ error: "订单状态不正确" }, { status: 400 });
  }
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") ?? "1") || 1));
  const pageSize = 20;
  const where = status ? { status } : {};

  const [rechargeGroups, membershipGroups] = await Promise.all([
    prisma.rechargeOrder.groupBy({
      by: ["status"],
      _sum: { amountFen: true },
      _count: { _all: true },
    }),
    prisma.membershipOrder.groupBy({
      by: ["status"],
      _sum: { amountFen: true },
      _count: { _all: true },
    }),
  ]);
  const recharge = summarize(rechargeGroups);
  const membership = summarize(membershipGroups);
  const reconciliation = {
    recharge,
    membership,
    total: {
      receivedFen: recharge.receivedFen + membership.receivedFen,
      refundedFen: recharge.refundedFen + membership.refundedFen,
      netFen: recharge.netFen + membership.netFen,
    },
  };

  if (kind === "membership") {
    const [orders, total] = await Promise.all([
      prisma.membershipOrder.findMany({
        where,
        include: { user: { select: { phone: true, profile: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      prisma.membershipOrder.count({ where }),
    ]);
    return NextResponse.json({
      kind,
      orders: orders.map((order) => ({
        id: order.id,
        userId: order.userId,
        user: order.user,
        level: order.level,
        periodDays: order.periodDays,
        provider: order.provider,
        outTradeNo: order.outTradeNo,
        transactionId: order.transactionId,
        amountFen: order.amountFen,
        status: order.status,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
      })),
      total,
      page,
      pageSize,
      reconciliation,
    });
  }

  const [orders, total] = await Promise.all([
    prisma.rechargeOrder.findMany({
      where,
      include: { user: { select: { phone: true, profile: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.rechargeOrder.count({ where }),
  ]);
  return NextResponse.json({
    kind,
    orders: orders.map((order) => ({
      id: order.id,
      userId: order.userId,
      user: order.user,
      packageId: order.packageId,
      priceYuan: order.priceYuan,
      credits: order.credits,
      provider: order.provider,
      outTradeNo: order.outTradeNo,
      transactionId: order.transactionId,
      amountFen: order.amountFen,
      status: order.status,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
    })),
    total,
    page,
    pageSize,
    reconciliation,
  });
}
