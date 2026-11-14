import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** 全量任务列表（状态筛选 + 分页，含提交医生信息） */
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = 20;

  const where = status ? { status } : {};

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: { user: { select: { phone: true, profile: { select: { name: true, hospital: true } } } } },
      orderBy: { createdAt: "desc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.task.count({ where }),
  ]);

  return NextResponse.json({ tasks, total, page, pageSize });
}
