"""技能 3：实验设计。

输入核心文献（PMID）或课题描述 → 输出可开题方案：
实验分组、主实验 × 子实验、检测手段、预期结果（筛选标准）、统计与样本量。
方案由模型生成，但结构经代码校验；信息不足一律标注"需预实验确认"。
"""
from __future__ import annotations

import json
import re

from app.prompts.design import DESIGN_PROMPT
from app.services.llm import LLMError, complete, resolve_provider
from app.services.pubmed import fetch_article

MIN_EXPERIMENTS = 3
MAX_EXPERIMENTS = 8


def _extract_json(raw: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.S)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("方案生成失败，请重试")
    # strict=False 允许字符串内含换行等控制字符（模型常这样输出）
    return json.loads(text[start : end + 1], strict=False)


def _as_list(value) -> list:
    return value if isinstance(value, list) else []


def _normalize(data: dict) -> dict:
    """结构校验与补齐，避免前端渲染时字段缺失。"""
    experiments = []
    for exp in _as_list(data.get("experiments"))[:MAX_EXPERIMENTS]:
        if not isinstance(exp, dict) or not exp.get("name"):
            continue
        subs = []
        for sub in _as_list(exp.get("sub_experiments")):
            if not isinstance(sub, dict) or not sub.get("name"):
                continue
            subs.append(
                {
                    "name": str(sub.get("name")),
                    "method": str(sub.get("method") or "Not specified"),
                    "readout": str(sub.get("readout") or "Not specified"),
                    "expected": str(sub.get("expected") or "需预实验确认"),
                }
            )
        if not subs:
            continue
        experiments.append(
            {
                "name": str(exp.get("name")),
                "objective": str(exp.get("objective") or "Not specified"),
                "sub_experiments": subs,
                "controls": str(exp.get("controls") or "需补充对照设置"),
                "expected_conclusion": str(exp.get("expected_conclusion") or "需预实验确认"),
            }
        )

    if len(experiments) < MIN_EXPERIMENTS:
        raise ValueError("生成的实验数量不足（少于 3 个主实验），请补充课题信息后重试")

    return {
        "title": str(data.get("title") or "实验设计方案"),
        "hypothesis": str(data.get("hypothesis") or "Not specified"),
        "rationale": str(data.get("rationale") or "Not specified"),
        "groups": [
            {"name": str(g.get("name")), "description": str(g.get("description") or "")}
            for g in _as_list(data.get("groups"))
            if isinstance(g, dict) and g.get("name")
        ],
        "experiments": experiments,
        "statistics": str(data.get("statistics") or "需补充统计方法"),
        "sample_size": str(data.get("sample_size") or "需预实验确认"),
        "timeline": str(data.get("timeline") or "需按实际情况编排"),
        "risks": [str(r) for r in _as_list(data.get("risks")) if r],
    }


def _to_markdown(design: dict, seed: dict | None) -> str:
    lines = [f"# 实验设计方案：{design['title']}", ""]
    lines.append(f"**研究假设：** {design['hypothesis']}")
    lines.append("")
    lines.append(f"**设计依据：** {design['rationale']}")
    if seed:
        lines.append("")
        lines.append(f"**核心文献：** PMID {seed['pmid']} — {seed['title']}")
    lines.append("")

    if design["groups"]:
        lines.append("## 一、实验分组")
        lines.append("")
        lines.append("| 组别 | 处理方式 |")
        lines.append("| --- | --- |")
        for g in design["groups"]:
            lines.append(f"| {g['name']} | {g['description']} |")
        lines.append("")

    lines.append("## 二、实验方案")
    lines.append("")
    for i, exp in enumerate(design["experiments"], 1):
        lines.append(f"### 实验{i}：{exp['name']}")
        lines.append("")
        lines.append(f"**目的：** {exp['objective']}")
        lines.append("")
        for sub in exp["sub_experiments"]:
            lines.append(f"- **{sub['name']}**")
            lines.append(f"  - 方法：{sub['method']}")
            lines.append(f"  - 检测指标：{sub['readout']}")
            lines.append(f"  - 预期结果（筛选标准）：{sub['expected']}")
        lines.append("")
        lines.append(f"**对照设置：** {exp['controls']}")
        lines.append("")
        lines.append(f"**预期结论：** {exp['expected_conclusion']}")
        lines.append("")

    lines.append("## 三、样本量与统计方法")
    lines.append("")
    lines.append(f"- **样本量：** {design['sample_size']}")
    lines.append(f"- **统计方法：** {design['statistics']}")
    lines.append("")

    lines.append("## 四、进度安排")
    lines.append("")
    lines.append(design["timeline"])
    lines.append("")

    if design["risks"]:
        lines.append("## 五、风险与预案")
        lines.append("")
        for risk in design["risks"]:
            lines.append(f"- {risk}")
        lines.append("")

    lines.append("> 本方案为 AI 辅助生成的框架性建议，实验可行性、伦理与安全需经导师/课题组评审后执行。")
    return "\n".join(lines)


async def build_design(topic: str, pmid: str | None = None) -> dict:
    if resolve_provider() is None:
        raise ValueError("实验设计需要配置大模型 API Key，请先在 apps/ai/.env 配置后重试")

    topic = topic.strip()
    if len(topic) < 4:
        raise ValueError("请提供更具体的课题描述（至少 4 个字）")

    seed: dict | None = None
    user_content = f"课题方向：{topic}\n"
    if pmid:
        item, raw_text = await fetch_article(pmid)
        if item is None or not item.title.strip():
            raise ValueError(f"PMID {pmid} 不存在或无法获取")
        seed = {"pmid": pmid, "title": item.title, "journal": item.journal, "pubdate": item.pubdate}
        user_content += (
            f"\n核心文献（PMID {pmid}）：{item.title}\n"
            f"期刊：{item.journal}（{item.pubdate}）\n"
            f"摘要原文：\n{raw_text[:6000]}\n"
        )

    user_content += "\n请据此设计方案，严格按 JSON 格式输出。"

    try:
        raw = await complete(
            [
                {"role": "system", "content": DESIGN_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.4,
            max_tokens=6000,
        )
    except LLMError as err:
        raise ValueError(f"方案生成服务异常：{err}") from err

    try:
        design = _normalize(_extract_json(raw))
    except json.JSONDecodeError:
        # 首次输出被截断或格式非法：要求压缩描述后重试一次
        try:
            retry = await complete(
                [
                    {"role": "system", "content": DESIGN_PROMPT},
                    {
                        "role": "user",
                        "content": user_content
                        + "\n注意：上一次输出不是完整合法的 JSON。请精简每个子实验的描述（每条不超过 40 字），"
                        "确保输出完整、可解析的 JSON。",
                    },
                ],
                temperature=0.2,
                max_tokens=6000,
            )
            design = _normalize(_extract_json(retry))
        except (json.JSONDecodeError, LLMError) as err:
            raise ValueError("方案生成失败：模型输出格式异常，请稍后重试") from err
    warnings = []
    if not seed:
        warnings.append("未提供核心文献，方案依据为通用领域知识，建议补充 1 篇核心文献后重生成")

    return {
        "title": design["title"],
        "markdown": _to_markdown(design, seed),
        "design": design,
        "seed": seed,
        "stats": {
            "experiments": len(design["experiments"]),
            "sub_experiments": sum(len(e["sub_experiments"]) for e in design["experiments"]),
            "groups": len(design["groups"]),
        },
        "warnings": warnings,
    }
