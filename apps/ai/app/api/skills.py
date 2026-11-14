"""医学科研技能 API（S2 起逐步接入）。

每次新增技能都遵守同一契约：返回结构化结果，事实类数据全部来自权威数据源。
"""
from __future__ import annotations

import base64
import binascii

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.charts import (
    CHART_LABEL,
    build_interpret_prompt,
    fallback_interpretation,
    load_table,
    render_chart,
)
from app.services.digest import digest_pmid
from app.services.llm import LLMError, complete, resolve_provider
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


class VisualizeRequest(BaseModel):
    filename: str = "data.csv"
    content_base64: str = Field(min_length=8)
    chart_type: str | None = None
    instruction: str | None = None


MAX_TABLE_BYTES = 5 * 1024 * 1024


async def _interpret(stats: dict, instruction: str) -> str:
    """图表解读：有模型用模型，无模型退回确定性统计描述。"""
    if resolve_provider() is None:
        return fallback_interpretation(stats)

    try:
        text = await complete(build_interpret_prompt(stats, instruction), temperature=0.2, max_tokens=500)
        text = text.strip()
        return text or fallback_interpretation(stats)
    except LLMError:
        return fallback_interpretation(stats)


@router.post("/visualize")
async def visualize(req: VisualizeRequest) -> dict:
    """技能 8：数据分析与可视化（服务端确定性绘图 + 模型解读）。"""
    try:
        raw = base64.b64decode(req.content_base64)
    except (binascii.Error, ValueError):
        return {"error": "文件内容解析失败，请重新上传"}

    if len(raw) > MAX_TABLE_BYTES:
        return {"error": "文件超过 5MB，请精简数据后重试"}

    try:
        df = load_table(req.filename, raw)
    except Exception as err:  # noqa: BLE001 - 解析异常文案直接给用户
        return {"error": f"表格解析失败：{type(err).__name__}"}

    if df.empty:
        return {"error": "表格没有数据行"}

    rows = len(df)
    if rows > 5000:
        df = df.head(5000)

    try:
        image, stats, chart_type = render_chart(df, req.chart_type or "", req.instruction or "")
    except ValueError as err:
        return {"error": str(err)}
    except Exception as err:  # noqa: BLE001
        return {"error": f"绘图失败：{type(err).__name__}"}

    interpretation = await _interpret(stats, req.instruction or "")

    return {
        "chart_type": chart_type,
        "chart_label": CHART_LABEL[chart_type],
        "image": image,
        "stats": stats,
        "interpretation": interpretation,
        "rows": rows,
        "columns": [str(c) for c in df.columns],
    }
