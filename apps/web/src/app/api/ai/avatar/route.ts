import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

const AI_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

/** 数字人供应商状态（演示模式 / 已接入供应商 + 备份列出） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const res = await fetch(`${AI_URL}/api/avatar/status`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({
      configured: false,
      active: "offline",
      active_label: "AI 服务不可用",
      providers: [],
      voices: [],
      aspects: [],
    });
  }
}
