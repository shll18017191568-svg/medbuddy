"""PubMed 文献检索（E-utilities）。

技能 1 的事实底座（对齐解螺旋原文：检索类技能直连权威数据库，不靠模型脑补）：
- esearch 拿 PMID 列表 → esummary 拿元数据，全部来自 NCBI 真实数据；
- 大模型只负责"把医生的大白话翻译成检索式"，不产出任何文献内容；
- 无模型 Key 时退化为原始关键词检索，仍可返回真实结果。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime

import httpx

from app.core.config import settings
from app.services.llm import LLMError, complete, resolve_provider

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

QUERY_PROMPT = """你是 PubMed 检索专家。请把医生的自然语言需求转换为 PubMed 检索式。

规则：
1. 使用 MeSH 主题词 + 自由词，字段标签用 [Title/Abstract] 或 [MeSH Terms]；
2. 多个概念用 AND 连接，同义词用 OR 加括号；
3. 用户提到"综述/Review"时加 (review[Publication Type] OR systematic review[Publication Type])；
4. 用户提到"排除 Letter/Editorial"时加 NOT (letter[Publication Type] OR editorial[Publication Type])；
5. 不要添加任何年份或日期限制（年份由系统统一处理）；
6. 只输出检索式本身，不要任何解释、不要 Markdown、不要引号包裹。

示例输入：铁死亡在肿瘤免疫中作用的近3年高质量综述
示例输出：(ferroptosis[Title/Abstract] OR ferroptosis[MeSH Terms]) AND (tumor immunity[Title/Abstract] OR neoplasms[MeSH Terms]) AND (review[Publication Type] OR systematic review[Publication Type])"""


@dataclass
class LiteratureItem:
    pmid: str
    title: str
    authors: str
    journal: str
    pubdate: str
    pubtype: str
    doi: str | None
    pmc: str | None
    oa: bool
    url: str


def _params() -> dict:
    p = {"tool": "medbuddy", "retmode": "json"}
    if settings.pubmed_api_key:
        p["api_key"] = settings.pubmed_api_key
    if settings.pubmed_email:
        p["email"] = settings.pubmed_email
    return p


async def translate_query(text: str) -> tuple[str, bool]:
    """把自然语言转成 PubMed 检索式。返回 (检索式, 是否由模型翻译)。"""
    # 无模型时直接用原始描述检索（PubMed 能处理自然语言词组）
    if resolve_provider() is None:
        return text.strip(), False

    try:
        raw = await complete(
            [
                {"role": "system", "content": QUERY_PROMPT},
                {"role": "user", "content": text.strip()},
            ],
            temperature=0,
            max_tokens=400,
        )
    except LLMError:
        return text.strip(), False

    query = raw.strip()
    query = re.sub(r"^```.*?\n|```$", "", query, flags=re.S).strip()
    # 兜底剔除模型自带的日期限制（年份由 esearch 参数统一控制）
    query = re.sub(r"\s*AND\s*\(\s*\"\d{4}\"[^)]*\)", "", query)
    query = re.sub(r"\s*AND\s*\(\s*\"\d{4}\"\s*\[\s*Date[^)]*\)", "", query)
    query = query.strip().strip("\"'“”` \n")
    return (query[:800] or text.strip()), True


async def _esearch(client: httpx.AsyncClient, query: str, limit: int, years: int | None) -> list[str]:
    params = {**_params(), "db": "pubmed", "term": query, "retmax": str(limit), "sort": "relevance"}
    if years:
        current = datetime.now().year
        params.update(
            {
                "datetype": "pdat",
                "mindate": str(current - years),
                "maxdate": str(current),
            }
        )
    resp = await client.get(f"{EUTILS}/esearch.fcgi", params=params)
    resp.raise_for_status()
    return resp.json().get("esearchresult", {}).get("idlist", [])


async def _esummary(client: httpx.AsyncClient, pmids: list[str]) -> list[LiteratureItem]:
    if not pmids:
        return []

    resp = await client.get(
        f"{EUTILS}/esummary.fcgi",
        params={**_params(), "db": "pubmed", "id": ",".join(pmids)},
    )
    resp.raise_for_status()
    result = resp.json().get("result", {})

    items: list[LiteratureItem] = []
    for pmid in pmids:  # 保持 esearch 的相关性排序
        doc = result.get(pmid)
        if not doc:
            continue

        authors = [a.get("name", "") for a in doc.get("authors", []) if a.get("name")]
        author_str = ", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "")

        ids = {a.get("idtype"): a.get("value") for a in doc.get("articleids", [])}
        pmc = ids.get("pmc")
        doi = ids.get("doi")
        pubtype_list = doc.get("pubtype") or []

        items.append(
            LiteratureItem(
                pmid=pmid,
                title=(doc.get("title") or "").rstrip("."),
                authors=author_str or "Not specified",
                journal=doc.get("fulljournalname") or doc.get("source") or "Not specified",
                pubdate=doc.get("pubdate") or "Not specified",
                pubtype=", ".join(pubtype_list) if pubtype_list else "Not specified",
                doi=doi,
                pmc=pmc,
                oa=bool(pmc),
                url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            )
        )
    return items


async def search_literature(
    text: str,
    limit: int = 10,
    years: int | None = 5,
) -> dict:
    """完整检索流程：翻译 → esearch → esummary。"""
    query, translated = await translate_query(text)

    async with httpx.AsyncClient(timeout=settings.pubmed_timeout) as client:
        pmids = await _esearch(client, query, min(max(limit, 1), 30), years)
        items = await _esummary(client, pmids)

    return {
        "query": query,
        "translated": translated,
        "count": len(items),
        "years": years,
        "items": [item.__dict__ for item in items],
    }


async def fetch_article(pmid: str) -> tuple[LiteratureItem | None, str]:
    """按 PMID 取元数据 + 摘要原文（供文献解读技能使用）。"""
    async with httpx.AsyncClient(timeout=settings.pubmed_timeout) as client:
        items = await _esummary(client, [pmid])
        resp = await client.get(
            f"{EUTILS}/efetch.fcgi",
            params={**_params(), "db": "pubmed", "id": pmid, "rettype": "abstract", "retmode": "text"},
        )
        raw = resp.text if resp.status_code == 200 else ""

    return (items[0] if items else None), raw.strip()
