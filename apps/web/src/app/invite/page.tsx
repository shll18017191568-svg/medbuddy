"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type InviteInfo = {
  code: string;
  invitedCount: number;
  inviteEarned: number;
  inviterReward: number;
  inviteeReward: number;
  registerBonus: number;
  inviteLink: string;
};

export default function InvitePage() {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [shareUrl, setShareUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch("/api/invite")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "加载失败");
        setInfo(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, []);

  // 链接需在客户端拼装，避免服务端渲染与 hydration 不一致
  useEffect(() => {
    if (info) setShareUrl(`${window.location.origin}${info.inviteLink}`);
  }, [info]);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("复制失败，请手动选择文本");
      setTimeout(() => setCopied(""), 2500);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          邀请同行 <span className="text-blue-600">双方得积分</span>
        </h1>
        <Link href="/" className="text-sm text-slate-500 hover:underline">
          返回工作台 →
        </Link>
      </div>

      {error && <div className="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {!info && !error && <p className="mt-6 text-slate-400">加载中…</p>}

      {info && (
        <>
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">我的邀请码</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="rounded-xl bg-slate-900 px-6 py-3 font-mono text-2xl tracking-[0.3em] text-white">
                {info.code}
              </span>
              <button
                onClick={() => copy(info.code, "邀请码已复制")}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                复制邀请码
              </button>
              <button
                onClick={() => copy(shareUrl, "邀请链接已复制")}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
              >
                复制邀请链接
              </button>
            </div>
            <p className="mt-3 break-all text-xs text-slate-400">{shareUrl}</p>
            {copied && <p className="mt-2 text-xs text-green-600">{copied}</p>}
          </section>

          <section className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              ["已邀请医生", `${info.invitedCount} 位`],
              ["累计邀请奖励", `${info.inviteEarned} 积分`],
              ["单次奖励", `你 +${info.inviterReward} / 对方 +${info.inviteeReward}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-2 text-lg font-semibold text-slate-800">{value}</p>
              </div>
            ))}
          </section>

          <section className="mt-4 rounded-xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-600 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">邀请规则</h2>
            <ul className="mt-2 space-y-1">
              <li>· 新医生通过你的邀请码完成注册：你获得 {info.inviterReward} 积分，对方额外获得 {info.inviteeReward} 积分。</li>
              <li>· 对方注册即得 {info.registerBonus} 积分，邀请奖励在此基础上叠加。</li>
              <li>· 每位医生只能被邀请一次，老用户登录时填写邀请码不生效。</li>
              <li>· 积分可用于平台科研技能与数字人服务，不可提现。</li>
            </ul>
            <p className="mt-3 text-xs text-slate-400">
              合规提示：邀请仅用于同行推荐，禁止批量注册、虚假账号等作弊行为，违规将冻结积分与账号。
            </p>
          </section>
        </>
      )}
    </main>
  );
}
