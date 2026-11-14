"""合规审核 API：交付物自动预审（人工审核前的风险体检）。"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.compliance import precheck

router = APIRouter(prefix="/api/compliance", tags=["compliance"])


class PrecheckRequest(BaseModel):
    task_type: str = Field(max_length=40)
    title: str = Field(default="", max_length=100)
    result: dict


@router.post("/precheck")
async def run_precheck(req: PrecheckRequest) -> dict:
    """确定性合规预审：免责声明 / AI 标注 / 绝对化用语 / PMID 真实溯源。"""
    return await precheck(req.task_type, req.title, req.result)
