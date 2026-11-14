"""数字人适配层（总纲 §3：一期第三方 API，双供应商备份，不自研渲染）。

设计要点：
- 供应商可插拔：腾讯智影 / 硅基智能，按已配置 Key 自动选择，首选失败自动切换备份；
- 无 Key 时进入 mock 演示模式：仍产出完整播报稿 + 分镜 + 合成任务单，只是不真正合成视频；
- 对外只返回安全文案，供应商错误细节只记录日志；
- 合规：形象/声音克隆必须取得本人授权，材料清单由代码强制返回，不依赖模型记得。
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.prompts.avatar import COMMON_RULES, SCRIPT_PROMPT, build_script_prompt
from app.services.json_utils import extract_json
from app.services.llm import LLMError, complete, resolve_provider as resolve_llm_provider

PROVIDER_LABELS = {"zhiying": "腾讯智影", "silicon": "硅基智能", "mock": "演示模式"}

VOICE_LABELS = {
    "warm_female": "温暖女声 · 科普讲解",
    "steady_male": "稳重男声 · 专家播报",
    "youth_female": "清亮女声 · 新媒体",
    "senior_male": "资深男声 · 学术汇报",
}

ASPECT_META = {
    "portrait": ("竖屏 9:16", "1080x1920"),
    "landscape": ("横屏 16:9", "1920x1080"),
}

CLONE_TYPE_LABELS = {"appearance": "形象克隆", "voice": "声音克隆"}

CLONE_MATERIALS = {
    "appearance": [
        "本人手持身份证的授权声明视频（明确同意形象用于数字人合成）",
        "3-5 分钟正面出镜视频：光线均匀、无遮挡、单手部动作、背景干净",
        "签署《数字人形象授权书》（院方或本人，含使用范围与期限）",
    ],
    "voice": [
        "本人朗读授权声明音频（明确同意声音克隆）",
        "1-2 分钟清晰人声素材：安静环境、无背景音乐、语速平稳",
        "签署《数字人声音授权书》（含使用范围与期限）",
    ],
}

DEFAULT_COMPLIANCE = "本视频为医学科普，不替代专业诊疗，如有不适请及时就医。"

# 供应商状态归一化：各家字段名不同，统一映射到任务单状态
_STATUS_MAP = {
    "queued": "SUBMITTED",
    "pending": "SUBMITTED",
    "submitted": "SUBMITTED",
    "processing": "PROCESSING",
    "running": "PROCESSING",
    "rendering": "PROCESSING",
    "success": "COMPLETED",
    "succeeded": "COMPLETED",
    "completed": "COMPLETED",
    "done": "COMPLETED",
    "failed": "FAILED",
    "error": "FAILED",
}


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    base_url: str
    api_key: str


def _configured_providers(preferred: str | None = None) -> list[ProviderSpec]:
    """按优先级返回已配置的供应商（双供应商备份：首选失败切备选）。"""
    specs = []
    for name in ("zhiying", "silicon"):
        base_url = getattr(settings, f"avatar_{name}_base_url", "").strip()
        api_key = getattr(settings, f"avatar_{name}_api_key", "").strip()
        if base_url and api_key:
            specs.append(ProviderSpec(name=name, base_url=base_url.rstrip("/"), api_key=api_key))

    if preferred and preferred in PROVIDER_LABELS:
        specs.sort(key=lambda s: s.name != preferred)
    return specs


def provider_status() -> dict:
    """前端据此提示演示模式或显示当前供应商。"""
    specs = _configured_providers(settings.avatar_provider)
    return {
        "configured": bool(specs),
        "active": specs[0].name if specs else "mock",
        "active_label": PROVIDER_LABELS[specs[0].name] if specs else PROVIDER_LABELS["mock"],
        "providers": [
            {"name": s.name, "label": PROVIDER_LABELS[s.name]} for s in specs
        ],
        "voices": [{"id": k, "label": v} for k, v in VOICE_LABELS.items()],
        "aspects": [
            {"id": k, "label": v[0], "size": v[1]} for k, v in ASPECT_META.items()
        ],
    }


def _pick(data: dict, *keys: str) -> str:
    """供应商返回字段名不统一，按候选键取第一个非空字符串。"""
    scopes = [data, data.get("data") if isinstance(data.get("data"), dict) else {}, data.get("output") if isinstance(data.get("output"), dict) else {}]
    for scope in scopes:
        for key in keys:
            value = scope.get(key) if isinstance(scope, dict) else None
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _normalize_status(raw: str) -> str:
    return _STATUS_MAP.get((raw or "").strip().lower(), "SUBMITTED")


def _job_id() -> str:
    return uuid.uuid4().hex[:12]


def _headers(spec: ProviderSpec) -> dict:
    return {"Authorization": f"Bearer {spec.api_key}", "Content-Type": "application/json"}


async def _submit(spec: ProviderSpec, kind: str, payload: dict) -> dict:
    """向供应商提交合成任务；字段名按候选键解析，兼容常见返回结构。"""
    path = "/v1/avatar/video" if kind == "video" else "/v1/avatar/clone"
    async with httpx.AsyncClient(timeout=settings.avatar_timeout) as client:
        resp = await client.post(f"{spec.base_url}{path}", headers=_headers(spec), json=payload)
        if resp.status_code in (401, 403):
            raise ValueError("供应商鉴权失败")
        if resp.status_code >= 400:
            raise ValueError(f"供应商返回 {resp.status_code}")
        body = resp.json()

    return {
        "job_id": _pick(body, "job_id", "jobId", "task_id", "taskId", "id") or _job_id(),
        "status": _normalize_status(_pick(body, "status", "state")),
        "video_url": _pick(body, "video_url", "videoUrl", "url", "output_url"),
        "raw": body,
    }


async def _poll(spec: ProviderSpec, job_id: str) -> dict:
    """短轮询等待成片；超时未完成按 PROCESSING 返回，前端可凭任务单号追。"""
    deadline = time.monotonic() + settings.avatar_timeout
    last = {"status": "PROCESSING", "video_url": ""}
    while True:
        await asyncio.sleep(3)
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{spec.base_url}/v1/jobs/{job_id}", headers=_headers(spec))
                if resp.status_code >= 400:
                    return last
                body = resp.json()
        except httpx.HTTPError:
            return last

        status = _normalize_status(_pick(body, "status", "state"))
        last = {"status": status, "video_url": _pick(body, "video_url", "videoUrl", "url", "output_url")}
        if status in ("COMPLETED", "FAILED") or time.monotonic() >= deadline:
            return last


def _chinese_chars(text: str) -> int:
    return len(re.findall(r"[\u4e00-\u9fa5]", text))


def _estimate_seconds(narration: str, shots_seconds: int | None = None) -> int:
    """口播速度按 4 字/秒估算，兜底 20-90 秒。"""
    if shots_seconds and shots_seconds > 0:
        return max(5, min(shots_seconds, 180))
    return max(20, min(round(_chinese_chars(narration) / 4), 90))


def _normalize_script(data: dict, duration: int) -> dict:
    narration = str(data.get("narration") or "").strip()
    if len(narration) < 20:
        raise ValueError("播报稿过短，请补充主题或稿件内容后重试")

    shots = []
    for i, s in enumerate(data.get("shots") if isinstance(data.get("shots"), list) else [], 1):
        if not isinstance(s, dict):
            continue
        subtitle = str(s.get("subtitle") or s.get("narration") or "").strip()
        if not subtitle:
            continue
        try:
            sec = int(float(s.get("seconds") or 0))
        except (TypeError, ValueError):
            sec = 0
        shots.append(
            {
                "index": i,
                "seconds": max(2, min(sec or 8, 60)),
                "subtitle": subtitle,
                "visual": str(s.get("visual") or "数字人出镜口播").strip(),
            }
        )

    if not shots:
        shots = [
            {
                "index": 1,
                "seconds": _estimate_seconds(narration, duration),
                "subtitle": narration,
                "visual": "数字人出镜口播 + 关键信息字幕",
            }
        ]

    notes = [str(x) for x in (data.get("compliance_notes") or []) if x][:6]
    if DEFAULT_COMPLIANCE not in notes:
        notes.append(DEFAULT_COMPLIANCE)

    return {
        "title": str(data.get("title") or "数字人播报视频").strip()[:40],
        "narration": narration,
        "shots": shots,
        "total_seconds": sum(s["seconds"] for s in shots),
        "compliance_notes": notes,
    }


async def _build_script(topic: str, duration: int, audience: str) -> dict:
    if resolve_llm_provider() is None:
        raise ValueError("播报稿撰写需要配置大模型 API Key，请先在 apps/ai/.env 配置后重试")

    user_content = build_script_prompt(topic, duration, audience)
    system = SCRIPT_PROMPT.replace("{common}", COMMON_RULES).replace(
        "{duration_rule}", f"- 目标时长约 {duration} 秒，口播稿 {int(duration * 4)} 字左右，分镜 6-12 个。"
    )

    try:
        raw = await complete(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            temperature=0.6,
            max_tokens=3000,
        )
    except LLMError as err:
        raise ValueError(f"播报稿服务异常：{err}") from err

    try:
        data = extract_json(raw)
    except (json.JSONDecodeError, ValueError):
        try:
            retry = await complete(
                [
                    {"role": "system", "content": system},
                    {
                        "role": "user",
                        "content": user_content + "\n注意：上次输出不是完整合法的 JSON，请精简内容确保完整可解析。",
                    },
                ],
                temperature=0.4,
                max_tokens=3000,
            )
            data = extract_json(retry)
        except (json.JSONDecodeError, ValueError, LLMError) as retry_err:
            raise ValueError("播报稿生成失败：模型输出格式异常，请稍后重试") from retry_err

    return _normalize_script(data, duration)


def detect_voice(text: str) -> str:
    t = text or ""
    if any(k in t for k in ["男声", "男医生", "专家播报", "稳重"]):
        return "steady_male"
    if any(k in t for k in ["学术", "汇报", "讲课"]):
        return "senior_male"
    if any(k in t for k in ["清亮", "年轻", "小红书"]):
        return "youth_female"
    return "warm_female"


def detect_aspect(text: str) -> str:
    return "landscape" if any(k in (text or "") for k in ["横屏", "16:9", "会议", "公众号"]) else "portrait"


def detect_clone_type(text: str) -> str:
    return "voice" if any(k in (text or "") for k in ["声音", "音色", "配音"]) else "appearance"


async def build_video(
    topic: str,
    voice: str | None = None,
    aspect: str | None = None,
    duration: int = 45,
    audience: str = "大众读者",
    avatar_id: str | None = None,
) -> dict:
    topic = (topic or "").strip()
    if len(topic) < 4:
        raise ValueError("请提供更具体的主题或稿件（至少 4 个字）")

    duration = max(20, min(int(duration or 45), 180))
    script = await _build_script(topic, duration, audience)

    voice_id = voice if voice in VOICE_LABELS else detect_voice(topic)
    aspect_id = aspect if aspect in ASPECT_META else detect_aspect(topic)
    aspect_label, size = ASPECT_META[aspect_id]

    payload = {
        "title": script["title"],
        "script": script["narration"],
        "voice": voice_id,
        "avatar_id": avatar_id or "",
        "resolution": size,
        "subtitle": True,
        "shots": script["shots"],
    }

    warnings: list[str] = []
    specs = _configured_providers(settings.avatar_provider)

    if not specs:
        return _mock_deliverable(script, voice_id, aspect_id, aspect_label, size, warnings)

    last_error = ""
    for index, spec in enumerate(specs):
        try:
            submitted = await _submit(spec, "video", payload)
            if submitted["status"] not in ("COMPLETED", "FAILED"):
                polled = await _poll(spec, submitted["job_id"])
                submitted.update({k: v for k, v in polled.items() if v})
            if submitted["status"] == "FAILED":
                raise ValueError(f"{PROVIDER_LABELS[spec.name]}合成失败")
            if index > 0:
                warnings.append(f"首选供应商不可用，已自动切换至{PROVIDER_LABELS[spec.name]}")
            if submitted["status"] != "COMPLETED" or not submitted["video_url"]:
                warnings.append("成片仍在合成中，可凭任务单号稍后在数字人工作室查看进度")
            return _deliverable(
                script, voice_id, aspect_id, aspect_label, size, spec, submitted, warnings
            )
        except (httpx.HTTPError, ValueError, KeyError) as err:
            last_error = f"{PROVIDER_LABELS[spec.name]}：{type(err).__name__}"
            print(f"[avatar] provider {spec.name} failed: {err}")
            continue

    raise ValueError(f"数字人视频合成失败（{last_error or '供应商不可用'}），请稍后重试")


def _deliverable(
    script: dict,
    voice_id: str,
    aspect_id: str,
    aspect_label: str,
    size: str,
    spec: ProviderSpec,
    submitted: dict,
    warnings: list[str],
) -> dict:
    return {
        "kind": "avatar_video",
        "title": script["title"],
        "narration": script["narration"],
        "shots": script["shots"],
        "total_seconds": script["total_seconds"],
        "voice": voice_id,
        "voice_label": VOICE_LABELS[voice_id],
        "aspect": aspect_id,
        "aspect_label": aspect_label,
        "resolution": size,
        "provider": spec.name,
        "provider_label": PROVIDER_LABELS[spec.name],
        "job_id": submitted["job_id"],
        "status": submitted["status"],
        "video_url": submitted.get("video_url", ""),
        "compliance_notes": script["compliance_notes"],
        "warnings": warnings,
        "stats": {
            "narration_chars": _chinese_chars(script["narration"]),
            "total_seconds": script["total_seconds"],
            "shots": len(script["shots"]),
        },
    }


def _mock_deliverable(
    script: dict,
    voice_id: str,
    aspect_id: str,
    aspect_label: str,
    size: str,
    warnings: list[str],
) -> dict:
    warnings = [
        *warnings,
        "演示模式：未配置数字人供应商 Key，本次仅交付播报稿、分镜与合成任务单，未真正合成成片",
    ]
    return {
        "kind": "avatar_video",
        "title": script["title"],
        "narration": script["narration"],
        "shots": script["shots"],
        "total_seconds": script["total_seconds"],
        "voice": voice_id,
        "voice_label": VOICE_LABELS[voice_id],
        "aspect": aspect_id,
        "aspect_label": aspect_label,
        "resolution": size,
        "provider": "mock",
        "provider_label": PROVIDER_LABELS["mock"],
        "job_id": f"mock-{_job_id()}",
        "status": "SUBMITTED",
        "video_url": "",
        "compliance_notes": script["compliance_notes"],
        "warnings": warnings,
        "stats": {
            "narration_chars": _chinese_chars(script["narration"]),
            "total_seconds": script["total_seconds"],
            "shots": len(script["shots"]),
        },
    }


async def build_clone(
    notes: str,
    clone_type: str | None = None,
    display_name: str | None = None,
) -> dict:
    notes = (notes or "").strip()
    ctype = clone_type if clone_type in CLONE_TYPE_LABELS else detect_clone_type(notes)
    materials = CLONE_MATERIALS[ctype]

    payload = {
        "clone_type": ctype,
        "name": (display_name or "医生数字人").strip()[:20],
        "notes": notes[:500],
        "authorized": True,
        "materials": materials,
    }

    warnings = ["克隆任务需人工核验授权材料后才会开通，请按材料清单准备并上传"]
    specs = _configured_providers(settings.avatar_provider)

    if not specs:
        return {
            "kind": "avatar_clone",
            "clone_type": ctype,
            "type_label": CLONE_TYPE_LABELS[ctype],
            "provider": "mock",
            "provider_label": PROVIDER_LABELS["mock"],
            "job_id": f"mock-{_job_id()}",
            "status": "SUBMITTED",
            "materials": materials,
            "notes": notes,
            "warnings": ["演示模式：未配置数字人供应商 Key，本次仅生成克隆任务单与材料清单", *warnings],
            "stats": {"materials": len(materials)},
        }

    last_error = ""
    for index, spec in enumerate(specs):
        try:
            submitted = await _submit(spec, "clone", payload)
            if index > 0:
                warnings.append(f"首选供应商不可用，已自动切换至{PROVIDER_LABELS[spec.name]}")
            return {
                "kind": "avatar_clone",
                "clone_type": ctype,
                "type_label": CLONE_TYPE_LABELS[ctype],
                "provider": spec.name,
                "provider_label": PROVIDER_LABELS[spec.name],
                "job_id": submitted["job_id"],
                "status": submitted["status"],
                "materials": materials,
                "notes": notes,
                "warnings": warnings,
                "stats": {"materials": len(materials)},
            }
        except (httpx.HTTPError, ValueError) as err:
            last_error = f"{PROVIDER_LABELS[spec.name]}：{type(err).__name__}"
            print(f"[avatar] clone {spec.name} failed: {err}")
            continue

    raise ValueError(f"数字人克隆任务提交失败（{last_error or '供应商不可用'}），请稍后重试")
