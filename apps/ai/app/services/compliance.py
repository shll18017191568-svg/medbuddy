"""合规预审：人工审核前的自动风险体检。

只做确定性规则判断，不改写任何内容，输出风险清单供审核员参考：
1. 医学免责声明 / AI 辅助标注是否落在正文（导出件同样生效）；
2. 绝对化用语与夸大疗效表述（「根治」「无副作用」等红线词）；
3. 事实类交付物的 PMID 溯源：数量要求 + NCBI PubMed 真实存在性核验。
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from app.services.pubmed import fetch_items

HIGH = "HIGH"
WARN = "WARN"
INFO = "INFO"

# 夸大疗效表述（命中即高危；排除「根治性手术」「治愈率」等正规术语）
ABSOLUTE_PATTERNS = [
    re.compile(r"(?<![不未难])根治(?!性)"),
    re.compile(r"(?<![不未难])治愈(?!性|率)"),
    re.compile(r"包治"),
    re.compile(r"神药"),
    re.compile(r"特效药"),
    re.compile(r"无(?:任何)?副作用"),
    re.compile(r"绝对安全"),
    re.compile(r"零风险"),
    re.compile(r"永不复发"),
    re.compile(r"百分之百有效"),
    re.compile(r"100%\s*有效"),
    re.compile(r"保证(?:能)?(?:治好|治愈|有效)"),
]

DISCLAIMER_MARKERS = ["仅供参考", "不构成诊疗建议", "不能替代", "不可替代"]
AI_MARKERS = ["ai 辅助", "ai辅助", "ai生成", "ai 生成", "人工智能", "模型生成", "ai 撰写", "ai撰写"]

# 文献类：必须带 PMID 溯源（缺失判高危）
LITERATURE_TYPES = {"literature_search", "literature_digest", "review_draft", "reference_format"}
# 设计类：鼓励引用核心文献（缺失仅提示，不判高危）
DESIGN_TYPES = {"experiment_design", "clinical_design"}
FACT_TYPES = LITERATURE_TYPES | DESIGN_TYPES

# 单次 PubMed 核验上限（fetch_items 内部按 50 条/批）
PMID_CHECK_LIMIT = 50
PMID_PATTERN = re.compile(r"PMID[:\s#]*(\d{5,9})", re.I)
BARE_PMID_PATTERN = re.compile(r"\b\d{5,9}\b")
_TEXT_KEYS = {
    "markdown",
    "narration",
    "rewritten",
    "abstract",
    "summary",
    "interpretation",
    "text",
    "content",
    "description",
}


def _iter_texts(value) -> list[str]:
    texts: list[str] = []
    if isinstance(value, dict):
        for key, val in value.items():
            if isinstance(val, str) and key in _TEXT_KEYS:
                texts.append(val)
            elif isinstance(val, (dict, list)):
                texts.extend(_iter_texts(val))
    elif isinstance(value, list):
        for item in value:
            texts.extend(_iter_texts(item))
    return texts


def _collect_pmids(result: dict, input_text: str, task_type: str) -> list[str]:
    pmids: list[str] = []

    def add(raw) -> None:
        if isinstance(raw, str) and raw.strip().isdigit() and 5 <= len(raw.strip()) <= 9:
            pmid = raw.strip()
            if pmid not in pmids:
                pmids.append(pmid)

    add(result.get("pmid"))
    for key in ("items", "references"):
        for entry in result.get(key) or []:
            if isinstance(entry, dict):
                add(entry.get("pmid"))

    text = "\n".join(_iter_texts(result))
    for pmid in PMID_PATTERN.findall(text):
        add(pmid)
    for pmid in PMID_PATTERN.findall(input_text or ""):
        add(pmid)
    # 参考文献排版任务：医生在需求里直接贴裸 PMID
    if task_type == "reference_format":
        for pmid in BARE_PMID_PATTERN.findall(input_text or ""):
            add(pmid)
    return pmids


def _check_absolute_terms(text: str) -> list[dict]:
    hits: list[str] = []
    for pattern in ABSOLUTE_PATTERNS:
        for match in pattern.finditer(text):
            snippet = match.group(0)
            if snippet not in hits:
                hits.append(snippet)
    if not hits:
        return []
    return [
        {
            "level": HIGH,
            "code": "ABSOLUTE_TERM",
            "message": f"出现绝对化/夸大疗效表述：{'、'.join(hits[:5])}，必须删除或改为有证据限定的表述",
        }
    ]


def _check_marks(text: str) -> list[dict]:
    if not text.strip():
        return []

    findings: list[dict] = []
    lower = text.lower()
    if not any(marker in text for marker in DISCLAIMER_MARKERS):
        findings.append(
            {
                "level": WARN,
                "code": "MISSING_DISCLAIMER",
                "message": "正文未包含医学免责声明（平台页面已固定展示，导出文件需补齐「仅供医学参考，不构成诊疗建议」）",
            }
        )
    if not any(marker in lower for marker in AI_MARKERS):
        findings.append(
            {
                "level": WARN,
                "code": "MISSING_AI_MARK",
                "message": "正文未标注「AI 辅助生成」，导出文件请补充 AI 生成标识",
            }
        )
    return findings


async def precheck(task_type: str, title: str, result: dict, input_text: str = "") -> dict:
    """返回 {status, findings, pmids, verified_pmids, checked_chars, checked_at}。"""
    text = "\n\n".join(_iter_texts(result))
    pmids = _collect_pmids(result, input_text, task_type)
    findings: list[dict] = []

    if not text.strip() and not pmids:
        findings.append(
            {
                "level": HIGH,
                "code": "EMPTY_DELIVERABLE",
                "message": "交付物正文为空，无可审核内容",
            }
        )

    findings.extend(_check_absolute_terms(text))
    findings.extend(_check_marks(text))

    verified: list[str] = []
    if task_type in FACT_TYPES:
        if not pmids:
            if task_type in LITERATURE_TYPES:
                findings.append(
                    {
                        "level": HIGH,
                        "code": "NO_PMID",
                        "message": "文献类交付物没有任何 PMID 溯源，存在模型编造风险",
                    }
                )
            else:
                findings.append(
                    {
                        "level": WARN,
                        "code": "NO_PMID",
                        "message": "设计类交付物未引用核心文献 PMID，建议补充研究依据",
                    }
                )
        else:
            try:
                check_list = pmids[:PMID_CHECK_LIMIT]
                items = await fetch_items(check_list)
                found = {item.pmid for item in items}
                verified = [p for p in check_list if p in found]
                missing = [p for p in check_list if p not in found]
                if missing:
                    findings.append(
                        {
                            "level": HIGH,
                            "code": "PMID_NOT_FOUND",
                            "message": f"以下 PMID 在 PubMed 查无此文（疑似编造）：{'、'.join(missing[:5])}"
                            + ("…" if len(missing) > 5 else ""),
                        }
                    )
                else:
                    findings.append(
                        {
                            "level": INFO,
                            "code": "PMID_VERIFIED",
                            "message": f"已核验 {len(verified)} 条 PMID 均可在 PubMed 溯源",
                        }
                    )
                if len(pmids) > PMID_CHECK_LIMIT:
                    findings.append(
                        {
                            "level": INFO,
                            "code": "PMID_CHECK_TRUNCATED",
                            "message": f"共 {len(pmids)} 条 PMID，单次核验前 {PMID_CHECK_LIMIT} 条，其余请人工抽查",
                        }
                    )
            except Exception:
                findings.append(
                    {
                        "level": WARN,
                        "code": "PMID_CHECK_UNAVAILABLE",
                        "message": "PubMed 溯源校验暂时不可用，请人工抽查 PMID",
                    }
                )

    if any(f["level"] == HIGH for f in findings):
        status = "HIGH_RISK"
    elif any(f["level"] == WARN for f in findings):
        status = "WARN"
    else:
        status = "PASS"

    return {
        "status": status,
        "task_type": task_type,
        "title": title,
        "findings": findings,
        "pmids": pmids,
        "verified_pmids": verified,
        "checked_chars": len(text),
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
