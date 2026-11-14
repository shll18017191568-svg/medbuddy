"""技能 8：数据分析与可视化。

设计原则：
- 图表由确定性代码绘制（pandas + matplotlib），不交给大模型"画图"，
  避免出现"描述得像真的、数据却是编的"问题；
- 大模型只负责解读已生成的统计结果；
- 首批支持 8 类高频图：火山图、热图、柱状图、箱线图、小提琴图、散点图、折线图、直方图。
"""
from __future__ import annotations

import base64
import io
import re

import matplotlib

matplotlib.use("Agg")  # 无界面渲染，服务端必须

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib import rcParams  # noqa: E402

rcParams["figure.dpi"] = 160
rcParams["savefig.bbox"] = "tight"
rcParams["axes.spines.top"] = False
rcParams["axes.spines.right"] = False
rcParams["font.size"] = 10

PALETTE = ["#2E5EAA", "#D1495B", "#00798C", "#EDAE49", "#66A182", "#8D96A3"]

CHART_TYPES = ["volcano", "heatmap", "bar", "box", "violin", "scatter", "line", "hist"]

CHART_LABEL = {
    "volcano": "火山图",
    "heatmap": "热图",
    "bar": "柱状图",
    "box": "箱线图",
    "violin": "小提琴图",
    "scatter": "散点图",
    "line": "折线图",
    "hist": "直方图",
}

KEYWORDS: list[tuple[str, list[str]]] = [
    ("volcano", ["火山", "volcano", "差异基因", "deg", "fold change", "log2fc"]),
    ("heatmap", ["热图", "heatmap", "表达谱", "聚类"]),
    ("violin", ["小提琴", "violin"]),
    ("box", ["箱线", "boxplot", "箱式"]),
    ("scatter", ["散点", "scatter", "相关性", "correlation"]),
    ("line", ["折线", "趋势", "line", "随时间"]),
    ("hist", ["直方", "分布", "histogram", "distribution"]),
    ("bar", ["柱状", "条形", "bar", "比较", "分组"]),
]

LOG2FC_KEYS = ["log2fc", "log2_fc", "logfc", "log2foldchange", "fold_change", "fc"]
PVALUE_KEYS = ["pvalue", "p_value", "p", "padj", "p_adj", "fdr", "qvalue", "adj.p.val"]
GENE_KEYS = ["gene", "symbol", "gene_symbol", "id", "name", "基因"]


def _find_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    lower = {c.lower().strip(): c for c in df.columns}
    for key in candidates:
        if key in lower:
            return lower[key]
    # 含有关键词的列名（如 "log2FoldChange"）
    for col_lower, col in lower.items():
        if any(key in col_lower for key in candidates):
            return col
    return None


def detect_chart_type(instruction: str, df: pd.DataFrame) -> str:
    """先按关键词匹配，再按数据结构推断。"""
    text = (instruction or "").lower()

    # 提到"分组/组间/各组"且存在分类列时，优先分布对比图
    has_category = len(df.select_dtypes(include="number").columns) < len(df.columns)
    if has_category and any(w in text for w in ["分组", "组间", "各组", "组别"]):
        return "box"

    for chart, words in KEYWORDS:
        if any(w in text for w in words):
            return chart

    numeric = df.select_dtypes(include="number").columns
    if len(numeric) >= 2 and df.shape[0] <= 50:
        return "scatter"
    if len(numeric) == 1 and df.shape[0] >= 20:
        return "hist"
    return "bar"


def _fig_to_data_url(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor="white")
    plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _numeric(df: pd.DataFrame) -> pd.DataFrame:
    return df.select_dtypes(include="number")


