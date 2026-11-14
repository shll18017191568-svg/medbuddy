import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

/** 会话 cookie 名与有效期 */
export const SESSION_COOKIE = "medbuddy_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    // 生产环境缺 AUTH_SECRET 直接失败，绝不允许裸奔
    throw new Error("AUTH_SECRET 未配置（需 >=16 字符）");
  }
  return new TextEncoder().encode(secret);
}

/** 签发会话 JWT */
export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

/** 校验 JWT，返回 userId；无效返回 null */
export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** 从请求 cookie 取当前登录用户（含医生资料与积分），未登录返回 null */
export async function getCurrentUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const userId = await verifySession(token);
  if (!userId) return null;

  return prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, credits: true },
  });
}
