# 小红书 MCP 适配层：只读工具调用、平台字段归一化和外部错误转换。
# worker 只接触统一样本结构，不需要了解 MCP 原始响应格式。

import asyncio
import json
import re
from datetime import datetime, timezone

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from .storage import Problem

READ_TOOLS = {"check_login_status", "search_feeds", "get_feed_detail"}


def mcp_problem(error):
    """SDK 的任务组会包装异常；保留业务错误，避免把工具失败误报为断连。"""
    if isinstance(error, BaseExceptionGroup):
        errors = [mcp_problem(child) for child in error.exceptions]
        return next((e for e in errors if e.code != "MCP_UNAVAILABLE"), errors[0])
    if isinstance(error, Problem):
        return error
    if isinstance(error, (TimeoutError, httpx.TimeoutException)):
        return Problem("MCP_TIMEOUT", "小红书 MCP 请求超时，请稍后重新研究", 503)
    return Problem(
        "MCP_UNAVAILABLE", "无法连接小红书 MCP，请检查服务地址和运行状态", 503
    )


# 解析 1.2万、1k 等展示值并记录精度；未知值保留 None，不能当成零。
def metric(value):
    if value is None or isinstance(value, bool):
        return None, "unknown"
    raw = str(value).strip().replace(",", "")
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([万千亿wkWK]?)(\+?)", raw)
    if not m:
        return None, "unknown"
    scale = {"万": 10000, "千": 1000, "亿": 100000000, "w": 10000, "k": 1000}.get(
        m[2].lower(), 1
    )
    return int(float(m[1]) * scale), "approximate" if m[2] or m[3] or "." in m[
        1
    ] else "exact"


# 将 MCP 笔记详情转成内部结构，保留指标精度、评论覆盖和来源信息。
def normalize(detail, keyword, comment_limit):
    data = detail.get("data", detail)
    note = data.get("note")
    if not isinstance(note, dict) or not note.get("noteId"):
        raise Problem("MCP_SCHEMA_CHANGED", "详情字段不符合预期，请核对 MCP 版本", 503)
    id = str(note["noteId"])
    if not re.fullmatch("[a-zA-Z0-9_-]+", id):
        raise Problem("MCP_SCHEMA_CHANGED", "笔记 ID 格式异常", 503)
    user = note.get("user") or {}
    stats = note.get("interactInfo") or {}
    raw = {
        name: stats.get(key)
        for name, key in [
            ("likes", "likedCount"),
            ("saves", "collectedCount"),
            ("comments", "commentCount"),
        ]
    }
    parsed = {key: metric(value) for key, value in raw.items()}
    published = None
    if isinstance(note.get("time"), (float, int)):
        try:
            published = datetime.fromtimestamp(
                note["time"] / 1000, timezone.utc
            ).isoformat()
        except (ValueError, OverflowError, OSError):
            pass
    comment_data = data.get("comments") or {}
    all_comments = comment_data.get("list") or []
    comments = [
        {"id": str(c.get("id", "")), "content": str(c.get("content", ""))[:4000]}
        for c in all_comments[:comment_limit]
    ]
    return {
        "platform_id": id,
        "title": note.get("title") or "无标题",
        "author": user.get("nickname") or user.get("nickName") or "未知作者",
        "author_id": user.get("userId"),
        "body": str(note.get("desc") or "")[:30000],
        "topic": "未分类",
        "format": "视频" if note.get("type") == "video" else "图文",
        "published_at": published,
        "source_url": f"https://www.xiaohongshu.com/explore/{id}",
        **{key: pair[0] for key, pair in parsed.items()},
        "metric_raw": raw,
        "metrics_precision": "approximate"
        if any(p[1] == "approximate" for p in parsed.values())
        else "unknown"
        if any(p[1] == "unknown" for p in parsed.values())
        else "exact",
        "comment_samples": comments,
        "comment_coverage": {
            "loaded": len(comments),
            "limit": comment_limit,
            "complete": comment_limit > 0
            and not comment_data.get("hasMore", True)
            and len(all_comments) <= comment_limit,
        },
        "media_analyzed": False,
    }


