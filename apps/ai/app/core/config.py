"""AI 服务配置：全部通过环境变量注入，密钥不入库。"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    env: str = "dev"
    cors_origins: list[str] = ["http://localhost:3000"]

    # 大模型路由：auto 按已配置的 Key 自动选择；mock 用于无 Key 演示
    llm_provider: str = "auto"  # auto | deepseek | qwen | glm | mock
    llm_model: str = ""  # 留空用服务商默认模型
    llm_timeout: float = 60.0
    llm_max_tokens: int = 2048
    llm_temperature: float = 0.3

    # 各服务商 Key（OpenAI 兼容协议）
    deepseek_api_key: str = ""
    qwen_api_key: str = ""
    glm_api_key: str = ""

    # NCBI PubMed E-utilities（免费；配置 api_key 可提升限流到 10 req/s）
    pubmed_api_key: str = ""
    pubmed_email: str = ""
    pubmed_timeout: float = 30.0

    # 数字人第三方 API（一期：腾讯智影 / 硅基智能，双供应商备份）
    # auto 按已配置 Key 自动选择；mock 用于无 Key 演示（只产脚本与任务单，不合成成片）
    avatar_provider: str = "auto"  # auto | zhiying | silicon | mock
    avatar_zhiying_base_url: str = ""
    avatar_zhiying_api_key: str = ""
    avatar_silicon_base_url: str = ""
    avatar_silicon_api_key: str = ""
    avatar_timeout: float = 20.0  # 单次提交后等待合成的秒数，超时按 PROCESSING 回传任务单

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
