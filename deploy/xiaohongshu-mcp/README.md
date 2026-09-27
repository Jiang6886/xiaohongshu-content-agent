# 拾叶的小红书 MCP

上游：https://github.com/xpzouying/xiaohongshu-mcp

本项目使用维护者 Docker 镜像，Intel Mac 运行 linux/amd64。18060 只绑定 127.0.0.1。先启动 Docker Desktop，再在项目根目录执行：

```bash
./scripts/start-mcp.sh
backend/.venv/bin/python scripts/mcp-login.py
```

打开 http://127.0.0.1:18061，点击获取二维码，用手机小红书扫码并确认，然后点击检查登录。登录页仅代理上游两个登录接口，不暴露发布等操作。登录助手可以 Ctrl+C 关闭，MCP 容器继续运行。

后端默认使用 `http://127.0.0.1:18060/mcp`。登录后在拾叶设置 → 连接与数据 → 检查连接。

登录数据保存在 `data/mcp/`（已被 Git 忽略，目录权限 0700）。不要分享 Cookie 文件。容器采用 unless-stopped 重启策略，未手动停止时会随 Docker 引擎恢复运行；不自动修改 Docker Desktop 的开机启动偏好。

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

## 高互动搜索修复（2026-09-28）

当前使用本地修复镜像 `shiye/xiaohongshu-mcp:v2.5.5-search-fix1`。Dockerfile 固定上游 v2.5.5 的提交 `a5c8f7799980ba1fdd501999843eb2d17e4c9a9f`，补丁保存在 `patches/search.patch`；运行环境和浏览器仍复用上面的原始固定镜像。首次构建需要下载 Go 构建镜像和依赖。

排查发现：失败时浏览器已有搜索结果、当前文档也已有 `__INITIAL_STATE__`，但 MCP 仍在 `search.go:120` 等待初始化。补丁不再在早期页面加载时缓存 JS window，而通过 CDP 在当前文档检查就绪。此现象与旧执行上下文有关，未将其认定为小红书明确封禁。

同时，每次点击筛选项都单独等待结果刷新。超过等待时限返回 `MCP_FILTER_NOT_APPLIED`，不再静默返回可能未筛选的旧数据。结果集完全相同或为空时也可能被保守拒绝；这优先保证研究不会把无法确认的结果当作高互动样本。

后端仅对搜索超时或筛选未确认生效自动重试一次，保留关键词、时间、排序和内容类型。重试计入工具预算，并在重试前检查取消；登录失败和无法连接不自动重试。没有降级为“最新”排序。

```bash
# 构建并启动修复版，沿用 data/mcp 中的登录态
# 已有研究任务时先等待任务结束。
docker compose -f deploy/xiaohongshu-mcp/compose.yaml build
./scripts/start-mcp.sh

# 只读验收：skill、近一周、三种高互动排序；不调用模型或写入研究库
backend/.venv/bin/python scripts/check-engagement-mcp.py
```

首次真实验收：最多点赞 20 条 / 14.3 秒，最多收藏 20 条 / 14.2 秒，最多评论 20 条 / 18.3 秒。第二轮再次全部通过：点赞 20 条 / 13.9 秒、收藏 20 条 / 14.1 秒、评论 20 条 / 15.7 秒。连续两轮成功仍不代表平台以后不会超时，后端会保留真实错误并允许重新研究。后端回归 46 项通过，覆盖超时/工具错误分类、同参数重试、次数上限、预算和取消。

若需回退：将 compose 的 `image` 改回原始固定镜像，删除 `build` 配置后执行 `docker compose -f deploy/xiaohongshu-mcp/compose.yaml up -d`。登录卷不变，无需删除 Cookie。原始镜像仍保留在本机。
