"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Msg = { role: "user" | "assistant"; content: string };
type LlmStatus = { configured: boolean; provider: string; model: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ai/chat")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    setError(null);
    setInput("");
    const history: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "请求失败");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          if (!frame.startsWith("data: ")) continue;
          const event = JSON.parse(frame.slice(6)) as {
            type: "delta" | "done" | "error";
            content?: string;
            message?: string;
          };
          if (event.type === "delta" && event.content) {
            acc += event.content;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: "assistant", content: acc };
              return next;
            });
          } else if (event.type === "error") {
            throw new Error(event.message ?? "生成失败");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
      setMessages((prev) => prev.slice(0, -1)); // 移除占位气泡
    } finally {
      setStreaming(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">AI 数字人对话</h1>
          <p className="mt-1 text-xs text-slate-500">
            {status
              ? status.provider === "mock"
                ? "演示模式：未配置模型 Key（在 apps/ai/.env 填入后即启用真实模型）"
                : `模型：${status.provider} · ${status.model}`
              : "AI 服务状态未知"}
          </p>
        </div>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          返回工作台 →
        </Link>
      </div>

      <section className="mt-6 flex-1 space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {messages.length === 0 && (
          <div className="py-16 text-center text-slate-400">
            <p className="text-sm">向医疗文献大模型提问，例如：</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {[
                "2024 年高血压指南的降压目标有什么更新？",
                "铁死亡在肿瘤免疫治疗中的研究进展",
                "帮我梳理社区获得性肺炎的经验性抗感染思路",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-50 text-slate-800"
              }`}
            >
              {m.content || (streaming && i === messages.length - 1 ? "思考中…" : "")}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </section>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          className="flex-1 resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          className="rounded-xl bg-blue-600 px-6 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {streaming ? "生成中…" : "发送"}
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">
        AI 辅助生成，仅供参考；诊疗决策请以指南原文与临床判断为准
      </p>
    </main>
  );
}
