# 模型配置管理：运行时读取模型、服务地址和密钥这一整组配置。
# 私密文件与普通创作设置分开保存；对外响应只暴露是否已配置密钥。

"""Private model credentials, shared by API and worker via atomic local storage."""

import json
import os
import tempfile
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from .storage import Problem


# 模型配置写入契约；密钥可省略，是否允许沿用由 save 决定。
class ModelInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    model: str = Field(min_length=1, max_length=200)
    base_url: str = Field(min_length=1, max_length=2000)
    api_key: SecretStr | None = None

    # 远程服务要求 HTTPS，本机调试允许 HTTP；拒绝 URL 内凭据及查询参数。
    @field_validator("base_url")
    @classmethod
    def valid_url(cls, value):
        u = urlsplit(value)
        if (
            not u.hostname
            or u.username
            or u.password
            or u.query
            or u.fragment
            or not (
                u.scheme == "https"
                or (
                    u.scheme == "http"
                    and u.hostname in {"localhost", "127.0.0.1", "::1"}
                )
            )
        ):
            raise ValueError(
                "请输入 HTTPS 服务地址，本地服务可使用 HTTP；不要包含密钥或查询参数"
            )
        return value.rstrip("/")


# 公开配置只返回密钥存在标记，不返回密钥原文。
class ModelPublic(BaseModel):
    model: str
    base_url: str
    key_configured: bool
    source: str


# 有私密配置文件时整组覆盖环境默认值；每次调用重新读取，支持热切换。
def resolve(config):
    path = config.data_dir / "model-config.json"
    if not path.exists():
        return config
    try:
        value = ModelInput.model_validate_json(path.read_text())
        return config.model_copy(
            update={
                "model_name": value.model,
                "model_base_url": value.base_url,
                "model_api_key": value.api_key or SecretStr(""),
            }
        )
    except Exception:
        raise Problem(
            "MODEL_CONFIG_INVALID", "本机模型配置无法读取，请在设置中重新保存", 503
        ) from None


# 从当前生效配置构造可返回前端的脱敏视图。
def public(config):
    current = resolve(config)
    return ModelPublic(
        model=current.model_name,
        base_url=current.model_base_url,
        key_configured=bool(current.model_api_key.get_secret_value()),
        source="settings"
        if (config.data_dir / "model-config.json").exists()
        else "environment",
    )


# 同一服务允许留空沿用密钥，换服务必须重填。
# 临时文件设为 0600，刷盘后原子替换，避免 worker 读到半写入配置。
def save(config, body):
    key = body.api_key.get_secret_value().strip() if body.api_key else ""
    if not key:
        current = resolve(config)
        if body.base_url != current.model_base_url.rstrip("/"):
            raise Problem(
                "MODEL_KEY_REQUIRED", "更换服务地址时请同时填写新 API Key", 422
            )
        key = current.model_api_key.get_secret_value()
    if not key:
        raise Problem("MODEL_KEY_REQUIRED", "请填写 API Key", 422)
    config.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix=".model-", dir=config.data_dir)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(
                {"model": body.model, "base_url": body.base_url, "api_key": key}, f
            )
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, config.data_dir / "model-config.json")
    finally:
        if os.path.exists(name):
            os.unlink(name)
    return public(config)
