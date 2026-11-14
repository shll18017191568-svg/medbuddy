import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
});

/** 医生资料人工审核：通过 / 驳回 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数错误" }, { status: 400 });

  const { id } = await params;
  const profile = await prisma.doctorProfile.update({
    where: { id },
    data: { verifyStatus: parsed.data.action === "APPROVE" ? "APPROVED" : "REJECTED" },
  });

  return NextResponse.json({ ok: true, profile });
}
