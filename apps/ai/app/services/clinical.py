"""技能 4：临床方案设计。

输入临床问题（可附核心文献）→ 输出国自然/伦理申报常用结构的方案：
PICO、立项依据、设计、纳排标准、干预、结局、样本量、统计、伦理。
"""
from __future__ import annotations

import json

from app.prompts.clinical import CLINICAL_PROMPT
from app.services.json_utils import extract_json
from app.services.llm import LLMError, complete, resolve_provider
from app.services.pubmed import fetch_article


def _as_list(value) -> list:
    return value if isinstance(value, list) else []


def _normalize(data: dict) -> dict:
    pico = data.get("pico") if isinstance(data.get("pico"), dict) else {}
    design = data.get("design") if isinstance(data.get("design"), dict) else {}
    population = data.get("population") if isinstance(data.get("population"), dict) else {}
    outcomes = data.get("outcomes") if isinstance(data.get("outcomes"), dict) else {}
    statistics = data.get("statistics") if isinstance(data.get("statistics"), dict) else {}
    ethics = data.get("ethics") if isinstance(data.get("ethics"), dict) else {}

    primary = [
        {
            "name": str(o.get("name")),
            "measure": str(o.get("measure") or "需补充"),
            "timepoint": str(o.get("timepoint") or "需补充"),
        }
        for o in _as_list(outcomes.get("primary"))
        if isinstance(o, dict) and o.get("name")
    ]
    if not primary:
        raise ValueError("方案生成失败：缺少主要结局指标")

    inclusion = [str(x) for x in _as_list(population.get("inclusion")) if x]
    exclusion = [str(x) for x in _as_list(population.get("exclusion")) if x]
    if not inclusion:
        raise ValueError("方案生成失败：缺少纳入标准")

    return {
        "title": str(data.get("title") or "临床研究方案"),
        "study_type": str(data.get("study_type") or "待明确"),
        "pico": {
            "population": str(pico.get("population") or "需补充"),
            "intervention": str(pico.get("intervention") or "需补充"),
            "comparison": str(pico.get("comparison") or "需补充"),
            "outcome": str(pico.get("outcome") or "需补充"),
        },
        "background": str(data.get("background") or "需补充"),
        "objectives": [str(o) for o in _as_list(data.get("objectives")) if o],
        "design": {
            "setting": str(design.get("setting") or "需补充"),
            "duration": str(design.get("duration") or "需补充"),
            "randomization": str(design.get("randomization") or "不适用"),
            "blinding": str(design.get("blinding") or "不适用"),
        },
        "population": {"inclusion": inclusion, "exclusion": exclusion},
        "interventions": [
            {"group": str(i.get("group")), "detail": str(i.get("detail") or "")}
            for i in _as_list(data.get("interventions"))
            if isinstance(i, dict) and i.get("group")
        ],
        "outcomes": {
            "primary": primary,
            "secondary": [
                {
                    "name": str(o.get("name")),
                    "measure": str(o.get("measure") or "需补充"),
                    "timepoint": str(o.get("timepoint") or "需补充"),
                }
                for o in _as_list(outcomes.get("secondary"))
                if isinstance(o, dict) and o.get("name")
            ],
        },
        "statistics": {
            "sample_size": str(statistics.get("sample_size") or "需补充"),
            "primary_analysis": str(statistics.get("primary_analysis") or "需补充"),
            "subgroup": str(statistics.get("subgroup") or "无"),
            "missing_data": str(statistics.get("missing_data") or "需补充"),
        },
        "ethics": {
            "approval": str(ethics.get("approval") or "需经伦理委员会审批"),
            "consent": str(ethics.get("consent") or "需补充"),
            "data_protection": str(ethics.get("data_protection") or "需补充"),
            "registration": str(ethics.get("registration") or "如适用需注册"),
        },
        "timeline": [str(t) for t in _as_list(data.get("timeline")) if t],
        "risks": [str(r) for r in _as_list(data.get("risks")) if r],
    }


