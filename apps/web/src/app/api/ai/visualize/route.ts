import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";

const bodySchema = z.object({
  filename: z.string().min(1).max(200),
  content_base64: z.string().min(8).max(8_000_000),
  chart_type: z.string().max(20).optional(),
  instruction: z.string().max(2000).optional(),
});

const AI_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

/** 数据分析与可视化代理：登录校验后转发至 AI 服务 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数错误（文件需小于 5MB）" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AI_URL}/api/skills/visualize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
  } catch {
    return NextResponse.json({ error: "AI 服务不可用，请确认已启动" }, { status: 503 });
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }
  return NextResponse.json(data);
}
