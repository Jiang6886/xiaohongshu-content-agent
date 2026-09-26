import asyncio
import json
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def main():
    async with streamablehttp_client('http://127.0.0.1:18060/mcp') as (reader, writer, _):
        async with ClientSession(reader, writer) as session:
            init = await session.initialize()
            tools = await session.list_tools()
            selected = [t for t in tools.tools if t.name in {'check_login_status', 'search_feeds', 'get_feed_detail'}]
            print(json.dumps({'server': init.serverInfo.model_dump(), 'tools': [{'name': t.name, 'inputSchema': t.inputSchema} for t in selected]}, ensure_ascii=False, indent=2))

asyncio.run(main())
