import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** 排除易混字符（I/O/0/1），便于口头与截图传播 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

/** 邀请码统一大写去空格，避免大小写造成的“码无效” */
export function normalizeInviteCode(raw?: string | null): string {
  return (raw ?? "").trim().toUpperCase();
}

/** 取当前用户的邀请码；没有则生成并落库（唯一冲突自动重试） */
export async function ensureInviteCode(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { inviteCode: true },
  });
  if (user.inviteCode) return user.inviteCode;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { inviteCode: randomCode() },
        select: { inviteCode: true },
      });
      if (updated.inviteCode) return updated.inviteCode;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("INVITE_CODE_GENERATION_FAILED");
}

/** 按邀请码查邀请人（无效码返回 null） */
export async function findInviterByCode(code: string) {
  if (!code) return null;
  return prisma.user.findUnique({
    where: { inviteCode: code },
    select: { id: true, status: true },
  });
}
