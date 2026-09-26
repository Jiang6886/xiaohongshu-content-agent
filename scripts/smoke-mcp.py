import asyncio
import json
from xhs_content_agent.config import Config
from xhs_content_agent.connectors import MCPConnector, normalize

async def main():
    connector = MCPConnector(Config())
    await connector.login()
    print('登录状态：已登录', flush=True)
    result = await connector.search('AI办公', 7, '最新')
    feeds = result.get('feeds', result.get('data', {}).get('feeds', []))
    feeds = [f for f in feeds if f.get('id') and f.get('xsecToken')]
    print(json.dumps({'search_results': len(feeds)}, ensure_ascii=False), flush=True)
    if feeds:
        detail = await connector.detail(feeds[0], 0)
        note = normalize(detail, 'AI办公', 0)
        print(json.dumps({'detail_parsed': True, 'has_title': bool(note['title']), 'body_length': len(note['body']), 'comments_saved': len(note['comment_samples'])}, ensure_ascii=False), flush=True)

asyncio.run(main())
