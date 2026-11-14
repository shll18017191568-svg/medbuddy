"""技能 9：参考文献管理。

只给 PMID，自动补齐题录并套用期刊格式；同时导出 BibTeX / RIS，
可直接导入 EndNote、Zotero。格式为首批 6 种主流样式，作者缩写沿用 PubMed 原始格式。
"""
from __future__ import annotations

import re

from app.services.pubmed import LiteratureItem, fetch_items

STYLE_LABELS = {
    "gb7714": "GB/T 7714",
    "vancouver": "Vancouver",
    "apa": "APA 7th",
    "ama": "AMA",
    "nature": "Nature",
    "ieee": "IEEE",
}

STYLE_HINTS = {
    "gb7714": ["gb", "国标", "中文期刊"],
    "vancouver": ["vancouver", "温哥华"],
    "apa": ["apa"],
    "ama": ["ama"],
    "nature": ["nature"],
    "ieee": ["ieee"],
}

PMID_RE = re.compile(r"\b(\d{5,9})\b")


def detect_style(instruction: str) -> str:
    text = (instruction or "").lower()
    for style, hints in STYLE_HINTS.items():
        if any(h in text for h in hints):
            return style
    return "gb7714"


def _split_authors(authors: str) -> tuple[list[str], bool]:
    """拆分作者串，返回 (作者列表, 是否含 et al)。"""
    if not authors or authors == "Not specified":
        return [], False
    parts = [p.strip() for p in authors.split(",") if p.strip()]
    has_et_al = any("et al" in p.lower() for p in parts)
    parts = [p for p in parts if "et al" not in p.lower()]
    return parts, has_et_al


def _apa_author(name: str) -> str:
    tokens = name.split()
    if len(tokens) < 2:
        return name
    surname, initials = tokens[0], tokens[1:]
    return f"{surname}, " + " ".join(f"{t[0]}." for t in initials if t)


def _ieee_author(name: str) -> str:
    tokens = name.split()
    if len(tokens) < 2:
        return name
    surname, initials = tokens[0], tokens[1:]
    return " ".join(f"{t[0]}." for t in initials if t) + f" {surname}"


def _locator(item: LiteratureItem) -> tuple[str, str, str, str]:
    year = (item.pubdate or "").split(" ")[0]
    return year, item.volume or "", item.issue or "", item.pages or ""


def format_reference(index: int, item: LiteratureItem, style: str) -> str:
    title = (item.title or "").rstrip(".")
    journal = item.journal or "Not specified"
    year, volume, issue, pages = _locator(item)
    doi = f" doi:{item.doi}" if item.doi else ""
    authors = (item.authors or "Not specified").rstrip(".")

    if style == "vancouver":
        loc = year
        if volume:
            loc += f";{volume}"
            if issue:
                loc += f"({issue})"
            if pages:
                loc += f":{pages}"
        return f"{index}. {authors}. {title}. {journal}. {loc}.{doi}"

    if style == "apa":
        parts, et_al = _split_authors(item.authors)
        apa = ", ".join(_apa_author(p) for p in parts) if parts else "Not specified"
        if et_al:
            apa += ", et al."
        vol = f", {volume}" if volume else ""
        iss = f"({issue})" if issue else ""
        pg = f", {pages}" if pages else ""
        link = f" https://doi.org/{item.doi}" if item.doi else ""
        return f"{apa} ({year}). {title}. {journal}{vol}{iss}{pg}.{link}"

    if style == "ama":
        loc = year
        if volume:
            loc += f";{volume}"
            if issue:
                loc += f"({issue})"
            if pages:
                loc += f":{pages}"
        return f"{index}. {authors}. {title}. {journal}. {loc}.{doi}"

    if style == "nature":
        return f"{authors}. {title}. {journal} {volume}, {pages} ({year}).{doi}"

    if style == "ieee":
        parts, et_al = _split_authors(item.authors)
        ieee = ", ".join(_ieee_author(p) for p in parts) if parts else "Not specified"
        if et_al:
            ieee += ", et al."
        vol = f", vol. {volume}" if volume else ""
        no = f", no. {issue}" if issue else ""
        pp = f", pp. {pages}" if pages else ""
        return f'[{index}] {ieee}, "{title}," {journal}{vol}{no}{pp}, {year}.{doi}'

    # 默认 GB/T 7714
    loc = year
    if volume:
        loc += f", {volume}"
        if issue:
            loc += f"({issue})"
        if pages:
            loc += f": {pages}"
    tail = f" DOI: {item.doi}." if item.doi else "."
    return f"[{index}] {authors}. {title}[J]. {journal}, {loc}.{tail}"


