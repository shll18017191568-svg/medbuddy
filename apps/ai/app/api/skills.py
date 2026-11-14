"""医学科研技能 API（S2 起逐步接入）。

每次新增技能都遵守同一契约：返回结构化结果，事实类数据全部来自权威数据源。
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.digest import digest_pmid
from app.services.pubmed import search_literature

router = APIRouter(prefix="/api/skills", tags=["skills"])


class LiteratureSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    limit: int = Field(default=10, ge=1, le=30)
    years: int | None = Field(default=5, ge=1, le=50)


@router.post("/literature-search")
async def literature_search(req: LiteratureSearchRequest) -> dict:
    """技能 1：文献检索（PubMed 真实数据）。"""
    try:
        return await search_literature(req.query, limit=req.limit, years=req.years)
    except httpx.HTTPError as err:
        return {"error": f"PubMed 检索失败：{type(err).__name__}", "items": [], "count": 0}


class LiteratureDigestRequest(BaseModel):
    pmid: str = Field(pattern=r"^\d{1,9}$")


@router.post("/literature-digest")
async def literature_digest(req: LiteratureDigestRequest) -> dict:
    """技能 2：文献解读（基于 PubMed 摘要的结构化拆解）。"""
    try:
        return await digest_pmid(req.pmid)
    except ValueError as err:
        return {"error": str(err)}
    except httpx.HTTPError as err:
        return {"error": f"PubMed 访问失败：{type(err).__name__}"}
