"""MedBuddy AI 服务入口。

S0 里程碑 M0：健康检查跑通，与 Web 服务联调。
后续 Sprint 在此挂载：模型路由网关、文献工具、绘图引擎、Agent 编排。
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.avatar import router as avatar_router
from app.api.llm import router as llm_router
from app.api.skills import router as skills_router
from app.core.config import settings

app = FastAPI(
    title="MedBuddy AI Service",
    version="0.1.0",
    description="医生智能工作台 AI 服务：大模型路由 / 医学科研技能 / 数字人适配",
)

# S0 阶段先放开本地开发跨域，上线前收敛到正式域名
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# S2：大模型对话（数字人核心）
app.include_router(llm_router)
# S2：医学科研技能（文献检索等）
app.include_router(skills_router)
# S3：数字人（播报视频 / 形象声音克隆）
app.include_router(avatar_router)


@app.get("/api/health")
async def health() -> dict:
    """健康检查：Web 服务与 CI 依赖此端点判断 AI 服务存活。"""
    return {
        "status": "ok",
        "service": "medbuddy-ai",
        "version": "0.1.0",
        "env": settings.env,
    }
