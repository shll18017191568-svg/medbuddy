import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** 用户列表（手机号/姓名搜索 + 认证状态筛选 + 分页） */
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const verify = url.searchParams.get("verify") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = 20;

  const where = {
    ...(q
      ? {
          OR: [
            { phone: { contains: q } },
            { profile: { is: { name: { contains: q } } } },
            { profile: { is: { hospital: { contains: q } } } },
          ],
        }
      : {}),
    // 资料审核视角：按认证状态过滤（仅列出已提交资料的用户）
    ...(verify ? { profile: { is: { verifyStatus: verify } } } : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { profile: true, credits: true },
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      phone: u.phone,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
      profile: u.profile,
      balance: u.credits?.balance ?? 0,
    })),
    total,
    page,
    pageSize,
  });
}
