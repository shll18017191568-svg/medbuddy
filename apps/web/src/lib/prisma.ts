import { PrismaClient } from "@prisma/client";

/** Prisma 全局单例（避免 dev 热重载重复实例化耗尽连接） */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
