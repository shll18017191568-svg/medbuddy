import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  name: z.string().min(2, "姓名至少 2 个字符").max(20),
  hospital: z.string().min(2, "请填写医院名称").max(50),
  department: z.string().min(1, "请填写科室").max(30),
  title: z.enum(["住院医师", "主治医师", "副主任医师", "主任医师"]),
  certNo: z.string().max(30).optional().or(z.literal("")),
});

/** 提交/更新医生认证资料（S1 采集，人工审核由运营后台完成） */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }

  const data = { ...parsed.data, certNo: parsed.data.certNo || null };

  const profile = await prisma.doctorProfile.upsert({
    where: { userId: user.id },
    update: { ...data, verifyStatus: "PENDING" },
    create: { ...data, userId: user.id },
  });

  return NextResponse.json({ ok: true, profile });
}