def _to_markdown(plan: dict, seed: dict | None) -> str:
    lines = [f"# 临床研究方案：{plan['title']}", ""]
    lines.append(f"**研究类型：** {plan['study_type']}")
    if seed:
        lines.append(f"**核心文献：** PMID {seed['pmid']} — {seed['title']}")
    lines.append("")

    lines.append("## 一、研究问题（PICO）")
    lines.append("")
    lines.append("| 要素 | 内容 |")
    lines.append("| --- | --- |")
    lines.append(f"| 人群 (P) | {plan['pico']['population']} |")
    lines.append(f"| 干预/暴露 (I) | {plan['pico']['intervention']} |")
    lines.append(f"| 对照 (C) | {plan['pico']['comparison']} |")
    lines.append(f"| 结局 (O) | {plan['pico']['outcome']} |")
    lines.append("")

    lines.append("## 二、立项依据")
    lines.append("")
    lines.append(plan["background"])
    lines.append("")

    if plan["objectives"]:
        lines.append("## 三、研究目标")
        lines.append("")
        for i, obj in enumerate(plan["objectives"], 1):
            lines.append(f"{i}. {obj}")
        lines.append("")

    d = plan["design"]
    lines.append("## 四、研究设计与实施")
    lines.append("")
    lines.append(f"- **研究场所：** {d['setting']}")
    lines.append(f"- **研究周期：** {d['duration']}")
    lines.append(f"- **随机化：** {d['randomization']}")
    lines.append(f"- **盲法：** {d['blinding']}")
    lines.append("")

    lines.append("## 五、研究对象")
    lines.append("")
    lines.append("**纳入标准：**")
    lines.append("")
    for x in plan["population"]["inclusion"]:
        lines.append(f"- {x}")
    lines.append("")
    if plan["population"]["exclusion"]:
        lines.append("**排除标准：**")
        lines.append("")
        for x in plan["population"]["exclusion"]:
            lines.append(f"- {x}")
        lines.append("")

    if plan["interventions"]:
        lines.append("## 六、干预/暴露与对照")
        lines.append("")
        lines.append("| 组别 | 内容 |")
        lines.append("| --- | --- |")
        for g in plan["interventions"]:
            lines.append(f"| {g['group']} | {g['detail']} |")
        lines.append("")

    lines.append("## 七、结局指标")
    lines.append("")
    lines.append("**主要结局：**")
    lines.append("")
    lines.append("| 指标 | 测量方法 | 评价时点 |")
    lines.append("| --- | --- | --- |")
    for o in plan["outcomes"]["primary"]:
        lines.append(f"| {o['name']} | {o['measure']} | {o['timepoint']} |")
    lines.append("")
    if plan["outcomes"]["secondary"]:
        lines.append("**次要结局：**")
        lines.append("")
        lines.append("| 指标 | 测量方法 | 评价时点 |")
        lines.append("| --- | --- | --- |")
        for o in plan["outcomes"]["secondary"]:
            lines.append(f"| {o['name']} | {o['measure']} | {o['timepoint']} |")
        lines.append("")

    s = plan["statistics"]
    lines.append("## 八、样本量与统计分析")
    lines.append("")
    lines.append(f"- **样本量估算：** {s['sample_size']}")
    lines.append(f"- **主要分析：** {s['primary_analysis']}")
    lines.append(f"- **亚组分析：** {s['subgroup']}")
    lines.append(f"- **缺失数据：** {s['missing_data']}")
    lines.append("")

    e = plan["ethics"]
    lines.append("## 九、伦理与数据保护")
    lines.append("")
    lines.append(f"- **伦理审批：** {e['approval']}")
    lines.append(f"- **知情同意：** {e['consent']}")
    lines.append(f"- **数据保护：** {e['data_protection']}")
    lines.append(f"- **注册：** {e['registration']}")
    lines.append("")

    if plan["timeline"]:
        lines.append("## 十、进度安排")
        lines.append("")
        for t in plan["timeline"]:
            lines.append(f"- {t}")
        lines.append("")

    if plan["risks"]:
        lines.append("## 十一、风险与应对")
        lines.append("")
        for r in plan["risks"]:
            lines.append(f"- {r}")
        lines.append("")

    lines.append("> 本方案为 AI 辅助生成的框架建议，需经研究者、统计学专家与伦理委员会评审后方可实施。")
    return "\n".join(lines)


async def build_clinical(topic: str, pmid: str | None = None) -> dict:
    if resolve_provider() is None:
        raise ValueError("临床方案设计需要配置大模型 API Key，请先在 apps/ai/.env 配置后重试")

    topic = topic.strip()
    if len(topic) < 4:
        raise ValueError("请提供更具体的临床研究问题（至少 4 个字）")

    seed: dict | None = None
    user_content = f"临床研究问题：{topic}\n"
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
                {"role": "system", "content": CLINICAL_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.3,
            max_tokens=6000,
        )
    except LLMError as err:
        raise ValueError(f"方案生成服务异常：{err}") from err

    try:
        plan = _normalize(extract_json(raw))
    except (json.JSONDecodeError, ValueError):
        try:
            retry = await complete(
                [
                    {"role": "system", "content": CLINICAL_PROMPT},
                    {
                        "role": "user",
                        "content": user_content
                        + "\n注意：上一次输出不是完整合法的 JSON。请精简每条描述（不超过 50 字），确保输出完整可解析。",
                    },
                ],
                temperature=0.2,
                max_tokens=6000,
            )
            plan = _normalize(extract_json(retry))
        except (json.JSONDecodeError, ValueError, LLMError) as err:
            raise ValueError("方案生成失败：模型输出格式异常，请稍后重试") from err

    warnings = []
    if not seed:
        warnings.append("未提供核心文献，立项依据基于通用领域知识，建议补充 1 篇核心文献后重生成")

    return {
        "title": plan["title"],
        "study_type": plan["study_type"],
        "markdown": _to_markdown(plan, seed),
        "plan": plan,
        "seed": seed,
        "stats": {
            "primary_outcomes": len(plan["outcomes"]["primary"]),
            "secondary_outcomes": len(plan["outcomes"]["secondary"]),
            "inclusion": len(plan["population"]["inclusion"]),
            "exclusion": len(plan["population"]["exclusion"]),
        },
        "warnings": warnings,
    }
