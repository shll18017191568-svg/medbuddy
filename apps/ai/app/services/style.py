"""技能 7：文风改写。

同一份医学事实，按目标读者换一种说法。模型负责改写，
代码负责事实保真校验（数值不得丢失）与合规提示落地。
"""
from __future__ import annotations

import re
from collections import Counter

from app.prompts.style import COMMON_RULES, STYLE_PROMPT, build_user_prompt
from app.services.json_utils import extract_json
from app.services.llm import LLMError, complete, resolve_provider

STYLES: dict[str, dict[str, str]] = {
    "academic": {"label": "学术论文", "audience": "同行医生"},
    "popular": {"label": "医学科普", "audience": "大众读者"},
    "patient": {"label": "患者沟通", "audience": "患者与家属"},
    "social": {"label": "新媒体", "audience": "大众读者"},
    "official": {"label": "院务公文", "audience": "院内管理层"},
    "report": {"label": "工作汇报", "audience": "科室/院领导"},
}

DEFAULT_COMPLIANCE = "改写仅调整表达方式，不改变医学结论；正式发布前请由本人复核。"

_NUM = re.compile(r"\d+(?:\.\d+)?")
_PREAMBLE = re.compile(r"^(?:以下是|下面是|改写如下|改写后)[^。\n]{0,24}[：:]\s*\n?")


def detect_style(text: str) -> str:
    t = (text or "").lower()
    if any(k in t for k in ["小红书", "抖音", "短视频", "朋友圈", "视频号", "爆款"]):
        return "social"
    if any(k in t for k in ["患者", "家属", "患教", "沟通", "知情同意"]):
        return "patient"
    if any(k in t for k in ["通知", "请示", "制度", "院办", "公文", "函件"]):
        return "official"
    if any(k in t for k in ["汇报", "述职", "季度", "工作总结", "ppt"]):
        return "report"
    if any(k in t for k in ["摘要", "方法", "结果", "讨论", "参考文献", "论文"]):
        return "academic"
    return "popular"


def detect_length(text: str) -> str:
    t = (text or "").lower()
    if any(k in t for k in ["精简", "压缩", "缩短", "不要超过", "一半"]):
        return "精简（约为原文 60% 篇幅）"
    if any(k in t for k in ["扩写", "详细", "展开", "多写"]):
        return "扩写（约为原文 130% 篇幅）"
    return "与原文篇幅相当"


def _normalize(text: str) -> str:
    """去掉数字与单位之间的空格，便于数值比对（5 mg 与 5mg 视为一致）。"""
    return re.sub(r"\s+", "", text)


def _numbers(text: str) -> Counter:
    return Counter(_NUM.findall(_normalize(text)))


def _word_count(text: str) -> int:
    chinese = len(re.findall(r"[\u4e00-\u9fa5]", text))
    english = len(re.findall(r"[A-Za-z]+", text))
    return chinese + english


def _clean(text: str) -> str:
    return _PREAMBLE.sub("", (text or "").strip()).strip()


def _normalize_result(data: dict) -> dict:
    rewritten = _clean(str(data.get("rewritten") or ""))
    if len(rewritten) < 20:
        raise ValueError("改写失败：模型未返回有效正文，请稍后重试")

    changes = []
    for c in data.get("changes") or []:
        if not isinstance(c, dict) or not c.get("before") or not c.get("after"):
            continue
        changes.append(
            {
                "before": str(c["before"]).strip()[:60],
                "after": str(c["after"]).strip()[:60],
                "reason": str(c.get("reason") or "").strip()[:80],
            }
        )

    return {
        "title": str(data.get("title") or "").strip(),
        "rewritten": rewritten,
        "changes": changes[:8],
        "facts_preserved": bool(data.get("facts_preserved", True)),
        "compliance_notes": [str(x) for x in (data.get("compliance_notes") or []) if x][:6],
    }


def _fact_warnings(original: str, rewritten: str) -> tuple[list[str], int, int]:
    """数值保真校验：原文数值在改写后必须全部保留。"""
    src, dst = _numbers(original), _numbers(rewritten)
    missing = list((src - dst).elements())
    kept = sum(min(src[n], dst[n]) for n in src)
    warnings: list[str] = []
    if missing:
        preview = "、".join(dict.fromkeys(missing))
        warnings.append(f"改写后未保留原文数值：{preview}（请人工核对是否被删改）")
    return warnings, sum(src.values()), kept


