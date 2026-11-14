"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TITLES = ["住院医师", "主治医师", "副主任医师", "主任医师"] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    hospital: "",
    department: "",
    title: "主治医师",
    certNo: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const valid =
    form.name.trim().length >= 2 &&
    form.hospital.trim().length >= 2 &&
    form.department.trim().length >= 1;

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提交失败");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-center text-2xl font-bold">完善医生资料</h1>
      <p className="mt-2 text-center text-sm text-slate-500">
        资料仅用于身份认证与个性化服务，审核通过前可正常使用基础功能
      </p>

      <div className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {(
          [
            ["name", "姓名", "真实姓名", "text"],
            ["hospital", "所在医院", "如：北京协和医院", "text"],
            ["department", "科室", "如：心内科", "text"],
            ["certNo", "执业证书编号（选填）", "证书编号", "text"],
          ] as const
        ).map(([key, label, placeholder]) => (
          <div key={key}>
            <label className="text-sm font-medium text-slate-700">{label}</label>
            <input
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
              placeholder={placeholder}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
            />
          </div>
        ))}

        <div>
          <label className="text-sm font-medium text-slate-700">职称</label>
          <select
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
          >
            {TITLES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={submit}
          disabled={!valid || loading}
          className="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          {loading ? "提交中…" : "提交资料，进入工作台"}
        </button>
      </div>
    </main>
  );
}
