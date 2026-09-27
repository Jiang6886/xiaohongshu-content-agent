"""只读验收三种高互动排序；不调用模型、不写入研究库、不输出访问令牌。"""

import asyncio
import json
import time

from xhs_content_agent.config import Config
from xhs_content_agent.connectors import MCPConnector
from xhs_content_agent.storage import Problem


async def main():
    connector = MCPConnector(Config())
    await connector.login()
    failed = False
    for sort in ("最多点赞", "最多收藏", "最多评论"):
        started = time.monotonic()
        try:
            result = await connector.search("skill", 7, sort)
            feeds = result.get("feeds")
            if not isinstance(feeds, list):
                raise Problem("MCP_SCHEMA_CHANGED", "搜索结果缺少 feeds 数组")
            notes = [
                f for f in feeds if f.get("modelType", "note") == "note" and f.get("id")
            ]
            record = {"sort": sort, "ok": True, "notes": len(notes)}
        except Problem as error:
            failed = True
            record = {
                "sort": sort,
                "ok": False,
                "code": error.code,
                "message": error.message,
            }
        record["seconds"] = round(time.monotonic() - started, 1)
        print(json.dumps(record, ensure_ascii=False), flush=True)
        await asyncio.sleep(3)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
