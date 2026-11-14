"""技能 5：综述写作流水线。

对齐解螺旋原文的六步：大纲构建 → 主题检索建库 → 分章写作 → 章节校验
→ 合并定稿 → 引用格式化。

关键约束：引用必须来自 PubMed 真实检索到的文献库，成稿后统一校验并重编号，
杜绝"看起来很真的假引用"。
"""
from __future__ import annotations

import json
import re

from app.prompts.review import ABSTRACT_PROMPT, OUTLINE_PROMPT, SECTION_PROMPT, format_library
from app.services.llm import LLMError, complete, resolve_provider
from app.services.pubmed import search_literature

MAX_SECTIONS = 5
CITATION_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")


def _extract_json(raw: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.S)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("大纲生成失败，请重试")
    return json.loads(text[start : end + 1])


async def _outline(topic: str) -> dict:
    raw = await complete(
        [
            {"role": "system", "content": OUTLINE_PROMPT},
            {"role": "user", "content": f"综述主题：{topic}"},
        ],
        temperature=0.3,
        max_tokens=1200,
    )
    data = _extract_json(raw)
    sections = [s for s in data.get("sections", []) if s.get("heading")][:MAX_SECTIONS]
    queries = [q for q in data.get("queries", []) if isinstance(q, str) and q.strip()][:4]
    if not sections:
        raise ValueError("大纲生成失败：没有有效章节")
    if not queries:
        queries = [topic]
    return {
        "title": str(data.get("title") or topic).strip(),
        "sections": sections,
        "queries": queries,
    }


