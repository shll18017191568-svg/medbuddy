import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TaskStatus } from "@medbuddy/shared";

const AI_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";
/** 单任务追问上限：交付后的沟通免费，但设上限防止被当作免费通用对话入口 */
const MAX_USER_MESSAGES = 20;
/** 带入模型的历史条数（避免上下文无限增长） */
const MAX_HISTORY = 12;
/** 交付物截断长度（追问只需核心信息，控制上游 token） */
const RESULT_EXCERPT = 4000;

const bodySchema = z.object({
  content: z.string().trim().min(1, "请输入追问内容").max(2000, "单条追问不超过 2000 字"),
});

const SYSTEM_PROMPT =
  "你是 MedBuddy 的医学助手。医生刚收到一份 AI 辅助生成的任务交付物，正在就此追问。" +
  "请基于下方任务背景与交付内容回答，不要重复整篇交付物，聚焦问题本身。" +
  "不确定的内容必须明确说明需核实原文，绝不编造文献、PMID 或统计数据；" +
  "涉及具体患者诊疗时只提供思路，最终决策权归主诊医生。";

/** 追问列表：仅本人可见 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.userId !== user.id) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const messages = await prisma.taskMessage.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return NextResponse.json({ messages });
}

/** 提交追问：仅已交付任务可对话 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }

  const { id } = await params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.userId !== user.id) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  if (task.status !== TaskStatus.DELIVERED) {
    return NextResponse.json({ error: "任务交付后才能追问" }, { status: 409 });
  }

  const used = await prisma.taskMessage.count({ where: { taskId: id, role: "user" } });
  if (used >= MAX_USER_MESSAGES) {
    return NextResponse.json(
      { error: `本任务追问已达上限（${MAX_USER_MESSAGES} 条），如需继续请新建任务` },
      { status: 429 },
    );
  }

  const input = JSON.parse(task.inputJson) as { prompt?: string };
  const context = [
    `任务标题：${task.title}`,
    `任务类型：${task.type}`,
    `原始需求：${input.prompt ?? "-"}`,
    "交付内容（节选）：",
    (task.resultJson ?? "").slice(0, RESULT_EXCERPT),
  ].join("\n");

  const history = await prisma.taskMessage.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "asc" },
    take: MAX_HISTORY,
    select: { role: true, content: true },
  });

  let answer = "";
  try {
    const res = await fetch(`${AI_URL}/api/llm/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: `${SYSTEM_PROMPT}\n\n【任务背景】\n${context}`,
        messages: [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: parsed.data.content },
        ],
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { answer?: string; error?: string };
    if (data.error) return NextResponse.json({ error: data.error }, { status: 502 });
    answer = (data.answer ?? "").trim();
    if (!answer) return NextResponse.json({ error: "未获取到回答，请重试" }, { status: 502 });
  } catch {
    return NextResponse.json({ error: "AI 服务不可用，请稍后重试" }, { status: 503 });
  }

  const [userMsg, assistMsg] = await prisma.$transaction([
    prisma.taskMessage.create({
      data: { taskId: id, role: "user", content: parsed.data.content },
    }),
    prisma.taskMessage.create({
      data: { taskId: id, role: "assistant", content: answer },
    }),
  ]);

  return NextResponse.json({
    messages: [userMsg, assistMsg],
    remaining: MAX_USER_MESSAGES - used - 1,
  });
}
