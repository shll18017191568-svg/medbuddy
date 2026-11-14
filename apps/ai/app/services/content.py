"""S5 内容工厂：科普图文 / 短视频脚本 / 患教卡片。

模型负责创作，代码负责结构与合规落地：
产物统一转 Markdown，合规提示单独列出，不可被模型省略成一句空话。
"""
from __future__ import annotations

import json
import re

from app.prompts.content import COMMON_RULES, CONTENT_PROMPT, build_user_prompt
from app.services.json_utils import extract_json
from app.services.llm import LLMError, complete, resolve_provider

CONTENT_TYPES = {"article", "video_script", "patient_edu"}
TYPE_LABELS = {"article": "科普图文", "video_script": "短视频脚本", "patient_edu": "患教卡片"}

DEFAULT_COMPLIANCE = "本内容为医学科普，不替代专业诊疗，如有不适请及时就医。"


def detect_content_type(text: str) -> str:
    t = (text or "").lower()
    if any(k in t for k in ["短视频", "脚本", "口播", "抖音", "视频号"]):
        return "video_script"
    if any(k in t for k in ["患教", "患者教育", "宣教", "出院指导", "随访"]):
        return "patient_edu"
    return "article"


def detect_platform(text: str) -> str:
    t = text or ""
    for p in ["小红书", "抖音", "视频号", "公众号"]:
        if p in t:
            return p
    return "公众号"


def detect_audience(text: str) -> str:
    t = text or ""
    if any(k in t for k in ["同行", "医生", "医生群体", "专业读者"]):
        return "同行医生"
    if any(k in t for k in ["患者", "家属", "病人"]):
        return "患者与家属"
    return "大众读者"


def _as_list(value) -> list:
    return value if isinstance(value, list) else []


_HEADING_NO = re.compile(r"^\s*(?:[（(]\s*[一二三四五六七八九十\d]+\s*[)）]|[一二三四五六七八九十]+[、.．]|\d+\s*[、.．)）])\s*")


def _strip_heading_number(heading: str) -> str:
    """去掉模型自带的小节序号，避免 Markdown 渲染成「1. 一、xxx」重复编号。"""
    return _HEADING_NO.sub("", heading, count=1).strip() or heading


def _str_list(value, limit: int = 10) -> list[str]:
    return [str(x) for x in _as_list(value) if x][:limit]


def _normalize(data: dict, content_type: str) -> dict:
    titles = _str_list(data.get("titles"), 5)
    if not titles:
        titles = [str(data.get("title") or "未命名内容")]

    base = {
        "titles": titles,
        "tags": _str_list(data.get("tags"), 8),
        "compliance_notes": _str_list(data.get("compliance_notes"), 6),
        "summary": str(data.get("summary") or ""),
    }

    if content_type == "article":
        sections = []
        for s in _as_list(data.get("sections"))[:8]:
            if not isinstance(s, dict) or not s.get("heading"):
                continue
            paras = _str_list(s.get("paragraphs"), 6) or (
                [str(s["content"])] if s.get("content") else []
            )
            if paras:
                sections.append({"heading": str(s["heading"]), "paragraphs": paras})
        if not sections:
            raise ValueError("图文生成失败：缺少正文小节，请补充主题细节后重试")
        return {**base, "type": content_type, "sections": sections}

    if content_type == "video_script":
        shots = []
        for i, s in enumerate(_as_list(data.get("shots"))[:16], 1):
            if not isinstance(s, dict) or not s.get("narration"):
                continue
            try:
                sec = int(float(s.get("seconds") or 8))
            except (TypeError, ValueError):
                sec = 8
            shots.append(
                {
                    "index": i,
                    "visual": str(s.get("visual") or "—"),
                    "narration": str(s["narration"]).strip(),
                    "seconds": max(2, min(sec, 60)),
                }
            )
        if not shots:
            raise ValueError("脚本生成失败：缺少镜头内容，请补充主题后重试")
        return {
            **base,
            "type": content_type,
            "hook": str(data.get("hook") or ""),
            "shots": shots,
            "total_seconds": sum(s["seconds"] for s in shots),
            "cta": str(data.get("cta") or ""),
        }

    cards = []
    for c in _as_list(data.get("cards"))[:10]:
        if not isinstance(c, dict) or not c.get("content"):
            continue
        cards.append(
            {"title": str(c.get("title") or "提示"), "content": str(c["content"]).strip()}
        )
    if not cards:
        raise ValueError("患教卡片生成失败：缺少卡片内容，请重试")
    return {**base, "type": content_type, "cards": cards}


