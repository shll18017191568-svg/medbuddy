"""AI 服务配置：全部通过环境变量注入，密钥不入库。"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    env: str = "dev"
    cors_origins: list[str] = ["http://localhost:3000"]

    # S2 起启用：大模型 API Key（DeepSeek/Qwen/GLM 多路由）
    deepseek_api_key: str = ""
    qwen_api_key: str = ""
    glm_api_key: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
