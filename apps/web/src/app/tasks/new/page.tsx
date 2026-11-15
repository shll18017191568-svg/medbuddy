"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TASK_TYPE_META, TaskMode, TaskType, ASK_PRICE } from "@medbuddy/shared";

export default function NewTaskPage() {
  const router = useRouter();
  const [type, setType] = useState<TaskType>(TaskType.LITERATURE_SEARCH);
  const [mode, setMode] = useState<TaskMode>(TaskMode.CRAFT);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setBalance(d.user.creditBalance))
      .catch(() => {});
  }, []);

  const meta = TASK_TYPE_META[type];
  const effectivePrice = mode === TaskMode.ASK ? ASK_PRICE : meta.price;
  const insufficient = balance !== null && balance < effectivePrice;

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, mode, title, prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提交失败");
      router.push(`/tasks/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">提交任务</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500">
            余额 <b className="text-blue-600">{balance ?? "…"}</b> 积分
          </span>
          <Link href="/tasks" className="text-blue-600 hover:underline">
            我的任务
          </Link>
        </div>
      </div>

      {/* 任务类型 */}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-slate-700">选择任务类型</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(Object.keys(TASK_TYPE_META) as TaskType[]).map((t) => {
            const m = TASK_TYPE_META[t];
            const active = t === type;
            return (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded-xl border p-4 text-left transition ${
                  active
                    ? "border-blue-600 bg-blue-50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <p className="font-semibold">{m.label}</p>
                <p className="mt-1 text-xs text-slate-500">{m.description}</p>
                <p className="mt-2 text-sm font-medium text-blue-600">{m.price} 积分/次</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* 工作模式 */}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-slate-700">工作模式</h2>
        <div className="mt-3 flex gap-3">
          {(
            [
              [TaskMode.CRAFT, "直接执行", "明确需求，立即开工"],
              [TaskMode.PLAN, "先出方案", "AI 先给执行方案，您确认后开工"],
              [TaskMode.ASK, "仅问答", "只分析不给交付物"],
            ] as const
          ).map(([m, label, desc]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-xl border p-3 text-left transition ${
                mode === m ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"
              }`}
            >
              <p className="text-sm font-semibold">{label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* 表单 */}
      <section className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label className="text-sm font-medium text-slate-700">任务标题</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如：铁死亡在肿瘤免疫中作用的文献调研"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">需求描述</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder={
              type === TaskType.LITERATURE_DIGEST
                ? "输入要解读的文献 PMID（5-9 位数字），如：38453898"
                : type === TaskType.CLINICAL_DESIGN
                  ? "输入临床研究问题，如：免疫检查点抑制剂联合化疗在晚期非小细胞肺癌中的疗效与安全性（可附 PMID）"
                  : type === TaskType.EXPERIMENT_DESIGN
                  ? "输入课题方向，可附核心文献 PMID，如：铁死亡调控肿瘤免疫微环境的机制研究 38453898"
                  : type === TaskType.REVIEW_DRAFT
                  ? "输入综述主题，如：铁死亡在肿瘤免疫治疗中的作用（系统会自动检索真实文献并生成初稿）"
                  : type === TaskType.CHART
                  ? "先写需求，再用「数据：」粘贴 CSV（首行为表头），如：\n帮我做火山图\n数据：\ngene,log2FC,pvalue\nTP53,2.4,0.001"
                : type === TaskType.CONTENT_GEN
                  ? "输入主题并注明形式，如：高血压患者夏季用药注意事项（短视频脚本，发抖音）"
                : type === TaskType.STYLE_REWRITE
                  ? "粘贴原文（≥50 字），并说明改成什么文风，如：以下这段改成患者能看懂的版本：……"
                  : type === TaskType.AVATAR_VIDEO
                  ? "描述视频主题并注明时长/音色/画幅，如：高血压患者夏季用药注意事项，45 秒，竖屏发抖音（更多参数建议到数字人工作室提交）"
                  : type === TaskType.AVATAR_CLONE
                  ? "说明克隆类型与用途，如：克隆本人声音用于患教播报，已录制安静环境人声（需附授权材料）"
                  : type === TaskType.REFERENCE_FORMAT
                  ? "粘贴 PMID 列表，可注明格式，如：38453898 33268902 35025101（APA 格式）"
                  : "用大白话描述您的需求，如：帮我找铁死亡在肿瘤免疫中作用近 3 年的高质量综述，优先 Review，排除 Letter"
            }
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          />
        </div>

        {insufficient && (
          <p className="text-sm text-red-600">
            积分不足：本任务需 {effectivePrice} 分，当前余额 {balance} 分
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={submit}
          disabled={title.trim().length < 2 || prompt.trim().length < 1 || insufficient || loading}
          className="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          {loading ? "提交中…" : `提交任务（扣 ${effectivePrice} 积分）`}
        </button>
        <p className="text-xs text-slate-400">
          提交后任务云端执行，关闭浏览器不影响；完成后在任务中心查看交付结果。
          交付物由 AI 辅助生成并经合规审核，详见
          <Link href="/legal/disclaimer" className="mx-1 text-blue-600 hover:underline">
            《医疗免责声明》
          </Link>
        </p>
      </section>
    </main>
  );
}
