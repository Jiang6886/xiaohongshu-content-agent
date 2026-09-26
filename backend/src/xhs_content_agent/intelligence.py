# AgentScope 模型适配层：执行一次结构化生成，返回 JSON 与供应商用量。
# 工具编排由 worker 控制，模型本身不会自主调用 MCP。

import asyncio
import json
import re
from urllib.parse import urlsplit

from agentscope.credential import OpenAICredential
from agentscope.message import Msg, TextBlock
from agentscope.model import OpenAIChatModel

from .storage import Problem
from .model_settings import resolve


class Intelligence:
    """AgentScope 2.0.8 model adapter, fixed semantic tasks without autonomous tools."""

    def __init__(self, config):
        self.config = config

    # 调用前重新解析配置，避免新密钥搭配旧任务中的模型名。
    # model 参数保留接口兼容，实际使用 config.model_name；关闭自动重试以控制用量。
    async def generate(self, system, user, model, max_tokens):
        config = resolve(self.config)
        if not config.model_configured:
            raise Problem(
                "MODEL_NOT_CONFIGURED", "尚未配置模型名称和服务端 API 密钥", 503
            )
        # 仅对下面匹配的 DashScope 模型启用 JSON 模式并显式关闭思考。
        # 其他 OpenAI 兼容服务不发送这些供应商专用参数。
        host = urlsplit(config.model_base_url).hostname or ""
        extra_body = None
        if host.endswith(".aliyuncs.com") and re.match(
            r"^qwen3\.[567]-(?:flash|plus|max)(?:-|$)", config.model_name
        ):
            extra_body = {
                "enable_thinking": False,
                "response_format": {"type": "json_object"},
            }
        actual_usage = {}
        client = OpenAIChatModel(
            credential=OpenAICredential(
                api_key=config.model_api_key,
                base_url=config.model_base_url or None,
            ),
            model=config.model_name,
            parameters=OpenAIChatModel.Parameters(max_tokens=max_tokens),
            stream=False,
            extra_body=extra_body,
            max_retries=0,
            client_kwargs={"timeout": config.model_timeout, "max_retries": 0},
        )
        try:
            async with asyncio.timeout(config.model_timeout):
                response = await client(
                    [
                        Msg(
                            name="system",
                            role="system",
                            content=[TextBlock(text=system)],
                        ),
                        Msg(name="user", role="user", content=[TextBlock(text=user)]),
                    ]
                )
            actual_usage = {
                "input_tokens": getattr(response.usage, "input_tokens", None),
                "output_tokens": getattr(response.usage, "output_tokens", None),
            }
            text = "\n".join(
                x.text for x in response.content if isinstance(x, TextBlock)
            )
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
            value = json.loads(text)
            return value, actual_usage
        except (ValueError, TypeError):
            raise Problem(
                "MODEL_INVALID_OUTPUT",
                "模型未返回合法 JSON；请检查模型配置或重试",
                502,
                details={"usage": actual_usage},
            ) from None
        except Problem:
            raise
        except Exception:
            raise Problem(
                "MODEL_CALL_FAILED",
                "模型调用失败，请检查服务地址、密钥、模型名称或超时",
                503,
            ) from None
        finally:
            await client.client.close()