def _to_markdown(result: dict, req: dict, stats: dict, warnings: list[str]) -> str:
    heading = result["title"] or f"{req['style_label']}改写稿"
    lines = [f"# {heading}", ""]
    lines.append(f"> 目标文风：{req['style_label']} · 目标读者：{req['audience']} · {req['length']}")
    lines.append("")
    lines.append("## 改写结果")
    lines.append("")
    for para in result["rewritten"].split("\n"):
        lines.append(para.strip())
        lines.append("")

    if result["changes"]:
        lines.append("## 修改说明")
        lines.append("")
        lines.append("| 原文 | 改为 | 原因 |")
        lines.append("| --- | --- | --- |")
        for c in result["changes"]:
            lines.append(
                f"| {c['before'].replace('|', '／')} | {c['after'].replace('|', '／')} | "
                f"{c['reason'].replace('|', '／')} |"
            )
        lines.append("")

    lines.append("## 事实核对")
    lines.append("")
    lines.append(
        f"- 原文字数 {stats['original_chars']} → 改写字数 {stats['rewritten_chars']}"
        f"（{stats['ratio']} 倍）"
    )
    lines.append(f"- 原文数值 {stats['numbers_total']} 个，改写后保留 {stats['numbers_kept']} 个")
    lines.append(f"- 模型自检：{'已完整保留原文事实' if result['facts_preserved'] else '可能存在事实偏差，需重点复核'}")
    lines.append("")

    lines.append("## 合规提示")
    lines.append("")
    for note in result["compliance_notes"] or [DEFAULT_COMPLIANCE]:
        lines.append(f"- {note}")
    if DEFAULT_COMPLIANCE not in result["compliance_notes"]:
        lines.append(f"- {DEFAULT_COMPLIANCE}")
    if warnings:
        lines.append("")
        lines.append("## 需要人工确认")
        lines.append("")
        for w in warnings:
            lines.append(f"- {w}")
    return "\n".join(lines)


async def build_rewrite(
    text: str,
    style: str | None = None,
    audience: str | None = None,
    length: str | None = None,
) -> dict:
    if resolve_provider() is None:
        raise ValueError("文风改写需要配置大模型 API Key，请先在 apps/ai/.env 配置后重试")

    text = (text or "").strip()
    if len(text) < 50:
        raise ValueError("请提供至少 50 字的原文（可附一句「改成患者能看懂的版本」）")

    key = style if style in STYLES else detect_style(text)
    target = STYLES[key]
    req = {
        "style": key,
        "style_label": target["label"],
        "audience": audience or target["audience"],
        "length": length or detect_length(text),
    }
    user_content = build_user_prompt(text, req["style_label"], req["audience"], req["length"], "")

    try:
        raw = await complete(
            [
                {"role": "system", "content": STYLE_PROMPT.replace("{common}", COMMON_RULES)},
                {"role": "user", "content": user_content},
            ],
            temperature=0.5,
            max_tokens=6000,
        )
    except LLMError as err:
        raise ValueError(f"改写服务异常：{err}") from err

    try:
        result = _normalize_result(extract_json(raw))
    except Exception:  # noqa: BLE001 - 任何解析问题都走「精简重试一次」
        try:
            retry = await complete(
                [
                    {"role": "system", "content": STYLE_PROMPT.replace("{common}", COMMON_RULES)},
                    {
                        "role": "user",
                        "content": user_content + "\n注意：上次输出不是完整合法的 JSON，请精简输出确保完整可解析。",
                    },
                ],
                temperature=0.4,
                max_tokens=6000,
            )
            result = _normalize_result(extract_json(retry))
        except Exception as err2:  # noqa: BLE001
            raise ValueError("改写失败：模型输出格式异常，请稍后重试") from err2

    warnings, total, kept = _fact_warnings(text, result["rewritten"])
    original_chars = _word_count(text)
    rewritten_chars = _word_count(result["rewritten"])
    ratio = round(rewritten_chars / original_chars, 2) if original_chars else 0

    if ratio and ratio < 0.5:
        warnings.append("改写后篇幅不足原文一半，可能过度删减，请核对是否漏掉要点")
    if ratio > 2.5:
        warnings.append("改写后篇幅超过原文 2.5 倍，可能新增了原文没有的内容，请核对事实")
    if not result["facts_preserved"]:
        warnings.append("模型自检报告未完整保留原文事实，请逐条核对后再使用")

    stats = {
        "style": key,
        "style_label": req["style_label"],
        "original_chars": original_chars,
        "rewritten_chars": rewritten_chars,
        "ratio": ratio,
        "numbers_total": total,
        "numbers_kept": kept,
        "changes": len(result["changes"]),
    }

    return {
        "title": result["title"] or f"{req['style_label']}改写稿",
        "style": key,
        "style_label": req["style_label"],
        "audience": req["audience"],
        "rewritten": result["rewritten"],
        "changes": result["changes"],
        "markdown": _to_markdown(result, req, stats, warnings),
        "stats": stats,
        "warnings": warnings,
    }
