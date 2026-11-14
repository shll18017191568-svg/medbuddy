"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  TASK_STATUS_LABEL,
  TASK_TYPE_META,
  TaskStatus,
  TaskType,
} from "@medbuddy/shared";

type Stats = {
  userCount: number;
  verifiedCount: number;
  pendingCount: number;
  taskCount: number;
  statusMap: Record<string, number>;
  creditsConsumed: number;
};

type AdminUser = {
  id: string;
  phone: string;
  role: string;
  status: string;
  createdAt: string;
  balance: number;
  profile: {
    id: string;
    name: string;
    hospital: string;
    department: string;
    title: string;
    certNo: string | null;
    verifyStatus: string;
  } | null;
};

type AdminTask = {
  id: string;
  type: string;
  title: string;
  status: TaskStatus;
  creditCost: number;
  createdAt: string;
  user: { phone: string; profile: { name: string; hospital: string } | null };
};

const TABS = [
  { key: "overview", label: "概览" },
  { key: "users", label: "用户" },
  { key: "tasks", label: "任务" },
  { key: "verify", label: "资料审核" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const VERIFY_LABEL: Record<string, string> = {
  PENDING: "待审核",
  APPROVED: "已通过",
  REJECTED: "已驳回",
};

export default function AdminPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");

  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [taskStatus, setTaskStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAuthorized(d?.user?.role === "ADMIN"))
      .catch(() => setAuthorized(false));
  }, []);

  const loadStats = useCallback(async () => {
    const r = await fetch("/api/admin/stats");
    if (r.ok) setStats(await r.json());
  }, []);

  const loadUsers = useCallback(
    async (verify = "") => {
      setLoading(true);
      const params = new URLSearchParams();
      if (keyword) params.set("q", keyword);
      if (verify) params.set("verify", verify);
      const r = await fetch(`/api/admin/users?${params}`);
      if (r.ok) setUsers((await r.json()).users);
      setLoading(false);
    },
    [keyword],
  );

  const loadTasks = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/admin/tasks${taskStatus ? `?status=${taskStatus}` : ""}`);
    if (r.ok) setTasks((await r.json()).tasks);
    setLoading(false);
  }, [taskStatus]);

  useEffect(() => {
    if (authorized !== true) return;
    if (tab === "overview") loadStats();
    if (tab === "users") loadUsers("");
    if (tab === "verify") loadUsers("PENDING");
    if (tab === "tasks") loadTasks();
  }, [authorized, tab, loadStats, loadUsers, loadTasks]);

  async function verifyProfile(profileId: string, action: "APPROVE" | "REJECT") {
    await fetch(`/api/admin/profiles/${profileId}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    loadUsers("PENDING");
    loadStats();
  }

  async function toggleUser(user: AdminUser) {
    await fetch(`/api/admin/users/${user.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: user.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }),
    });
    loadUsers(tab === "verify" ? "PENDING" : "");
  }

  if (authorized === null) {
    return <main className="p-10 text-center text-slate-400">加载中…</main>;
  }
  if (!authorized) {
    return (
      <main className="p-10 text-center">
        <p className="text-slate-500">无权限访问运营后台</p>
        <Link href="/" className="mt-4 inline-block text-blue-600 hover:underline">
          返回工作台
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          MedBuddy <span className="text-blue-600">运营后台</span>
        </h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          返回工作台 →
        </Link>
      </div>

      <div className="mt-6 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 概览 */}
      {tab === "overview" && stats && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-5">
            {[
              ["注册用户", stats.userCount],
              ["已认证医生", stats.verifiedCount],
              ["待审核资料", stats.pendingCount],
              ["任务总数", stats.taskCount],
              ["累计消耗积分", stats.creditsConsumed],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-800">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700">任务状态分布</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              {Object.values(TaskStatus).map((s) => (
                <span key={s} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                  {TASK_STATUS_LABEL[s]}
                  <b className="ml-2 text-blue-600">{stats.statusMap[s] ?? 0}</b>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 用户 */}
      {tab === "users" && (
        <>
          <div className="mt-6 flex gap-2">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索手机号 / 姓名 / 医院"
              className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <button
              onClick={() => loadUsers("")}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
            >
              搜索
            </button>
          </div>
          <UserTable users={users} loading={loading} onToggle={toggleUser} />
        </>
      )}

      {/* 任务 */}
      {tab === "tasks" && (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {[{ key: "", label: "全部" }, ...Object.values(TaskStatus).map((s) => ({ key: s, label: TASK_STATUS_LABEL[s] }))].map(
              (s) => (
                <button
                  key={s.key}
                  onClick={() => setTaskStatus(s.key)}
                  className={`rounded-full px-4 py-1.5 text-sm transition ${
                    taskStatus === s.key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {s.label}
                </button>
              ),
            )}
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3">任务</th>
                  <th className="px-4 py-3">提交医生</th>
                  <th className="px-4 py-3">类型</th>
                  <th className="px-4 py-3">积分</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">提交时间</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="max-w-xs truncate px-4 py-3 font-medium">{t.title}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {t.user.profile?.name ?? "-"}
                      <span className="ml-1 text-xs text-slate-400">{t.user.phone}</span>
                    </td>
                    <td className="px-4 py-3">{TASK_TYPE_META[t.type as TaskType]?.label ?? t.type}</td>
                    <td className="px-4 py-3">{t.creditCost}</td>
                    <td className="px-4 py-3">{TASK_STATUS_LABEL[t.status] ?? t.status}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(t.createdAt).toLocaleString("zh-CN")}
                    </td>
                  </tr>
                ))}
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      {loading ? "加载中…" : "暂无任务"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 资料审核 */}
      {tab === "verify" && (
        <>
          <p className="mt-6 text-sm text-slate-500">
            待审核资料按提交时间倒序展示，审核结果实时同步到医生端
          </p>
          <div className="mt-4 space-y-3">
            {users.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
                {loading ? "加载中…" : "没有待审核的医生资料"}
              </div>
            )}
            {users.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div>
                  <p className="font-semibold">
                    {u.profile?.name}
                    <span className="ml-2 text-sm font-normal text-slate-500">
                      {u.profile?.title} · {u.profile?.hospital} · {u.profile?.department}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {u.phone} · 证书编号 {u.profile?.certNo || "未填写"} · 提交于{" "}
                    {new Date(u.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => u.profile && verifyProfile(u.profile.id, "APPROVE")}
                    className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                  >
                    通过
                  </button>
                  <button
                    onClick={() => u.profile && verifyProfile(u.profile.id, "REJECT")}
                    className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                  >
                    驳回
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

function UserTable({
  users,
  loading,
  onToggle,
}: {
  users: AdminUser[];
  loading: boolean;
  onToggle: (u: AdminUser) => void;
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-3">手机号</th>
            <th className="px-4 py-3">姓名</th>
            <th className="px-4 py-3">医院/科室</th>
            <th className="px-4 py-3">职称</th>
            <th className="px-4 py-3">认证</th>
            <th className="px-4 py-3">积分</th>
            <th className="px-4 py-3">状态</th>
            <th className="px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-slate-100">
              <td className="px-4 py-3">
                {u.phone}
                {u.role === "ADMIN" && (
                  <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700">
                    管理员
                  </span>
                )}
              </td>
              <td className="px-4 py-3">{u.profile?.name ?? "-"}</td>
              <td className="px-4 py-3 text-slate-600">
                {u.profile ? `${u.profile.hospital} / ${u.profile.department}` : "-"}
              </td>
              <td className="px-4 py-3">{u.profile?.title ?? "-"}</td>
              <td className="px-4 py-3">
                {u.profile ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      u.profile.verifyStatus === "APPROVED"
                        ? "bg-green-100 text-green-700"
                        : u.profile.verifyStatus === "REJECTED"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {VERIFY_LABEL[u.profile.verifyStatus] ?? u.profile.verifyStatus}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">未提交</span>
                )}
              </td>
              <td className="px-4 py-3 font-medium text-blue-600">{u.balance}</td>
              <td className="px-4 py-3">
                <span className={u.status === "ACTIVE" ? "text-green-600" : "text-red-500"}>
                  {u.status === "ACTIVE" ? "正常" : "已停用"}
                </span>
              </td>
              <td className="px-4 py-3">
                {u.role !== "ADMIN" && (
                  <button
                    onClick={() => onToggle(u)}
                    className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  >
                    {u.status === "ACTIVE" ? "停用" : "启用"}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                {loading ? "加载中…" : "暂无用户"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