def _to_markdown(content: dict, req: dict) -> str:
    titles = content["titles"]
    lines = [f"# {titles[0]}", ""]
    lines.append(f"> 内容类型：{TYPE_LABELS[content['type']]} · 平台：{req['platform']} · 读者：{req['audience']}")
    lines.append("")

    if content["type"] == "article":
        if content.get("summary"):
            lines.append(f"**导语：** {content['summary']}")
            lines.append("")
        for i, sec in enumerate(content["sections"], 1):
            lines.append(f"## {i}. {_strip_heading_number(sec['heading'])}")
            lines.append("")
            for p in sec["paragraphs"]:
                lines.append(p)
                lines.append("")

    elif content["type"] == "video_script":
        total = content["total_seconds"]
        lines.append(f"**总时长：** 约 {total} 秒")
        lines.append("")
        if content.get("hook"):
            lines.append(f"**前 3 秒开场：** {content['hook']}")
            lines.append("")
        lines.append("| 镜头 | 画面/字幕 | 口播 | 时长 |")
        lines.append("| --- | --- | --- | --- |")
        for shot in content["shots"]:
            narration = shot["narration"].replace("|", "／").replace("\n", " ")
            visual = shot["visual"].replace("|", "／").replace("\n", " ")
            lines.append(f"| {shot['index']} | {visual} | {narration} | {shot['seconds']}s |")
        lines.append("")
        if content.get("cta"):
            lines.append(f"**结尾引导：** {content['cta']}")
            lines.append("")

    else:
        for i, card in enumerate(content["cards"], 1):
            lines.append(f"## 卡片 {i}：{card['title']}")
            lines.append("")
            lines.append(card["content"])
            lines.append("")

    if titles[1:]:
        lines.append("## 备选标题")
        lines.append("")
        for t in titles[1:]:
            lines.append(f"- {t}")
        lines.append("")

    if content["tags"]:
        lines.append("## 发布标签")
        lines.append("")
        lines.append(" ".join(content["tags"]))
        lines.append("")

    lines.append("## 合规提示")
    lines.append("")
    for note in content["compliance_notes"] or [DEFAULT_COMPLIANCE]:
        lines.append(f"- {note}")
    if DEFAULT_COMPLIANCE not in content["compliance_notes"]:
        lines.append(f"- {DEFAULT_COMPLIANCE}")

    return "\n".join(lines)


def _word_count(text: str) -> int:
    chinese = len(re.findall(r"[\u4e00-\u9fa5]", text))
    english = len(re.findall(r"[A-Za-z]+", text))
    return chinese + english


async def build_content(
    topic: str,
    content_type: str | None = None,
    platform: str | None = None,
    audience: str | None = None,
    tone: str = "专业亲和",
) -> dict:
    if resolve_provider() is None:
        raise ValueError("内容生成需要配置大模型 API Key，请先在 apps/ai/.env 配置后重试")

    topic = topic.strip()
    if len(topic) < 4:
        raise ValueError("请提供更具体的内容主题（至少 4 个字）")

    ctype = content_type if content_type in CONTENT_TYPES else detect_content_type(topic)
    req = {
        "platform": platform or detect_platform(topic),
        "audience": audience or detect_audience(topic),
        "tone": tone,
    }

    user_content = build_user_prompt(topic, TYPE_LABELS[ctype], req["platform"], req["audience"], tone)

    try:
        raw = await complete(
            [
                {"role": "system", "content": CONTENT_PROMPT.replace("{common}", COMMON_RULES)},
                {"role": "user", "content": user_content},
            ],
            temperature=0.6,
            max_tokens=4000,
        )
    except LLMError as err:
        raise ValueError(f"内容生成服务异常：{err}") from err

    try:
        content = _normalize(extract_json(raw), ctype)
    except (json.JSONDecodeError, ValueError):
        try:
            retry = await complete(
                [
                    {"role": "system", "content": CONTENT_PROMPT.replace("{common}", COMMON_RULES)},
                    {
                        "role": "user",
                        "content": user_content
                        + "\n注意：上次输出不是完整合法的 JSON，请精简每段内容确保完整可解析。",
                    },
                ],
                temperature=0.4,
                max_tokens=4000,
            )
            content = _normalize(extract_json(retry), ctype)
        except (json.JSONDecodeError, ValueError, LLMError) as err:
            raise ValueError("内容生成失败：模型输出格式异常，请稍后重试") from err

    markdown = _to_markdown(content, req)
    stats = {
        "content_type": ctype,
        "type_label": TYPE_LABELS[ctype],
        "word_count": _word_count(markdown),
    }
    if ctype == "video_script":
        stats["total_seconds"] = content["total_seconds"]

    return {
        "title": content["titles"][0],
        "content_type": ctype,
        "markdown": markdown,
        "content": content,
        "request": req,
        "stats": stats,
        "warnings": [],
    }
