# 启动配置：从 XHS_ 环境变量和 backend/.env 读取默认值。
# 模型的运行时覆盖配置由 model_settings.py 统一解析。

from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]


# 默认配置与执行上限；SecretStr 避免密钥在常规对象展示中明文输出。
class Config(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="XHS_", env_file=ROOT / "backend" / ".env", extra="ignore"
    )
    data_dir: Path = ROOT / "data"
    mcp_url: str = "http://127.0.0.1:18060/mcp"
    model_name: str = ""
    model_base_url: str = ""
    model_api_key: SecretStr = SecretStr("")
    tool_timeout: float = 90
    model_timeout: float = 120
    collection_delay: float = 2
    max_tool_calls: int = 140
    extra_origin: str = ""

    # 只检查模型名和密钥是否存在，不代表服务已通过实际调用验证。
    @property
    def model_configured(self):
        return bool(self.model_name and self.model_api_key.get_secret_value())