def _render_volcano(df: pd.DataFrame) -> tuple[str, dict]:
    fc_col = _find_col(df, LOG2FC_KEYS)
    p_col = _find_col(df, PVALUE_KEYS)
    if not fc_col or not p_col:
        raise ValueError(
            f"火山图需要 log2FC 与 p 值两列，当前列：{', '.join(map(str, df.columns))}"
        )

    gene_col = _find_col(df, GENE_KEYS)
    data = df[[fc_col, p_col] + ([gene_col] if gene_col else [])].dropna()
    fc = pd.to_numeric(data[fc_col], errors="coerce")
    p = pd.to_numeric(data[p_col], errors="coerce").clip(lower=1e-300)
    value = data[fc_col].copy()
    data = data.assign(_fc=fc, _lp=-np.log10(p)).dropna(subset=["_fc", "_lp"])
    data["_reg"] = np.where(
        (data["_fc"] > 1) & (data[p_col] < 0.05),
        "Up",
        np.where((data["_fc"] < -1) & (data[p_col] < 0.05), "Down", "NS"),
    )

    fig, ax = plt.subplots(figsize=(6.2, 5.2))
    colors = {"Up": "#D1495B", "Down": "#2E5EAA", "NS": "#B8C0CC"}
    for group, sub in data.groupby("_reg"):
        ax.scatter(sub["_fc"], sub["_lp"], s=16, alpha=0.75, c=colors[group], label=group, linewidths=0)
    ax.axhline(-np.log10(0.05), color="#666", ls="--", lw=0.8)
    ax.axvline(1, color="#666", ls="--", lw=0.8)
    ax.axvline(-1, color="#666", ls="--", lw=0.8)

    if gene_col:
        top = data.nlargest(5, "_lp")
        for _, row in top.iterrows():
            ax.annotate(str(row[gene_col]), (row["_fc"], row["_lp"]), fontsize=7, alpha=0.9)

    ax.set_xlabel(f"log2 Fold Change ({fc_col})")
    ax.set_ylabel(f"-log10 P value ({p_col})")
    ax.set_title("Volcano Plot", fontsize=12)
    ax.legend(frameon=False, fontsize=8)

    counts = data["_reg"].value_counts().to_dict()
    stats = {
        "chart": "volcano",
        "total": int(len(data)),
        "up": int(counts.get("Up", 0)),
        "down": int(counts.get("Down", 0)),
        "ns": int(counts.get("NS", 0)),
        "threshold": "|log2FC| > 1 且 p < 0.05",
    }
    _ = value  # 保留原始列引用，避免误用派生值
    return _fig_to_data_url(fig), stats


def _pick_group_and_value(df: pd.DataFrame) -> tuple[str | None, str]:
    numeric = _numeric(df)
    if numeric.empty:
        raise ValueError("数据中没有数值列，无法绘图")
    value_col = numeric.columns[0]
    cat_cols = [c for c in df.columns if c not in numeric.columns]
    group_col = cat_cols[0] if cat_cols else None
    return group_col, value_col


def _render_grouped(df: pd.DataFrame, kind: str) -> tuple[str, dict]:
    group_col, value_col = _pick_group_and_value(df)
    groups = []
    if group_col:
        for name, sub in df.groupby(group_col):
            vals = pd.to_numeric(sub[value_col], errors="coerce").dropna()
            if len(vals):
                groups.append((str(name), vals))
    else:
        vals = pd.to_numeric(df[value_col], errors="coerce").dropna()
        groups = [(value_col, vals)]

    fig, ax = plt.subplots(figsize=(6.2, 4.6))
    labels = [g[0] for g in groups]
    data = [g[1].to_numpy() for g in groups]

    if kind == "bar":
        means = [float(np.mean(d)) for d in data]
        sems = [float(np.std(d, ddof=1) / np.sqrt(len(d))) if len(d) > 1 else 0.0 for d in data]
        ax.bar(labels, means, yerr=sems, capsize=4, color=PALETTE[: len(labels)], width=0.6)
        ax.set_ylabel(value_col)
    elif kind == "box":
        ax.boxplot(data, tick_labels=labels, patch_artist=True,
                   boxprops={"facecolor": "#E8EEF7", "edgecolor": "#2E5EAA"},
                   medianprops={"color": "#D1495B"})
        ax.set_ylabel(value_col)
    else:  # violin
        parts = ax.violinplot(data, showmeans=True, showextrema=False)
        for i, body in enumerate(parts["bodies"]):
            body.set_facecolor(PALETTE[i % len(PALETTE)])
            body.set_alpha(0.7)
        ax.set_xticks(range(1, len(labels) + 1))
        ax.set_xticklabels(labels)
        ax.set_ylabel(value_col)

    ax.set_xlabel(group_col or "")
    ax.set_title({"bar": "Bar Chart", "box": "Box Plot", "violin": "Violin Plot"}[kind], fontsize=12)
    if len(labels) > 6:
        plt.xticks(rotation=30, ha="right")

    stats = {
        "chart": kind,
        "group_by": group_col,
        "value": value_col,
        "groups": [
            {
                "name": name,
                "n": int(len(vals)),
                "mean": round(float(np.mean(vals)), 3),
                "median": round(float(np.median(vals)), 3),
                "sd": round(float(np.std(vals, ddof=1)), 3) if len(vals) > 1 else 0.0,
            }
            for name, vals in groups
        ],
    }
    return _fig_to_data_url(fig), stats


