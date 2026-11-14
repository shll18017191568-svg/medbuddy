"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AVATAR_ASPECTS,
  AVATAR_CLONE_TYPES,
  AVATAR_JOB_STATUS_LABEL,
  AVATAR_PROVIDER_LABELS,
  AVATAR_VOICES,
  TASK_TYPE_META,
  TaskType,
} from "@medbuddy/shared";

type AvatarStatus = {
  configured: boolean;
  active: string;
  active_label: string;
  providers: { name: string; label: string }[];
  voices: { id: string; label: string }[];
  aspects: { id: string; label: string; size: string }[];
};

type AvatarJob = {
  id: string;
  kind: "CLONE" | "VIDEO";
  provider: string;
  vendorJobId: string | null;
  status: string;
  createdAt: string;
  taskId: string | null;
};

type Mode = "video" | "appearance" | "voice";

export default function AvatarStudioPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("video");
  const [status, setStatus] = useState<AvatarStatus | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [jobs, setJobs] = useState<AvatarJob[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [voice, setVoice] = useState<string>(AVATAR_VOICES[0].id);
  const [aspect, setAspect] = useState<string>(AVATAR_ASPECTS[0].id);
  const [duration, setDuration] = useState(45);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(() => {
    fetch("/api/avatar/jobs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setJobs(d.jobs ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setBalance(d.user.creditBalance))
      .catch(() => {});

    fetch("/api/ai/avatar")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
      .catch(() => setStatus(null));

    loadJobs();
  }, [loadJobs]);

  const taskType = mode === "video" ? TaskType.AVATAR_VIDEO : TaskType.AVATAR_CLONE;
  const price = TASK_TYPE_META[taskType].price;
  const insufficient = balance !== null && balance < price;

  const modeLabel = useMemo(
    () =>
      mode === "video"
        ? "数字人播报视频"
        : mode === "appearance"
          ? "数字人形象克隆"
          : "数字人声音克隆",
    [mode],
  );

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const taskTitle =
        title.trim() ||
        (mode === "video"
          ? content.trim().slice(0, 20) || "数字人播报视频"
          : `${modeLabel}任务单`);

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: taskType,
          mode: "craft",
          title: taskTitle,
          prompt:
            mode === "video"
              ? `请生成${duration}秒数字人播报视频，音色：${
                  AVATAR_VOICES.find((v) => v.id === voice)?.label ?? "默认"
                }，画幅：${AVATAR_ASPECTS.find((a) => a.id === aspect)?.label ?? "竖屏"}。\n${content.trim()}`
              : `克隆类型：${mode === "appearance" ? "形象" : "声音"}。\n${content.trim()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提交失败");
      router.push(`/tasks/${data.task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
      setLoading(false);
    }
  }

  const disabled =
    content.trim().length < 4 || insufficient || loading || balance === null;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">数字人工作室</h1>
          <p className="mt-1 text-sm text-slate-500">
            播报视频 · 形象/声音克隆 · 一期第三方 API（双供应商备份）
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <span className="text-slate-500">
            余额 <b className="text-blue-600">{balance ?? "…"}</b> 积分
          </span>
          <Link href="/tasks" className="text-blue-600 hover:underline">
            我的任务 →
          </Link>
        </div>
      </div>

      {/* 供应商状态 */}
      <section
        className={`mt-6 rounded-xl border px-4 py-3 text-sm ${
          status?.configured
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
        }`}
      >
        {status ? (
          status.configured ? (
            <p>
              当前供应商：<b>{status.active_label}</b>
              {status.providers.length > 1 &&
                `（备份：${status.providers
                  .filter((p) => p.name !== status.active)
                  .map((p) => p.label)
                  .join(" / ")}）`}
            </p>
          ) : (
            <p>
              <b>演示模式</b>：未配置数字人供应商 Key。仍可生成播报稿、分镜与合成任务单，
              配置 AVATAR_ZHIYING_API_KEY 或 AVATAR_SILICON_API_KEY 后自动合成成片。
            </p>
          )
        ) : (
          <p>数字人服务状态未知（请确认 AI 服务已启动）</p>
        )}
      </section>

      {/* 模式切换 */}
      <section className="mt-6 flex gap-3">
        {(
          [
            ["video", "播报视频", "主题/稿件 → 数字人口播视频"],
            ["appearance", "形象克隆", "真人视频 → 专属数字人形象"],
            ["voice", "声音克隆", "人声素材 → 专属音色"],
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
      </section>

      <section className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {mode === "video" ? (
          <>
            <div>
              <label className="text-sm font-medium text-slate-700">视频主题或原始稿件</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                placeholder="如：高血压患者夏季用药注意事项，面向大众，45 秒短视频，发抖音"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="text-sm font-medium text-slate-700">音色</label>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  {AVATAR_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">画幅</label>
                <select
                  value={aspect}
                  onChange={(e) => setAspect(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  {AVATAR_ASPECTS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">目标时长</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  {[30, 45, 60, 90].map((s) => (
                    <option key={s} value={s}>
                      {s} 秒
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">任务标题（选填）</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="留空则自动取主题前 20 字"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {mode === "appearance"
                ? AVATAR_CLONE_TYPES[0].description
                : AVATAR_CLONE_TYPES[1].description}
              <span className="mt-1 block text-xs text-amber-600">
                合规要求：克隆本人形象/声音须取得书面授权，任务将转人工核验材料后开通。
              </span>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">克隆说明</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                placeholder={
                  mode === "appearance"
                    ? "如：本人出镜科普数字人，用于科室公众号，已有真人视频素材"
                    : "如：克隆本人声音用于播报患教内容，已录制安静环境人声"
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
              />
            </div>
          </>
        )}

        {insufficient && (
          <p className="text-sm text-red-600">
            积分不足：本任务需 {price} 分，当前余额 {balance} 分（可先签到或到充值页补充）
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={submit}
            disabled={disabled}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
          >
            {loading ? "提交中…" : `提交任务（扣 ${price} 积分）`}
          </button>
          <span className="text-xs text-slate-400">会员享 8/7 折，实际扣费以服务端计算为准</span>
        </div>
      </section>

      {/* 任务单列表 */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">我的数字人任务单</h2>
        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            暂无记录。提交播报视频或克隆任务后，可凭供应商任务单号追踪进度。
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    {job.kind === "CLONE" ? "克隆任务单" : "播报视频任务单"}
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                      {AVATAR_PROVIDER_LABELS[job.provider] ?? job.provider}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    单号 {job.vendorJobId || "-"} · {new Date(job.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${
                      job.status === "COMPLETED"
                        ? "bg-green-100 text-green-700"
                        : job.status === "FAILED"
                          ? "bg-red-100 text-red-700"
                          : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {AVATAR_JOB_STATUS_LABEL[job.status] ?? job.status}
                  </span>
                  {job.taskId && (
                    <Link
                      href={`/tasks/${job.taskId}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      查看交付
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-center text-xs text-slate-400">
        AI 生成内容仅供参考；数字人形象/声音仅限本人授权使用，不得用于虚假宣传
      </p>
    </main>
  );
}
