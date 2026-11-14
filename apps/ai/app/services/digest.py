"""技能 2：文献解读。

对齐解螺旋原文的两条硬约束：
1. 只认原文——所有字段只能来自 PubMed 摘要，原文没有的写 "Not specified"；
2. 不添油加醋——模型不得引入摘要之外的文献、数据或结论。
摘要原文同时回传给医生核对，便于发现模型误读。
"""
from __future__ import annotations

import json
import re

from app.prompts.digest import DIGEST_PROMPT
from app.services.llm import LLMError, complete, resolve_provider
from app.services.pubmed import fetch_article

SECTIONS: list[tuple[str, str]] = [
    ("background", "研究背景"),
    ("design", "实验设计"),
    ("results", "核心结果"),
    ("discussion", "讨论逻辑"),
    ("limitations", "局限性"),
]

NOT_SPECIFIED = "Not specified"


def _parse_sections(raw: str) -> tuple[dict[str, str], bool]:
    """解析模型 JSON；失败则退回单段原文拆解（不丢内容）。"""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.S)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return {}, False

    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return {}, False

    return {k: str(data.get(k, NOT_SPECIFIED)).strip() or NOT_SPECIFIED for k, _ in SECTIONS}, True


async def digest_pmid(pmid: str) -> dict:
    """解读一篇 PubMed 文献，返回结构化拆解。"""
    item, raw_text = await fetch_article(pmid)

    if item is None or not item.title.strip():
        raise ValueError("PMID 不存在或无法获取")

    # 无效 PMID 时 efetch 只返回序号（如 "1."），需按长度与内容双重判断
    if len(raw_text) < 100 or "No abstract available" in raw_text:
        raise ValueError("该文献没有公开摘要，请提供 PDF 全文后再解读")

    base = {
        "pmid": pmid,
        "title": item.title,
        "meta": {
            "authors": item.authors,
            "journal": item.journal,
            "pubdate": item.pubdate,
            "pubtype": item.pubtype,
            "doi": item.doi,
            "oa": item.oa,
            "url": item.url,
        },
        "evidence": raw_text[:6000],
    }

    # 无模型时不做解读，只回传原文（绝不用规则硬凑结论）
    if resolve_provider() is None:
        return {
            **base,
            "mode": "abstract_only",
            "sections": [
                {"key": "raw", "label": "原文摘要（未配置模型，暂不做结构化解读）", "content": raw_text[:6000]}
            ],
        }

    try:
        raw = await complete(
            [
                {"role": "system", "content": DIGEST_PROMPT},
                {"role": "user", "content": raw_text[:12000]},
            ],
            temperature=0.1,
            max_tokens=1800,
        )
    except LLMError as err:
        raise ValueError(f"解读服务暂时不可用：{err}") from err

    parsed, ok = _parse_sections(raw)
    if not ok:
        return {
            **base,
            "mode": "abstract_only",
            "sections": [{"key": "raw", "label": "原文摘要（结构化解拆失败，已回传原文）", "content": raw_text[:6000]}],
        }

    return {
        **base,
        "mode": "structured",
        "sections": [{"key": k, "label": label, "content": parsed[k]} for k, label in SECTIONS],
    }
