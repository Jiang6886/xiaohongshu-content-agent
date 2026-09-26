# 拾叶真实后端

FastAPI + SQLAlchemy / SQLite + 独立 worker + AgentScope 2.0.8 + MCP Python SDK。依赖由 `uv.lock` 锁定，使用 Python 3.12。

## 启动

在项目根目录执行：

```bash
uv sync --project backend --frozen
./scripts/start-backend.sh
```

- 应用与生产前端：http://127.0.0.1:8000/（需先在 frontend 执行 `npm run build`）
- Swagger：http://127.0.0.1:8000/docs
- 健康状态：http://127.0.0.1:8000/api/v1/health
- 开发前端：另一个终端执行 `cd frontend && npm run dev`，默认真实 API 模式。

启动脚本启动自己的 worker，结束时只停止该 worker。若已有 worker，先在原终端停止，单 worker 文件锁会拒绝第二个实例。API 与 worker 也可分别运行：

```bash
backend/.venv/bin/python -m uvicorn xhs_content_agent.app:app --host 127.0.0.1 --port 8000
backend/.venv/bin/python -m xhs_content_agent.worker
```

这两个命令分别在两个终端执行。长任务不会依赖浏览器心跳。工作目录中的 `data/studio.sqlite3` 是真实数据库，不会自动填入演示数据。

## 模型配置

推荐在网页 **设置 → 模型服务** 中填写 Base URL、模型名称和 API Key，保存即生效，不需要重启。使用同一服务时 API Key 留空表示保留；切换地址必须同时填写新 Key。测试按钮会发送一次最多 64 个输出 token 的真实请求。

也可使用环境变量作为首次配置（网页配置优先）：

```dotenv
XHS_MODEL_NAME=你的模型名称
XHS_MODEL_BASE_URL=https://你的服务地址/v1
XHS_MODEL_API_KEY=你的密钥
XHS_MCP_URL=http://127.0.0.1:18060/mcp
```

仅服务端读取密钥，不要把密钥写进 `VITE_*` 或提交到 Git。使用 OpenAI 兼容的 Chat Completions 接口，通过 AgentScope 2.0.8 的 OpenAIChatModel 调用；具体提供商的兼容性仍需真实凭证验证。网页配置保存在 `data/model-config.json`（权限 0600，本机明文文件），不进入业务设置、任务载荷或前端存储，接口不回传密钥。API 和 worker 每次调用都读取完整的最新模型/地址/密钥组合；进行中的请求不受影响。更改 .env 后仍需重启，但已有网页配置优先。

固定工作流分别执行主题分类/选题与草稿任务，不启用具有浏览器写权限的自主工具代理。API 客户端自动重试关闭，避免隐性重复费用；失败由用户决定是否重试。输入素材有明确长度和任务预算限制，预算按 UTF-8 字节数保守估算并预留输出，不是模型精确 tokenizer；返回 token 用量单独记录。预算不足返回明确错误。

模型输出进行 Pydantic 校验与证据 ID 校验。数字统计由代码执行，生成内容仍需作者核对实际经历和事实。模型未配置时生成接口返回 503；采集成功但分析不可用时研究显示“部分完成”，已有笔记保留。

## 小红书连接

适配 [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp)，本地 HTTP MCP 默认 18060/mcp。本机已通过 Docker 部署 v2.5.5，镜像固定为内容摘要，端口仅绑定 127.0.0.1。启动与扫码步骤见 [部署说明](../deploy/xiaohongshu-mcp/README.md)。当前后端不接管账号密码，不提供自动绕过验证；账号需用手机扫码确认，真实搜索/详情仍需登录后验收。

使用的工具白名单仅为 check_login_status / search_feeds / get_feed_detail。没有发布、评论或点赞能力。登录二维码请使用 MCP 自带登录流程。

采样采用“最新”和“最多收藏”搜索；一周使用平台一周筛选，30 天用不限搜索再根据详情发布时间过滤。发布时间未知的样本保留并注明；搜索覆盖率未知，不能当全站数据。首版不滚动无限分页，只使用每次搜索工具实际返回的集合。评论可能由源页面默认返回前若干条，保存时再按预算截断，显示真实保存覆盖。

访问令牌只用于当前详情请求，不写入 API 结果或持久化样本。规范化证据保存标题、正文、原始指标显示值、采样时间、来源查询、内容哈希和评论样本；图片/视频未分析。

## 无账号时验证

研究任务页支持导入 JSON。格式见 `docs/api/examples/import-template.json`。示例明确标为测试素材；不要作为真实平台数据使用。导入不需要 MCP 或模型，能验证存储、去重、排除、统计和导出；生成选题/文章仍要求真实模型配置。

## 恢复与数据

- 数据库启用 WAL 与事务。批次内按平台 ID 去重，保留查询命中关系；每批保留内容与指标快照。
- API 创建请求使用 Idempotency-Key，相同键和内容返回原资源，不同内容返回 409。
- 任务以 queued 开始，独立 worker 顺序执行。取消在步骤边界生效，正在进行的工具或模型请求不会立即消失，最多等待配置的超时。
- 采集进程中断后，worker 启动时重新搜索并跳过已保存样本；旧的模型阶段标记失败，不自动再付费执行。手动重试创建新 job，并保留已有数据。
- 草稿使用乐观锁，完整历史存在 draft_versions。版本冲突返回 409，不覆盖新版本。
- 排除样本后统计实时重算，模型建议标记 stale，需手动重新分析。
- 单用户本机使用；无多人权限系统，不能直接绑定公网。本地来源白名单不等于用户认证。
- schema_version 当前为 1，仅支持初始建表。未来结构变化需增加版本化迁移；不要删除真实数据库来“迁移”。

## 验证与代码

```bash
backend/.venv/bin/pytest -q backend/tests
backend/.venv/bin/ruff check backend/src backend/tests
cd frontend
npm run test:live
```

测试隔离数据目录，模型响应与 MCP 返回使用测试替身，不访问真实账号或付费服务。其中 AgentScope 测试会用真实已安装 SDK 构造请求，再由内存 HTTP transport 返回响应，验证序列化兼容。

- app.py：HTTP 路由与输入输出契约。
- storage.py：SQLite 表、事务、幂等和快照。
- worker.py：队列、恢复、预算、采集/分析/写作流程。
- connectors.py：只读 MCP 适配及指标解析。
- intelligence.py：AgentScope 2.0.8 模型适配。
- analytics.py：可重复的报告统计。
- schemas.py：请求、响应与模型输出结构。

参考：[AgentScope 2.0.8](https://docs.agentscope.io/en/versions/2.0.8)、[MCP 工具定义](https://github.com/xpzouying/xiaohongshu-mcp/blob/main/mcp_server.go)。

## 真实 Skills 研究验收

已完成 6 篇真实样本的采集与通义模型分析，结果与页面核对见 [验收记录](../docs/Skills研究页面验收.md)。百炼域名上的 Qwen3.5/3.6/3.7 Flash/Plus/Max 自动启用非思考 JSON Object 输出；其它服务不发送这些提供商专用参数。解析失败仍记录已报告的 token 用量。分析重试成功会修复采集已完成研究的旧失败状态，不会抹掉采集未完成的问题。
