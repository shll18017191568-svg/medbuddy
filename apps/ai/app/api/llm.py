"""大模型对话 API：状态查询 + SSE 流式对话。"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.prompts.medical import MEDICAL_SYSTEM_PROMPT
from app.services.llm import LLMAuthError, LLMError, provider_status, stream_chat

router = APIRouter(prefix="/api/llm", tags=["llm"])


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20000)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=40)
    system: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)


@router.get("/status")
async def status() -> dict:
    """前端据此提示"未配置 Key"或显示当前模型。"""
    return provider_status()


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    """SSE 流式对话。事件类型：delta / done / error。"""
    messages = [{"role": "system", "content": req.system or MEDICAL_SYSTEM_PROMPT}]
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    async def event_stream() -> AsyncIterator[str]:
        try:
            async for delta in stream_chat(messages, temperature=req.temperature):
                yield _sse({"type": "delta", "content": delta})
            yield _sse({"type": "done"})
        except LLMAuthError as err:
            print(f"[llm] auth error: {err}")
            yield _sse(
                {
                    "type": "error",
                    "message": "模型服务鉴权失败：API Key 无效，请在 apps/ai/.env 配置有效 Key 后重启",
                }
            )
        except LLMError as err:
            # 上游细节只记录日志，对外给安全文案
            print(f"[llm] {err}")
            yield _sse({"type": "error", "message": "模型服务暂时不可用，请稍后重试"})
        except Exception as err:  # noqa: BLE001
            print(f"[llm] unexpected: {err}")
            yield _sse({"type": "error", "message": "服务异常，请稍后重试"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 关闭 Nginx 缓冲，保证逐字输出
        },
    )
