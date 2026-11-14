import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findRechargePackage } from "@medbuddy/shared";

const bodySchema = z.object({ packageId: z.string().min(1) });

/**
 * 充值积分（当前为测试支付，未接支付通道）。
 * 接入微信/支付宝后：创建订单(status=CREATED) → 支付回调验签成功 → 执行此处入账逻辑。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "请选择充值包" }, { status: 400 });
  }

  const pack = findRechargePackage(parsed.data.packageId);
  if (!pack) return NextResponse.json({ error: "充值包不存在" }, { status: 404 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.creditAccount.findUniqueOrThrow({ where: { userId: user.id } });
      const balanceAfter = account.balance + pack.credits;

      const order = await tx.rechargeOrder.create({
        data: {
          userId: user.id,
          packageId: pack.id,
          priceYuan: pack.priceYuan,
          credits: pack.credits,
          status: "MOCK_PAID",
        },
      });
      await tx.creditAccount.update({
        where: { id: account.id },
        data: { balance: balanceAfter, totalEarn: { increment: pack.credits } },
      });
      await tx.creditLedger.create({
        data: {
          userId: user.id,
          type: "RECHARGE",
          amount: pack.credits,
          balanceAfter,
          note: `充值${pack.name} ¥${pack.priceYuan}`,
        },
      });
      return { order, balanceAfter };
    });

    return NextResponse.json({
      ok: true,
      mock: true,
      message: `已测试充值 ${pack.name}：¥${pack.priceYuan} → ${pack.credits} 积分`,
      orderId: result.order.id,
      balance: result.balanceAfter,
    });
  } catch (err) {
    console.error("[credits/recharge]", err);
    return NextResponse.json({ error: "充值失败，请稍后重试" }, { status: 500 });
  }
}