def to_bibtex(items: list[LiteratureItem]) -> str:
    entries = []
    for item in items:
        parts, _ = _split_authors(item.authors)
        first = parts[0].split()[0].lower() if parts else "anon"
        first = re.sub(r"[^a-z]", "", first) or "anon"
        year = (item.pubdate or "").split(" ")[0]
        key = f"{first}{year}pmid{item.pmid}"
        fields = [
            f"  title = {{{item.title}}}",
            f"  author = {{{' and '.join(parts) if parts else 'Not specified'}}}",
            f"  journal = {{{item.journal}}}",
            f"  year = {{{year}}}",
        ]
        if item.volume:
            fields.append(f"  volume = {{{item.volume}}}")
        if item.issue:
            fields.append(f"  number = {{{item.issue}}}")
        if item.pages:
            fields.append(f"  pages = {{{item.pages}}}")
        if item.doi:
            fields.append(f"  doi = {{{item.doi}}}")
        fields.append(f"  pmid = {{{item.pmid}}}")
        entries.append("@article{" + key + ",\n" + ",\n".join(fields) + "\n}")
    return "\n\n".join(entries)


def to_ris(items: list[LiteratureItem]) -> str:
    blocks = []
    for item in items:
        parts, _ = _split_authors(item.authors)
        year = (item.pubdate or "").split(" ")[0]
        pages = (item.pages or "").split("-")
        lines = ["TY  - JOUR", f"TI  - {item.title}", f"JO  - {item.journal}", f"PY  - {year}"]
        lines += [f"AU  - {a}" for a in parts]
        if item.volume:
            lines.append(f"VL  - {item.volume}")
        if item.issue:
            lines.append(f"IS  - {item.issue}")
        if pages and pages[0]:
            lines.append(f"SP  - {pages[0]}")
            if len(pages) > 1:
                lines.append(f"EP  - {pages[1]}")
        if item.doi:
            lines.append(f"DO  - {item.doi}")
        lines.append(f"AN  - PMID:{item.pmid}")
        lines.append(f"UR  - {item.url}")
        lines.append("ER  - ")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def extract_pmids(text: str, extra: list[str] | None = None) -> list[str]:
    found: list[str] = []
    for pmid in (extra or []) + PMID_RE.findall(text or ""):
        pmid = pmid.strip()
        if pmid.isdigit() and pmid not in found:
            found.append(pmid)
    return found


async def build_references(
    text: str, pmid_list: list[str] | None, style: str | None
) -> dict:
    pmids = extract_pmids(text, pmid_list)
    if not pmids:
        raise ValueError("未找到 PMID：请提供 5-9 位数字的 PMID，可一次粘贴多条")
    if len(pmids) > 100:
        raise ValueError("单次最多处理 100 条文献，请分批提交")

    final_style = style if style in STYLE_LABELS else detect_style(text)
    items = await fetch_items(pmids)

    by_pmid = {item.pmid: item for item in items}
    missing = [p for p in pmids if p not in by_pmid]
    ordered = [by_pmid[p] for p in pmids if p in by_pmid]

    if not ordered:
        raise ValueError("提供的 PMID 均无法获取题录，请检查后重试")

    lines = [format_reference(i, item, final_style) for i, item in enumerate(ordered, 1)]
    text_block = "\n".join(lines)

    warnings = []
    if missing:
        warnings.append(f"有 {len(missing)} 条 PMID 无法获取题录：{', '.join(missing[:5])}")
    warnings.append("作者姓名缩写沿用 PubMed 原始格式，正式投稿前建议用 EndNote/Zotero 校验")

    return {
        "style": final_style,
        "style_label": STYLE_LABELS[final_style],
        "count": len(ordered),
        "text": text_block,
        "markdown": "## 参考文献\n\n" + "\n\n".join(
            f"{line}" for line in lines
        ),
        "references": [
            {
                "index": i,
                "pmid": item.pmid,
                "text": line,
                "title": item.title,
                "journal": item.journal,
                "pubdate": item.pubdate,
                "url": item.url,
            }
            for i, (item, line) in enumerate(zip(ordered, lines), 1)
        ],
        "bibtex": to_bibtex(ordered),
        "ris": to_ris(ordered),
        "missing": missing,
        "warnings": warnings,
    }
