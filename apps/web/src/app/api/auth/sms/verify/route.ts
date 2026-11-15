import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_MAX_AGE, isAdminPhone, signSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkSmsCode } from "@/lib/sms";
import { findInviterByCode, normalizeInviteCode } from "@/lib/invite";
import {
  INVITE_REWARD_INVITEE,
  INVITE_REWARD_INVITER,
  REGISTER_CREDIT_BONUS,
} from "@medbuddy/shared";

const bodySchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
  code: z.string().regex(/^\d{6}$/, "验证码格式不正确"),
  // 邀请码仅对新注册用户生效，老用户登录时忽略
  inviteCode: z.string().trim().max(16).optional(),
});

function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}****${phone.slice(7)}`;
}

/**
 * 验证码登录：校验通过后注册（新用户送积分）并签发会话 cookie。
 * 新用户携带有效邀请码时，注册事务内同时发放邀请人与被邀请人奖励。
 * 返回 needsProfile 提示前端引导补全医生资料。
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }
  const { phone, code } = parsed.data;
  const inviteCode = normalizeInviteCode(parsed.data.inviteCode);

  // 先判断是否新用户：老用户登录不受邀请码影响，也不会因码无效被拦截
  const existingUser = await prisma.user.findUnique({
    where: { phone },
    select: { id: true },
  });

  let inviter: { id: string; status: string } | null = null;
  if (!existingUser && inviteCode) {
    inviter = await findInviterByCode(inviteCode);
    if (!inviter || inviter.status !== "ACTIVE") {
      return NextResponse.json({ error: "邀请码不存在，请核对后重试" }, { status: 400 });
    }
  }

  const result = await checkSmsCode(phone, code);
  if (result === "LOCKED") {
    return NextResponse.json(
      { error: "验证码错误次数过多，请重新获取验证码" },
      { status: 429 },
    );
  }
  if (result !== "OK") {
    return NextResponse.json({ error: "验证码错误或已过期" }, { status: 401 });
  }

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { phone },
      include: { profile: true },
    });
    if (existing) {
      // 老用户不重复绑定邀请关系，也不重复发奖
      if (isAdminPhone(phone) && existing.role !== "ADMIN") {
        return tx.user.update({
          where: { id: existing.id },
          data: { role: "ADMIN" },
          include: { profile: true },
        });
      }
      return existing;
    }

    // 新用户注册：建立账户 + 注册积分（含受邀奖励）
    const invitedBonus = inviter ? INVITE_REWARD_INVITEE : 0;
    const startCredits = REGISTER_CREDIT_BONUS + invitedBonus;
    const created = await tx.user.create({
      data: {
        phone,
        role: isAdminPhone(phone) ? "ADMIN" : "DOCTOR",
        invitedById: inviter?.id ?? null,
        invitedAt: inviter ? new Date() : null,
        credits: { create: { balance: startCredits, totalEarn: startCredits } },
      },
      include: { profile: true },
    });

    if (inviter) {
      const inviterAccount = await tx.creditAccount.findUniqueOrThrow({
        where: { userId: inviter.id },
      });
      const inviterBalance = inviterAccount.balance + INVITE_REWARD_INVITER;
      await tx.creditAccount.update({
        where: { id: inviterAccount.id },
        data: {
          balance: inviterBalance,
          totalEarn: { increment: INVITE_REWARD_INVITER },
        },
      });
      await tx.creditLedger.create({
        data: {
          userId: inviter.id,
          type: "INVITE",
          amount: INVITE_REWARD_INVITER,
          balanceAfter: inviterBalance,
          note: `邀请新医生 ${maskPhone(phone)} 注册`,
        },
      });
      await tx.creditLedger.create({
        data: {
          userId: created.id,
          type: "INVITE",
          amount: INVITE_REWARD_INVITEE,
          balanceAfter: startCredits,
          note: "受邀注册奖励积分",
        },
      });
    }

    return created;
  });

  if (user.status !== "ACTIVE") {
    return NextResponse.json({ error: "账号已被停用，请联系客服" }, { status: 403 });
  }

  const token = await signSession(user.id);
  const res = NextResponse.json({
    ok: true,
    needsProfile: !user.profile,
    user: { id: user.id, phone: user.phone, role: user.role },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
