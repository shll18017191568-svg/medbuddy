"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  REGISTER_CREDIT_BONUS,
  SKILL_CATALOG,
  SKILL_CATEGORIES,
  SKILL_PACK_STATS,
  TASK_TYPE_META,
  type SkillCategoryKey,
} from "@medbuddy/shared";

type Me = {
  user: { phone: string; creditBalance: number; membership: { name: string; level: string } | null };
};

export default function SkillsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [category, setCategory] = useState<"all" | SkillCategoryKey>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d))
      .catch(() => setMe(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const skills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SKILL_CATALOG.filter((s) => {
      const inCategory = category === "all" || s.category === category;
      const inQuery =
        !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      return inCategory && inQuery;
    });
  }, [category, query]);

  const liveInCategory = useMemo(
    () => skills.filter((s) => s.status === "live").length,
    [skills],
  );

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      {/* 顶栏 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-blue-600 hover:underline">
            ← 返回首页
          </Link>
          <h1 className="text-xl font-bold">技能中心</h1>
        </div>
        {authLoading ? (
          <span className="text-sm text-slate-400">加载中…</span>
        ) : me ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">
              余额 <b className="text-blue-600">{me.user.creditBalance}</b> 积分
            </span>
            <Link href="/tasks" className="rounded-lg bg-slate-100 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-200">
              我的任务
            </Link>
          </div>
        ) : (
          <Link href="/login" className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            登录 / 注册
          </Link>
        )}
      </header>

      {/* 领取主视觉 */}
      <section className="mt-6 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-8">
        <p className="inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
          40 科研技能免费包 · 获客活动
        </p>
        <h2 className="mt-4 text-3xl font-bold tracking-tight">
          40 项科研技能，注册即<span className="text-blue-600">免费解锁</span>
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
          文献检索、文献解读、学术绘图、综述写作、实验设计、临床方案、文风改写、科普内容、数字人播报……
          无需单独购买技能，注册后直接使用；新医生注册再送 <b className="text-blue-600">{REGISTER_CREDIT_BONUS}</b> 积分。
        </p>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-2xl font-semibold text-blue-600">{SKILL_PACK_STATS.total}</p>
            <p className="mt-1 text-xs text-slate-500">项技能全部免费领取</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-2xl font-semibold text-green-600">{SKILL_PACK_STATS.live}</p>
            <p className="mt-1 text-xs text-slate-500">项已上线可直接使用</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-2xl font-semibold text-amber-600">{REGISTER_CREDIT_BONUS}</p>
            <p className="mt-1 text-xs text-slate-500">注册即赠积分</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {me ? (
            <>
              <span className="rounded-lg bg-green-50 px-4 py-2 text-sm font-medium text-green-700">
                已解锁全部 {SKILL_PACK_STATS.total} 项技能（{SKILL_PACK_STATS.live} 项可用）
              </span>
              <Link href="/tasks/new" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                立即使用技能
              </Link>
              <Link href="/invite" className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200">
                邀请同事领取
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700">
                手机号免费领取
              </Link>
              <span className="text-xs text-slate-500">
                注册后自动解锁，无需付费；{SKILL_PACK_STATS.coming} 项技能陆续上线，已解锁权益持续生效
              </span>
            </>
          )}
        </div>
      </section>

      {/* 分类筛选 */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCategory("all")}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                category === "all" ? "bg-blue-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              全部 {SKILL_PACK_STATS.total}
            </button>
            {SKILL_CATEGORIES.map((c) => {
              const count = SKILL_CATALOG.filter((s) => s.category === c.key).length;
              return (
                <button
                  key={c.key}
                  onClick={() => setCategory(c.key)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    category === c.key ? "bg-blue-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {c.name} {count}
                </button>
              );
            })}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索技能，如：综述 / 生存分析"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 sm:w-64"
          />
        </div>

        <p className="mt-4 text-sm text-slate-500">
          共 {skills.length} 项技能，其中 <b className="text-green-600">{liveInCategory}</b> 项已上线
        </p>

        {/* 技能卡片 */}
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((s) => (
            <div key={s.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{s.name}</p>
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
                    s.status === "live" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {s.status === "live" ? "已上线" : "即将上线"}
                </span>
              </div>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{s.description}</p>
              <div className="mt-4 flex items-center justify-between">
                {s.status === "live" && s.href ? (
                  <Link href={s.href} className="text-sm font-medium text-blue-600 hover:underline">
                    立即使用 →
                  </Link>
                ) : (
                  <span className="text-sm text-slate-400">敬请期待</span>
                )}
                <span className="text-xs text-slate-400">
                  {s.taskType ? `每次 ${TASK_TYPE_META[s.taskType].price} 积分` : "免费解锁"}
                </span>
              </div>
            </div>
          ))}
        </div>

        {skills.length === 0 && (
          <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            没有匹配的技能，换个关键词试试
          </div>
        )}
      </section>

      <footer className="mt-10 space-y-2 border-t border-slate-200 pt-6 text-xs text-slate-400">
        <p>
          技能免费解锁指注册后无需为单个技能付费；调用按任务消耗积分，积分可通过注册赠送、每日签到与邀请获得。
          会员可享 8 折 / 7 折任务折扣。
        </p>
        <p>
          所有交付物由 AI 辅助生成并经合规审核，不构成诊疗建议，详见
          <Link href="/legal/disclaimer" className="mx-1 text-blue-600 hover:underline">
            《医疗免责声明》
          </Link>
          与
          <Link href="/legal/terms" className="mx-1 text-blue-600 hover:underline">
            《用户协议》
          </Link>
          。
        </p>
      </footer>
    </main>
  );
}
