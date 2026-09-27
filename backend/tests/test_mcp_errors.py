"""覆盖 MCP SDK 任务组包装错误的真实退出路径。"""

from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest

from xhs_content_agent import connectors
from xhs_content_agent.config import Config
from xhs_content_agent.storage import Problem


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("context deadline exceeded", "MCP_TIMEOUT"),
        ("platform access failed", "MCP_TOOL_FAILED"),
        ("MCP_FILTER_NOT_APPLIED: stale", "MCP_FILTER_NOT_APPLIED"),
    ],
)
async def test_tool_error_survives_task_group(monkeypatch, text, expected):
    @asynccontextmanager
    async def transport(*args):
        try:
            yield None, None, None
        except Exception as error:
            raise ExceptionGroup("transport", [error])

    class Session:
        def __init__(self, *args):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def initialize(self):
            pass

        async def call_tool(self, *args):
            return SimpleNamespace(
                isError=True,
                content=[SimpleNamespace(type="text", text=text)],
            )

    monkeypatch.setattr(connectors, "streamablehttp_client", transport)
    monkeypatch.setattr(connectors, "ClientSession", Session)
    with pytest.raises(Problem) as caught:
        await connectors.MCPConnector(Config(_env_file=None)).call("search_feeds", {})
    assert caught.value.code == expected
    assert text not in caught.value.message


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (httpx.ConnectError("private endpoint"), "MCP_UNAVAILABLE"),
        (TimeoutError(), "MCP_TIMEOUT"),
        (
            ExceptionGroup(
                "outer", [ExceptionGroup("inner", [httpx.ReadTimeout("secret")])]
            ),
            "MCP_TIMEOUT",
        ),
        (
            ExceptionGroup("outer", [Problem("MCP_SCHEMA_CHANGED", "字段变化", 503)]),
            "MCP_SCHEMA_CHANGED",
        ),
    ],
)
def test_transport_error_categories(error, expected):
    result = connectors.mcp_problem(error)
    assert result.code == expected
    assert "secret" not in result.message
    assert "private endpoint" not in result.message