async def _build_library(queries: list[str], max_refs: int, years: int) -> list[dict]:
    """多路检索 + PMID 去重，形成写作文献库。"""
    library: list[dict] = []
    seen: set[str] = set()
    per_query = max(6, max_refs // max(1, len(queries)))

    for query in queries:
        try:
            result = await search_literature(query, limit=per_query, years=years)
        except Exception:  # noqa: BLE001 - 单路检索失败不阻断整体
            continue
        for item in result.get("items", []):
            pmid = str(item.get("pmid", ""))
            if not pmid or pmid in seen:
                continue
            seen.add(pmid)
            library.append(item)
            if len(library) >= max_refs:
                return library

    return library


async def _write_section(topic: str, section: dict, library: list[dict]) -> str:
    points = section.get("points") or []
    user = (
        f"综述主题：{topic}\n"
        f"本章节标题：{section['heading']}\n"
        f"需覆盖要点：{'；'.join(map(str, points)) if points else '按标题合理组织'}\n"
        "请撰写本章节正文。"
    )
    text = await complete(
        [
            {"role": "system", "content": SECTION_PROMPT.replace("{library}", format_library(library))},
            {"role": "user", "content": user},
        ],
        temperature=0.4,
        max_tokens=1600,
    )
    return text.strip()


async def _write_abstract(body: str) -> str:
    text = await complete(
        [
            {"role": "system", "content": ABSTRACT_PROMPT},
            {"role": "user", "content": body[:6000]},
        ],
        temperature=0.3,
        max_tokens=400,
    )
    return text.strip()


def _renumber(markdown: str, library: list[dict]) -> tuple[str, list[dict], int]:
    """校验引用编号、剔除越界引用，并按首次出现顺序重编号。"""
    mapping: dict[int, int] = {}
    ordered: list[dict] = []

    def replace(match: re.Match) -> str:
        nums = [int(n) for n in match.group(1).replace(" ", "").split(",")]
        kept = []
        for n in nums:
            if 1 <= n <= len(library):
                if n not in mapping:
                    mapping[n] = len(ordered) + 1
                    ordered.append(library[n - 1])
                kept.append(mapping[n])
        if not kept:
            return ""  # 全部越界：删除该引用标记，避免假引用
        return "[" + ",".join(str(n) for n in dict.fromkeys(kept)) + "]"

    cleaned = CITATION_RE.sub(replace, markdown)
    cleaned = re.sub(r"([。．.!?？])\1+", r"\1", cleaned)
    return cleaned, ordered, len(mapping)


def format_reference(index: int, item: dict, style: str) -> str:
    authors = (item.get("authors") or "Not specified").rstrip(".")
    title = (item.get("title") or "").rstrip(".")
    journal = item.get("journal") or ""
    year = (item.get("pubdate") or "").split(" ")[0]
    volume = item.get("volume") or ""
    issue = item.get("issue") or ""
    pages = item.get("pages") or ""
    doi = item.get("doi")

    if style == "vancouver":
        locator = f"{year}"
        if volume:
            locator += f";{volume}"
            if issue:
                locator += f"({issue})"
            if pages:
                locator += f":{pages}"
        tail = f" doi:{doi}" if doi else ""
        return f"{index}. {authors}. {title}. {journal}. {locator}.{tail}"

    # 默认 GB/T 7714（中文期刊常用）
    locator = year
    if volume:
        locator += f", {volume}"
        if issue:
            locator += f"({issue})"
        if pages:
            locator += f": {pages}"
    tail = f" DOI: {doi}." if doi else "."
    return f"[{index}] {authors}. {title}[J]. {journal}, {locator}.{tail}"


def _word_count(text: str) -> int:
    chinese = len(re.findall(r"[\u4e00-\u9fa5]", text))
    english = len(re.findall(r"[A-Za-z]+", text))
    return chinese + english


async def build_review(
    topic: str,
    max_refs: int = 40,
    years: int = 10,
    citation_style: str = "gb7714",
    sections: int | None = None,
) -> dict:
    if resolve_provider() is None:
        raise ValueError("综述写作需要配置大模型 API Key，请先在 apps/ai/.env 配置后重试")

    topic = topic.strip()
    if len(topic) < 4:
        raise ValueError("请提供更具体的综述主题（至少 4 个字）")

    outline = await _outline(topic)
    if sections:
        outline["sections"] = outline["sections"][: max(2, min(sections, MAX_SECTIONS))]

    library = await _build_library(outline["queries"], max_refs, years)
    if not library:
        raise ValueError("没有检索到相关文献，请调整主题关键词后重试")

    parts: list[str] = []
    try:
        for section in outline["sections"]:
            body = await _write_section(topic, section, library)
            parts.append(f"## {section['heading']}\n\n{body}")
    except LLMError as err:
        raise ValueError(f"写作服务异常：{err}") from err

    body_text = "\n\n".join(parts)

    try:
        abstract = await _write_abstract(body_text)
    except LLMError:
        abstract = ""

    cleaned_body, cited, cited_count = _renumber(body_text, library)

    refs = [format_reference(i, item, citation_style) for i, item in enumerate(cited, 1)]
    warnings: list[str] = []
    if cited_count == 0:
        warnings.append("本章初稿未产生有效引用，请检查文献库是否覆盖该主题")
    if cited_count < 8:
        warnings.append(f"有效引用仅 {cited_count} 篇，建议扩大检索年限或补充关键词")
    uncited = len(library) - cited_count
    if uncited > len(library) * 0.5:
        warnings.append(f"文献库有 {uncited} 篇未被引用，成稿前建议人工筛除或补充论述")

    markdown = f"# {outline['title']}\n\n"
    if abstract:
        markdown += f"**摘要：** {abstract}\n\n"
    markdown += cleaned_body
    if refs:
        markdown += "\n\n## 参考文献\n\n" + "\n".join(refs)

    return {
        "title": outline["title"],
        "markdown": markdown,
        "abstract": abstract,
        "outline": [
            {"heading": s["heading"], "points": s.get("points", [])} for s in outline["sections"]
        ],
        "references": [
            {
                "index": i,
                "pmid": item["pmid"],
                "title": item["title"],
                "journal": item["journal"],
                "pubdate": item["pubdate"],
                "url": item["url"],
            }
            for i, item in enumerate(cited, 1)
        ],
        "stats": {
            "word_count": _word_count(markdown),
            "library_size": len(library),
            "references": len(cited),
            "sections": len(outline["sections"]),
            "citation_style": citation_style,
            "years": years,
        },
        "warnings": warnings,
    }
