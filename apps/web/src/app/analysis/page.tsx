"use client";

import { useRef, useState } from "react";
import Link from "next/link";

const CHART_OPTIONS = [
  { value: "", label: "自动识别（推荐）" },
  { value: "volcano", label: "火山图" },
  { value: "heatmap", label: "热图" },
  { value: "bar", label: "柱状图" },
  { value: "box", label: "箱线图" },
  { value: "violin", label: "小提琴图" },
  { value: "scatter", label: "散点图" },
  { value: "line", label: "折线图" },
  { value: "hist", label: "直方图" },
];

type ChartResult = {
  chart_type: string;
  chart_label: string;
  image: string;
  interpretation: string;
  rows: number;
  columns: string[];
  stats: Record<string, unknown>;
};

const DEMO_CSV = `gene,log2FC,pvalue
TP53,2.41,0.0012
EGFR,1.92,0.0031
MYC,2.88,0.0004
KRAS,1.35,0.0210
PTEN,-2.10,0.0009
RB1,-1.76,0.0125
CDKN2A,-2.53,0.0007
BRCA1,1.12,0.1800
ATM,0.64,0.4200
CHEK2,-0.88,0.0610
ALK,2.02,0.0088
MET,1.58,0.0140
RET,0.95,0.2200
NF1,-1.42,0.0330
VHL,-1.88,0.0064`;

export default function AnalysisPage() {
  const [file, setFile] = useState<File | null>(null);
  const [chartType, setChartType] = useState("");
  const [instruction, setInstruction] = useState("帮我做个火山图");
  const [result, setResult] = useState<ChartResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function runWithFile(f: File) {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const raw = String(reader.result ?? "");
          resolve(raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw);
        };
        reader.onerror = () => reject(new Error("文件读取失败"));
        reader.readAsDataURL(f);
      });

      const res = await fetch("/api/ai/visualize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: f.name,
          content_base64: base64,
          chart_type: chartType || undefined,
          instruction,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "绘图失败");
      setResult(data as ChartResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "绘图失败");
    } finally {
      setLoading(false);
    }
  }

  function loadDemo() {
    const demo = new File([DEMO_CSV], "demo-deg.csv", { type: "text/csv" });
    setFile(demo);
    void runWithFile(demo);
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">数据分析与可视化</h1>
          <p className="mt-1 text-sm text-slate-500">
            上传 CSV / Excel，说一句话出图；支持 8 类学术图表，出图附统计解读
          </p>
        </div>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          返回工作台 →
        </Link>
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-slate-600">数据文件（.csv / .xlsx，≤5MB）</label>
            <div
              onClick={() => inputRef.current?.click()}
              className="mt-1 cursor-pointer rounded-lg border-2 border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600"
            >
              {file ? file.name : "点击选择文件，或拖入此处"}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f) void runWithFile(f);
              }}
            />
            <button
              onClick={loadDemo}
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              没有数据？加载示例 DEG 表格
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-600">图表类型</label>
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                {CHART_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">用一句话描述需求</label>
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="如：帮我做火山图 / 比较各组指标"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={() => file && runWithFile(file)}
              disabled={loading || !file}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {loading ? "生成中…" : "生成图表"}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
      )}

      {result && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              {result.chart_label}
              <span className="ml-2 font-normal text-slate-400">
                {result.rows} 行 · {result.columns.length} 列
              </span>
            </h2>
            <a
              href={result.image}
              download={`medbuddy-${result.chart_type}.png`}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              下载 PNG
            </a>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.image} alt={result.chart_label} className="mx-auto mt-3 max-h-[520px]" />
          <div className="mt-4 rounded-lg bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-600">AI 解读</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {result.interpretation}
            </p>
          </div>
          <p className="mt-3 text-center text-xs text-slate-400">
            图表由程序基于您的数据绘制；统计显著不等于临床意义，请结合研究设计判断
          </p>
        </section>
      )}
    </main>
  );
}
