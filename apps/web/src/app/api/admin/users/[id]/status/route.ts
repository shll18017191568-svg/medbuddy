import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
});

/** 启用/停用账号（停用后登录被拒） */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const { id } = await params;
  if (id === admin.id) {
    return NextResponse.json({ error: "不能停用自己的账号" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data: { status: parsed.data.status },
    select: { id: true, phone: true, status: true },
  });

  return NextResponse.json({ ok: true, user });
}