# 集中封装只读 MCP 能力，避免业务代码直接调用发布或互动工具。
class MCPConnector:
    def __init__(self, config):
        self.config = config

    # 白名单校验后建立 MCP 会话；兼容结构化响应与文本 JSON，并统一错误。
    async def call(self, name, args):
        if name not in READ_TOOLS:
            raise Problem("TOOL_NOT_ALLOWED", "研究服务仅允许只读工具", 403)
        try:
            async with asyncio.timeout(self.config.tool_timeout):
                async with streamablehttp_client(self.config.mcp_url) as (
                    reader,
                    writer,
                    _,
                ):
                    async with ClientSession(reader, writer) as session:
                        await session.initialize()
                        result = await session.call_tool(name, args)
                        if result.isError:
                            # 上游浏览器等待页面超时也会通过工具错误返回。
                            # 仅识别错误类别，不向前端暴露原始响应。
                            error_text = "\n".join(
                                x.text for x in result.content if x.type == "text"
                            ).lower()
                            if "mcp_filter_not_applied" in error_text:
                                raise Problem(
                                    "MCP_FILTER_NOT_APPLIED",
                                    "小红书搜索筛选未确认生效，请稍后重试；未采用未筛选的结果",
                                    503,
                                )
                            if any(
                                s in error_text
                                for s in (
                                    "context deadline exceeded",
                                    "timeout",
                                    "timed out",
                                )
                            ):
                                raise Problem(
                                    "MCP_TIMEOUT",
                                    "MCP 已连接，但小红书页面加载或工具执行超时，请稍后重新研究",
                                    503,
                                )
                            raise Problem(
                                "MCP_TOOL_FAILED",
                                "小红书工具执行失败，请检查登录或平台访问限制",
                                503,
                            )
                        if result.structuredContent:
                            return result.structuredContent
                        text = "\n".join(
                            x.text for x in result.content if x.type == "text"
                        )
                        if name == "check_login_status":
                            try:
                                return json.loads(text)
                            except ValueError:
                                return {
                                    "is_logged_in": (
                                        "已登录" in text and "未登录" not in text
                                    )
                                }
                        try:
                            return json.loads(text)
                        except ValueError:
                            raise Problem(
                                "MCP_SCHEMA_CHANGED",
                                "MCP 未返回可解析的数据，请核对版本",
                                503,
                            )
        except Problem:
            raise
        except Exception as error:
            raise mcp_problem(error) from None

    # 检查已有登录态；此方法不会替用户完成扫码登录。
    async def login(self):
        data = await self.call("check_login_status", {})
        value = data.get("is_logged_in", data.get("isLoggedIn", False))
        if value is not True:
            raise Problem(
                "LOGIN_REQUIRED", "小红书未登录，请先在本机 MCP 完成登录", 503
            )

    # 七天条件交给平台筛选；三十天范围还需 worker 按发布时间本地过滤。
    async def search(self, keyword, days, sort, content_type="all"):
        return await self.call(
            "search_feeds",
            {
                "keyword": keyword,
                "filters": {
                    "sort_by": sort,
                    "note_type": {"all": "不限", "image": "图文", "video": "视频"}[
                        content_type
                    ],
                    "publish_time": "一周内" if days == 7 else "不限",
                },
            },
        )

    # 安全令牌仅随详情请求使用；评论抓取受 comment_limit 限制。
    async def detail(self, feed, comment_limit):
        return await self.call(
            "get_feed_detail",
            {
                "feed_id": feed["id"],
                "xsec_token": feed["xsecToken"],
                "load_all_comments": comment_limit > 10,
                "limit": max(1, comment_limit),
                "click_more_replies": False,
                "scroll_speed": "slow",
            },
        )
