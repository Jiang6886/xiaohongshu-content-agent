#!/usr/bin/env python3
"""Local QR login helper. Uses only the upstream login endpoints."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx

PAGE = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>拾叶 · 小红书登录</title>
<style>body{background:#f7f4ee;color:#293631;font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh}main{background:#fcfaf6;border:1px solid white;border-radius:24px;padding:32px;max-width:460px;text-align:center;box-shadow:6px 8px 24px #29363112}button{border:0;background:#28665d;color:white;border-radius:12px;padding:12px 20px;cursor:pointer;margin:6px}button:disabled{opacity:.5}img{width:260px;height:260px;object-fit:contain}p{line-height:1.7}small{color:#59665f}</style>
<main><h1>小红书扫码登录</h1><p>用手机小红书 App 扫描二维码，<br>并在手机上确认登录。</p><img id="qr" alt="登录二维码" hidden><p id="status">点击下方按钮获取二维码</p><button id="refresh">获取 / 刷新二维码</button><button id="check">我已扫码，检查登录</button><p><small>二维码过期后可刷新。登录状态只保存在本机。</small></p><a href="http://127.0.0.1:8000/settings">返回拾叶设置</a></main>
<script>
const statusEl=document.querySelector('#status'),qr=document.querySelector('#qr');
async function call(path){document.querySelectorAll('button').forEach(b=>b.disabled=true);statusEl.textContent='正在连接，请稍候…';try{const r=await fetch(path,{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'连接失败');if(d.is_logged_in){qr.hidden=true;statusEl.textContent='登录成功，可以返回拾叶开始研究。';}else if(d.img){qr.src=d.img.startsWith('data:image/')?d.img:'data:image/png;base64,'+d.img;qr.hidden=false;statusEl.textContent='请尽快扫码；二维码会在数分钟后过期。';}else{statusEl.textContent='尚未登录，请扫码并在手机上确认。';}}catch(e){statusEl.textContent=e.message;}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
document.querySelector('#refresh').onclick=()=>call('/qrcode');document.querySelector('#check').onclick=()=>call('/status');
</script></html>'''


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.headers.get('Host') != '127.0.0.1:18061':
            self.send_error(403)
            return
        origin = self.headers.get('Origin')
        if origin and origin != 'http://127.0.0.1:18061':
            self.send_error(403)
            return
        if self.path == '/':
            body, mime, code = PAGE.encode(), 'text/html; charset=utf-8', 200
        elif self.path in {'/qrcode', '/status'}:
            try:
                response = httpx.get('http://127.0.0.1:18060/api/v1/login/' + self.path[1:], timeout=100)
                response.raise_for_status()
                data = response.json()
                if not data.get('success'):
                    raise ValueError('login failed')
                safe = {k: v for k, v in data['data'].items() if k in {'is_logged_in', 'img', 'timeout'}}
                cookie = Path(__file__).resolve().parents[1] / 'data/mcp/cookies.json'
                if cookie.exists():
                    cookie.chmod(0o600)
                body, mime, code = json.dumps(safe).encode(), 'application/json', 200
            except Exception:
                body, mime, code = json.dumps({'error': '无法获取登录信息，请确认 MCP 已启动并稍后重试。'}).encode(), 'application/json', 502
        else:
            self.send_error(404)
            return
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    print('登录页：http://127.0.0.1:18061（Ctrl+C 停止；MCP 容器继续运行）', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 18061), Handler).serve_forever()
