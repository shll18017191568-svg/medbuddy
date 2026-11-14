import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(20000),
      }),
    )
    .min(1)
    .max(40),
});

const AI_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

/** AI 服务状态（是否已配置模型 Key） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const res = await fetch(`${AI_URL}/api/llm/status`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ configured: false, provider: "offline", model: "-" });
  }
}

/** 流式对话代理：登录校验后把 SSE 原样透传给浏览器 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${AI_URL}/api/llm/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
  } catch {
    return NextResponse.json({ error: "AI 服务不可用，请确认已启动" }, { status: 503 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "AI 服务异常" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
