"""数字人 API：供应商状态 / 播报视频合成 / 形象声音克隆任务单。"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.avatar import build_clone, build_video, provider_status

router = APIRouter(prefix="/api/avatar", tags=["avatar"])


@router.get("/status")
async def status() -> dict:
    """前端据此提示演示模式或当前生效的第三方供应商（含备份列表）。"""
    return provider_status()


class AvatarVideoRequest(BaseModel):
    topic: str = Field(min_length=4, max_length=3000)
    voice: str | None = Field(default=None, max_length=20)
    aspect: str | None = Field(default=None, max_length=20)
    duration: int = Field(default=45, ge=20, le=180)
    audience: str = Field(default="大众读者", max_length=20)
    avatar_id: str | None = Field(default=None, max_length=64)


@router.post("/video")
async def avatar_video(req: AvatarVideoRequest) -> dict:
    """数字人播报视频：播报稿 + 分镜 + 供应商合成任务单。"""
    try:
        return await build_video(
            req.topic,
            voice=req.voice,
            aspect=req.aspect,
            duration=req.duration,
            audience=req.audience,
            avatar_id=req.avatar_id,
        )
    except ValueError as err:
        return {"error": str(err)}


class AvatarCloneRequest(BaseModel):
    notes: str = Field(default="", max_length=500)
    clone_type: str | None = Field(default=None, max_length=20)
    display_name: str | None = Field(default=None, max_length=20)


@router.post("/clone")
async def avatar_clone(req: AvatarCloneRequest) -> dict:
    """形象/声音克隆任务单：材料清单强制返回，授权材料需人工核验。"""
    try:
        return await build_clone(req.notes, clone_type=req.clone_type, display_name=req.display_name)
    except ValueError as err:
        return {"error": str(err)}
