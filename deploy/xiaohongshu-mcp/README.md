# 拾叶的小红书 MCP

上游：https://github.com/xpzouying/xiaohongshu-mcp

本项目使用维护者 Docker 镜像，Intel Mac 运行 linux/amd64。18060 只绑定 127.0.0.1。先启动 Docker Desktop，再在项目根目录执行：

```bash
./scripts/start-mcp.sh
backend/.venv/bin/python scripts/mcp-login.py
```

打开 http://127.0.0.1:18061，点击获取二维码，用手机小红书扫码并确认，然后点击检查登录。登录页仅代理上游两个登录接口，不暴露发布等操作。登录助手可以 Ctrl+C 关闭，MCP 容器继续运行。

后端默认使用 `http://127.0.0.1:18060/mcp`。登录后在拾叶设置 → 连接与数据 → 检查连接。

登录数据保存在 `data/mcp/`（已被 Git 忽略，目录权限 0700）。不要分享 Cookie 文件。容器会在 Docker 引擎重启后恢复运行；不自动修改 Docker Desktop 的开机启动偏好。

```bash
# 状态
docker compose -f deploy/xiaohongshu-mcp/compose.yaml ps
# 停止，保留登录数据
docker compose -f deploy/xiaohongshu-mcp/compose.yaml stop
# 启动
docker compose -f deploy/xiaohongshu-mcp/compose.yaml up -d
```

后端研究工具仍限定为登录检查、搜索、读取详情。上游镜像本身包含其它工具，本项目不会调用发布、点赞或评论工具。

本次部署版本：健康接口 v2.5.5（MCP 协议 serverInfo 为 2.0.0）。Compose 固定镜像 digest `sha256:5bc690d0c7907f069886ddeb6b37abbe4bdd37bd431975b914c7c27435b1b602`，避免下次启动隐式换版本。健康检查和 MCP initialize/tools/list 已通过，三个研究工具的参数与后端匹配。

2026-09-26 本机验收：手机扫码登录成功；项目 `/api/v1/connections` 返回 MCP connected、worker running；通过后端适配器搜索“AI办公”返回 17 条含详情访问字段的结果。登录 Cookie 文件权限已设为 0600。
单篇详情联调也通过：成功解析标题及 612 字符正文，评论保存数为 0（验证时主动关闭评论保存）。此次验证未调用模型、未写入研究数据库、未进行平台发布/互动操作。
