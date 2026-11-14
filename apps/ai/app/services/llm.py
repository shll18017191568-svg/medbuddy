"""统一大模型客户端（OpenAI 兼容协议）。

设计要点（总纲 §4 模型调度网关的最小实现）：
- 一套协议适配 DeepSeek / 通义千问 / 智谱 GLM，切换只改环境变量；
- 无 Key 时自动降级为 mock 模式，保证开发链路可端到端验证；
- 流式输出（SSE），供 Web 端逐字渲染；
- 统一异常，避免上游错误细节泄漏给终端用户。
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass

import httpx

from app.core.config import settings


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    base_url: str
    model: str
    api_key: str


# 服务商默认配置（均支持 OpenAI /chat/completions 协议）
PROVIDERS: dict[str, tuple[str, str, str]] = {
    # name: (base_url, default_model, settings 字段名)
    "deepseek": ("https://api.deepseek.com/v1", "deepseek-chat", "deepseek_api_key"),
    "qwen": ("https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus", "qwen_api_key"),
    "glm": ("https://open.bigmodel.cn/api/paas/v4", "glm-4-flash", "glm_api_key"),
}


class LLMError(Exception):
    """上游模型调用失败（对外只暴露安全文案）。"""


class LLMAuthError(LLMError):
    """API Key 无效或无权限（配置问题，需管理员处理）。"""


def resolve_provider() -> ProviderConfig | None:
    """解析当前生效的服务商；无可用 Key 或显式 mock 时返回 None（走 mock）。"""
    preferred = settings.llm_provider.strip().lower()

    # 显式 mock：即使机器上存在 Key 也走演示模式（联调用）
    if preferred == "mock":
        return None

    names = [preferred] if preferred in PROVIDERS else list(PROVIDERS)

    for name in names:
        base_url, default_model, key_field = PROVIDERS[name]
        key = getattr(settings, key_field, "")
        if key:
            return ProviderConfig(
                name=name,
                base_url=base_url,
                model=settings.llm_model or default_model,
                api_key=key,
            )
    return None


def provider_status() -> dict:
    provider = resolve_provider()
    if provider is None:
        return {"configured": False, "provider": "mock", "model": "mock-medical"}
    return {"configured": True, "provider": provider.name, "model": provider.model}


def _build_payload(
    messages: list[dict],
    provider: ProviderConfig,
    temperature: float | None,
    max_tokens: int | None,
) -> dict:
    return {
        "model": provider.model,
        "messages": messages,
        "temperature": settings.llm_temperature if temperature is None else temperature,
        "max_tokens": max_tokens or settings.llm_max_tokens,
        "stream": True,
    }


MOCK_REPLY = (
    "【演示模式】当前尚未配置大模型 API Key，以下为占位回复，用于验证链路连通。\n\n"
    "收到您的问题后，正式环境下我会：\n"
    "1. 先给出结论与循证依据（标注指南/文献来源）；\n"
    "2. 对不确定内容明确提示需核实原文，绝不编造 PMID；\n"
    "3. 涉及具体患者时，仅提供鉴别思路，最终决策权归主诊医生。\n\n"
    "配置方式：在 apps/ai/.env 中填入 DEEPSEEK_API_KEY（或 QWEN_API_KEY / GLM_API_KEY）后重启 AI 服务。"
)


async def stream_chat(
    messages: list[dict],
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> AsyncIterator[str]:
    """流式输出文本增量。调用方负责组装 SSE 事件。"""
    provider = resolve_provider()

    # mock：逐段吐出占位回复，模拟真实流式体验
    if provider is None:
        for chunk in _chunk_text(MOCK_REPLY, size=12):
            yield chunk
        return

    payload = _build_payload(messages, provider, temperature, max_tokens)
    headers = {
        "Authorization": f"Bearer {provider.api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout) as client:
            async with client.stream(
                "POST",
                f"{provider.base_url}/chat/completions",
                headers=headers,
                json=payload,
            ) as resp:
                if resp.status_code in (401, 403):
                    raise LLMAuthError("API Key 无效或无权限")
                if resp.status_code != 200:
                    detail = (await resp.aread()).decode("utf-8", errors="ignore")[:300]
                    raise LLMError(f"模型服务返回 {resp.status_code}: {detail}")

                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        obj = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = obj.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if content:
                        yield content
    except httpx.HTTPError as err:
        raise LLMError(f"模型服务连接失败: {err}") from err


async def complete(
    messages: list[dict],
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> str:
    """非流式调用（技能执行、任务回传用）。"""
    parts: list[str] = []
    async for chunk in stream_chat(messages, temperature, max_tokens):
        parts.append(chunk)
    return "".join(parts)


def _chunk_text(text: str, size: int) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)]