def _render_scatter(df: pd.DataFrame) -> tuple[str, dict]:
    numeric = _numeric(df)
    if numeric.shape[1] < 2:
        raise ValueError("散点图需要至少两列数值数据")
    x_col, y_col = numeric.columns[0], numeric.columns[1]
    data = df[[x_col, y_col]].apply(pd.to_numeric, errors="coerce").dropna()

    fig, ax = plt.subplots(figsize=(5.6, 4.8))
    ax.scatter(data[x_col], data[y_col], s=22, alpha=0.75, c=PALETTE[0], linewidths=0)
    if len(data) > 2 and data[x_col].std() > 0 and data[y_col].std() > 0:
        k, b = np.polyfit(data[x_col], data[y_col], 1)
        xs = np.linspace(data[x_col].min(), data[x_col].max(), 50)
        ax.plot(xs, k * xs + b, color=PALETTE[1], lw=1.2, ls="--")
        r = float(np.corrcoef(data[x_col], data[y_col])[0, 1])
    else:
        r = float("nan")

    ax.set_xlabel(x_col)
    ax.set_ylabel(y_col)
    ax.set_title("Scatter Plot", fontsize=12)
    return _fig_to_data_url(fig), {
        "chart": "scatter",
        "x": x_col,
        "y": y_col,
        "n": int(len(data)),
        "pearson_r": None if np.isnan(r) else round(r, 3),
        "slope": round(float(k), 4) if len(data) > 2 else None,
    }


def _render_line(df: pd.DataFrame) -> tuple[str, dict]:
    numeric = _numeric(df)
    if numeric.empty:
        raise ValueError("数据中没有数值列，无法绘制折线图")
    y_col = numeric.columns[0]
    x_col = numeric.columns[1] if numeric.shape[1] > 1 else None

    fig, ax = plt.subplots(figsize=(6.2, 4.2))
    if x_col:
        data = df[[x_col, y_col]].apply(pd.to_numeric, errors="coerce").dropna()
        ax.plot(data[x_col], data[y_col], marker="o", ms=3, color=PALETTE[0], lw=1.5)
        ax.set_xlabel(x_col)
    else:
        data = pd.to_numeric(df[y_col], errors="coerce").dropna()
        ax.plot(range(len(data)), data, marker="o", ms=3, color=PALETTE[0], lw=1.5)
        ax.set_xlabel("Index")

    ax.set_ylabel(y_col)
    ax.set_title("Line Chart", fontsize=12)
    return _fig_to_data_url(fig), {
        "chart": "line",
        "x": x_col or "index",
        "y": y_col,
        "n": int(len(data)),
        "first": round(float(data.iloc[0]), 3),
        "last": round(float(data.iloc[-1]), 3),
        "change_pct": round(float((data.iloc[-1] - data.iloc[0]) / abs(data.iloc[0]) * 100), 2)
        if data.iloc[0] != 0
        else None,
    }


def _render_hist(df: pd.DataFrame) -> tuple[str, dict]:
    numeric = _numeric(df)
    if numeric.empty:
        raise ValueError("数据中没有数值列，无法绘制直方图")
    col = numeric.columns[0]
    data = pd.to_numeric(df[col], errors="coerce").dropna()

    fig, ax = plt.subplots(figsize=(6.0, 4.0))
    ax.hist(data, bins=min(30, max(8, int(np.sqrt(len(data))))), color=PALETTE[0], alpha=0.85, edgecolor="white")
    ax.set_xlabel(col)
    ax.set_ylabel("Count")
    ax.set_title("Histogram", fontsize=12)
    return _fig_to_data_url(fig), {
        "chart": "hist",
        "column": col,
        "n": int(len(data)),
        "mean": round(float(data.mean()), 3),
        "median": round(float(data.median()), 3),
        "min": round(float(data.min()), 3),
        "max": round(float(data.max()), 3),
    }


def _render_heatmap(df: pd.DataFrame) -> tuple[str, dict]:
    numeric = _numeric(df)
    if numeric.shape[1] < 2:
        raise ValueError("热图需要至少两列数值数据")

    matrix = numeric.head(60)
    z = (matrix - matrix.mean()) / matrix.std(ddof=0).replace(0, np.nan)
    z = z.fillna(0)

    height = max(3.2, min(8.0, 0.9 + 0.32 * z.shape[1]))
    fig, ax = plt.subplots(figsize=(6.6, height))
    im = ax.imshow(z.to_numpy(), aspect="auto", cmap="RdBu_r", vmin=-2.5, vmax=2.5)
    ax.set_xticks(range(z.shape[1]))
    ax.set_xticklabels(z.columns, rotation=45, ha="right", fontsize=8)
    if z.shape[0] <= 20:
        ax.set_yticks(range(z.shape[0]))
        ax.set_yticklabels([str(i) for i in z.index], fontsize=7)
    fig.colorbar(im, ax=ax, shrink=0.75, label="Z-score")
    ax.set_title("Heatmap (row-wise Z-score)", fontsize=12)

    return _fig_to_data_url(fig), {
        "chart": "heatmap",
        "rows": int(z.shape[0]),
        "columns": int(z.shape[1]),
        "column_names": [str(c) for c in z.columns][:20],
    }


