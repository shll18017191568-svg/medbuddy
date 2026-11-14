import { prisma } from "@/lib/prisma";

/** 验证码有效期（分钟）与同号重发间隔（秒） */
export const CODE_TTL_MIN = 5;
export const RESEND_INTERVAL_SEC = 60;

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

  const code = String(Math.floor(100000 + Math.random() * 900000));
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

/** 校验验证码：正确且未过期未使用则标记作废并返回 true */
export async function checkSmsCode(phone: string, code: string): Promise<boolean> {
  const record = await prisma.smsCode.findFirst({
    where: { phone, usedAt: null, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record || record.code !== code) return false;

  await prisma.smsCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return true;
}
