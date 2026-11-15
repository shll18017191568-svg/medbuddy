import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

/** 验证码有效期（分钟）、同号重发间隔（秒）与单码最大失败次数 */
export const CODE_TTL_MIN = 5;
export const RESEND_INTERVAL_SEC = 60;
export const MAX_CODE_ATTEMPTS = 5;

/**
 * 生成并存储短信验证码。
 * 开发模式（SMS_PROVIDER=dev）：验证码明文返回给调用方，方便联调；
 * 生产模式（SMS_PROVIDER=aliyun 等）：只入库，由适配器真实下发（TODO S5 前接入）。
 */
export async function issueSmsCode(
  phone: string,
): Promise<{ code: string; devCode: string | null }> {
  // 同号 60s 内限发
  const last = await prisma.smsCode.findFirst({
    where: { phone, createdAt: { gte: new Date(Date.now() - RESEND_INTERVAL_SEC * 1000) } },
  });
  if (last) throw new Error("SEND_TOO_FREQUENT");

  // 使用加密安全随机数，避免 Math.random 可预测
  const code = String(crypto.randomInt(100000, 1000000));
  const provider = process.env.SMS_PROVIDER ?? "dev";

  await prisma.smsCode.create({
    data: {
      phone,
      code,
      purpose: "LOGIN",
      expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60 * 1000),
    },
  });

  if (provider === "dev") return { code, devCode: code };

  // TODO(S5 前后): 接入阿里云 SMS / 腾讯云 SMS 适配器
  return { code, devCode: null };
}

export type SmsCheckResult = "OK" | "INVALID" | "LOCKED";

/**
 * 校验验证码：正确且未过期未使用则标记作废。
 * 连续失败达 MAX_CODE_ATTEMPTS 次即锁定该码，避免 6 位数字被暴力枚举。
 */
export async function checkSmsCode(phone: string, code: string): Promise<SmsCheckResult> {
  const record = await prisma.smsCode.findFirst({
    where: { phone, usedAt: null, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return "INVALID";
  if (record.attempts >= MAX_CODE_ATTEMPTS) return "LOCKED";

  if (record.code !== code) {
    const attempts = record.attempts + 1;
    await prisma.smsCode.update({ where: { id: record.id }, data: { attempts } });
    return attempts >= MAX_CODE_ATTEMPTS ? "LOCKED" : "INVALID";
  }

  await prisma.smsCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return "OK";
}
