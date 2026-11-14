import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_MAX_AGE, isAdminPhone, signSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkSmsCode } from "@/lib/sms";
import { REGISTER_CREDIT_BONUS } from "@medbuddy/shared";

const bodySchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, "手机号格式不正确"),
  code: z.string().regex(/^\d{6}$/, "验证码格式不正确"),
});

/**
 * 验证码登录：校验通过后注册（新用户送积分）并签发会话 cookie。
 * 返回 needsProfile 提示前端引导补全医生资料。
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }
  const { phone, code } = parsed.data;

  const valid = await checkSmsCode(phone, code);
  if (!valid) {
    return NextResponse.json({ error: "验证码错误或已过期" }, { status: 401 });
  }

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { phone },
      include: { profile: true },
    });
    if (existing) {
      // 管理员白名单引导：命中则自动提权
      if (isAdminPhone(phone) && existing.role !== "ADMIN") {
        return tx.user.update({
          where: { id: existing.id },
          data: { role: "ADMIN" },
          include: { profile: true },
        });
      }
      return existing;
    }

    // 新用户注册：建立账户 + 注册积分
    return tx.user.create({
      data: {
        phone,
        role: isAdminPhone(phone) ? "ADMIN" : "DOCTOR",
        credits: { create: { balance: REGISTER_CREDIT_BONUS, totalEarn: REGISTER_CREDIT_BONUS } },
      },
      include: { profile: true },
    });
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
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