def render_chart(
    df: pd.DataFrame, chart_type: str, instruction: str = ""
) -> tuple[str, dict, str]:
    """返回 (图片 dataURL, 统计结果, 实际使用的图表类型)。"""
    df.columns = [str(c).strip() for c in df.columns]
    if chart_type not in CHART_TYPES:
        chart_type = detect_chart_type(instruction, df)

    if chart_type == "volcano":
        image, stats = _render_volcano(df)
    elif chart_type in ("bar", "box", "violin"):
        image, stats = _render_grouped(df, chart_type)
    elif chart_type == "scatter":
        image, stats = _render_scatter(df)
    elif chart_type == "line":
        image, stats = _render_line(df)
    elif chart_type == "hist":
        image, stats = _render_hist(df)
    else:
        image, stats = _render_heatmap(df)

    return image, stats, chart_type


def load_table(filename: str, raw: bytes) -> pd.DataFrame:
    """按扩展名解析 CSV / Excel。"""
    name = filename.lower()
    if name.endswith((".xlsx", ".xls")):
        return pd.read_excel(io.BytesIO(raw))
    # 兼容 GBK 编码的中文 CSV
    for encoding in ("utf-8-sig", "gbk"):
        try:
            return pd.read_csv(io.BytesIO(raw), encoding=encoding)
        except UnicodeDecodeError:
            continue
    return pd.read_csv(io.BytesIO(raw), encoding="utf-8", errors="replace")


def parse_inline_csv(text: str) -> pd.DataFrame:
    """解析任务文本中的 CSV。"""
    return pd.read_csv(io.StringIO(text.strip()), encoding="utf-8")


NO_MODEL_NOTE = "（未配置模型，以下为程序统计结果）"


def fallback_interpretation(stats: dict) -> str:
    """无模型时的确定性解读，只陈述统计事实。"""
    chart = stats.get("chart", "")

    if chart == "volcano":
        return (
            f"{NO_MODEL_NOTE} 共纳入 {stats['total']} 个基因/特征，按 {stats['threshold']} 判定："
            f"上调 {stats['up']} 个、下调 {stats['down']} 个、无显著差异 {stats['ns']} 个。"
            "红点为上调、蓝点为下调、灰点为无显著差异。"
        )
    if chart in ("bar", "box", "violin"):
        groups = stats.get("groups", [])
        brief = "；".join(
            f"{g['name']}：n={g['n']}，均值 {g['mean']}，中位数 {g['median']}" for g in groups[:6]
        )
        return f"{NO_MODEL_NOTE} 按「{stats.get('group_by') or '整体'}」分组比较「{stats['value']}」：{brief}。"
    if chart == "scatter":
        r = stats.get("pearson_r")
        r_text = "无法计算" if r is None else f"r = {r}"
        return f"{NO_MODEL_NOTE} 「{stats['x']}」与「{stats['y']}」的 Pearson 相关系数 {r_text}，样本量 {stats['n']}。"
    if chart == "line":
        return (
            f"{NO_MODEL_NOTE} 「{stats['y']}」随「{stats['x']}」变化：起 {stats['first']}，止 {stats['last']}，"
            f"变化 {stats['change_pct']}%。"
        )
    if chart == "hist":
        return (
            f"{NO_MODEL_NOTE} 「{stats['column']}」分布：n={stats['n']}，均值 {stats['mean']}，"
            f"中位数 {stats['median']}，范围 {stats['min']} ~ {stats['max']}。"
        )
    return f"{NO_MODEL_NOTE} 热图展示 {stats['rows']} 行 × {stats['columns']} 列的标准化数值矩阵。"


def build_interpret_prompt(stats: dict, instruction: str) -> list[dict]:
    return [
        {
            "role": "system",
            "content": (
                "你是医学科研数据解读助手。根据给定的统计数据写一段简短解读（120-200 字）。\n"
                "要求：1) 只使用给定数字，不得编造；2) 说明图中可观察到的主要结论；"
                "3) 提醒统计显著不等于临床意义；4) 不要给出临床诊疗建议。"
            ),
        },
        {
            "role": "user",
            "content": f"用户需求：{instruction or '绘制并解读图表'}\n统计数据：{stats}",
        },
    ]


def safe_name(text: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fa5-]+", "_", text)[:40] or "chart"
