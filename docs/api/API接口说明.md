# 后端 API 接口说明 v0.2

更新：2026-09-25。以下接口已在 FastAPI 实现。机器可读定义 [openapi.json](openapi.json) 由运行代码导出；运行时以 `/openapi.json` 和 `/docs` 为准。

## 运行与模式

- 服务：http://127.0.0.1:8000；API 前缀 `/api/v1`。
- 前端默认真实服务模式，数据来自 SQLite，不会将浏览器演示数据自动导入。
- `VITE_DATA_MODE=demo` 可单独启动旧模拟前端；两套数据互不覆盖。
- 模型和 MCP 未配置时有明确错误，不会用固定模板或虚构样本冒充成功。
- 运行与配置见 [后端说明](../../backend/README.md)。

## 接口清单

| 方法与路径（均带 /api/v1 前缀） | 用途 | 成功响应 |
| --- | --- | --- |
| GET `/health` | API 与 worker 健康状态 | status,worker,mode |
| GET `/connections` | MCP 登录检查、模型配置状态 | mcp,model,worker |
| GET `/settings` | 读取作者与预算（model 为旧版兼容字段） | Settings |
| GET `/model-config` | 读取当前模型、地址和是否保存密钥 | ModelPublic |
| PUT `/model-config` | 保存即时生效的模型配置；api_key 可省略保留 | ModelPublic |
| POST `/model-config/test` | 对已保存模型发起少量 token 的真实调用 | status,message |
| PUT `/settings` | 保存完整设置 | Settings |
| GET `/research-runs` | 分页研究列表 | Page[ResearchOut] |
| POST `/research-runs` | 创建真实采集任务 | 202，research_run_id,job_id |
| POST `/imports` | 手工 JSON 导入素材 | 201，research_run_id,imported |
| GET `/research-runs/{id}` | 研究详情与原始范围 | ResearchOut |
| GET `/jobs` | 分页任务列表 | Page[JobOut] |
| GET `/jobs/{id}` | 任务进度、错误、用量 | JobOut |
| POST `/jobs/{id}/cancel` | 请求协作取消 | 202，JobOut |
| POST `/jobs/{id}/retry` | 手动重试失败、取消、部分完成任务 | 202，job_id |
| GET `/research-runs/{id}/notes` | 分页筛选样本 | Page[NoteOut] |
| GET `/research-runs/{id}/notes/export` | 导出匹配的全部样本 | JSON 附件 |
| GET `/research-runs/{id}/notes/{note_id}` | 样本正文、指标、评论、证据来源 | NoteOut |
| PATCH `/research-runs/{id}/notes/{note_id}` | 批次内排除/恢复 | NoteOut |
| GET `/research-runs/{id}/report` | 有效样本统计和模型建议 | ReportOut |
| GET `/research-runs/{id}/topics` | 当前研究选题 | TopicOut[] |
| POST `/research-runs/{id}/topic-jobs` | 主题分类与选题生成 | 202，job_id |
| PATCH `/topics/{id}` | 收藏或取消收藏 | TopicOut |
| POST `/topics/{id}/draft-jobs` | 根据作者材料生成草稿 | 202，job_id |
| GET `/drafts` | 分页草稿列表，可筛选 topic_id | Page[DraftOut] |
| GET `/drafts/{id}` | 最新草稿 | DraftOut |
| POST `/drafts/{id}/versions` | 保存新版本 | 201，DraftOut |
| GET `/drafts/{id}/versions` | 分页历史版本，倒序 | Page[DraftOut] |
| GET `/drafts/{id}/export` | 导出最新或指定版本 | Markdown 附件 |

当前 22 个路径、26 个操作。POST topic-jobs 不需要 body；draft-jobs 的 body 为 `{brief}`。

## 请求与响应规则

- JSON 采用 snake_case。成功直接返回资源，没有外层 data 包装。
- 分页为 `{items,total,page,page_size}`，页码从 1 开始，默认 20 条，最大 100 条。
- ID 是服务端生成的不透明字符串。样本的 `platform_id` 与内部 `id` 分开，证据引用内部 ID。
- 时间字段为 ISO 8601；服务端生成 UTC。导入发布时间允许日期或 ISO 时间，客户端必须容忍未知值。
- 指标 `null` 代表未知，与 0 区分；`metric_raw` 保存平台展示值，`metrics_precision` 说明近似或未知精度。
- 非可信来源网页不能直接调用本地服务。初版只适用于本机单用户；来源白名单不是公网认证方案。
- 密钥、Cookie、短期访问令牌不通过这些业务接口返回。模型密钥通过 `/model-config` 保存到服务端权限 0600 的本机文件，不通过 GET 或业务接口返回；环境变量仅作为无网页配置时的后备。

统一错误：

```json
{"error":{"code":"VERSION_CONFLICT","message":"草稿已更新，请比较最新版本后再保存","details":{"current_version":2}},"request_id":"request-id"}
```

主要状态码：400 业务参数错误、403 不允许来源/操作、404 不存在、409 版本/幂等/任务冲突、422 字段校验、503 外部服务未配置或不可用。请求 ID 同时返回在 X-Request-ID。

## 幂等、队列与恢复

创建研究、导入、生成选题、生成草稿、重试任务要求 `Idempotency-Key`。同键同请求返回原资源，同键不同内容返回 409。当前后端持久保留幂等记录；未来增加过期回收时应保持至少 24 小时。前端请求结果不确定时保留该次操作的 key，重试可复用。

Job 状态为 queued / collecting / cleaning / analyzing / completed / partial / cancelled / failed。202 只表示入队，不表示完成；API 不执行长任务。Worker 领取任务后更新状态。Job 公开 usage，但不公开内部 payload。

取消先设置 cancel_requested，worker 在步骤边界检查。当前网络请求可能持续到配置的超时；终态任务取消不会倒退状态。失败/取消/部分完成可创建新 job 重试。相同研究已有活动任务时不允许重试或重复生成分析；草稿可对应不同写作简报独立排队。

前端活动任务约 2 秒刷新，空闲约 15 秒，网络异常退避至最多 30 秒。当前单用户前端为了兼容现有组件会读取全部分页并在表格内筛选；服务端已支持分页与筛选。大规模研究需进一步改为按当前批次加载和服务端分页。

重启后采集阶段重新搜索、跳过已保存样本；模型阶段中断不自动再次调用，以免重复付费。后台运行期间关闭网页不影响任务。前端草稿等待超过约 6 分钟会提示后台仍在执行，刷新后可从任务状态和草稿列表找回结果。

## 样本、统计与证据

样本查询参数：q（标题或作者）、topic、excluded、sort（likes_desc / likes_asc / published_desc）、page、page_size。缺失点赞在排序中置后。导出支持同样过滤，返回所有匹配项。

批次内按 platform_id 去重，多关键词命中保存 provenance。样本保存内容哈希、采样时间、规范化来源 URL、原始指标显示值与评论覆盖；评论只保存 ID 和正文，不额外保存无关个人信息。图片/视频正文未分析。

排除操作只影响当前批次。Report 统计立即重算，语义建议标记 analysis_stale；重新分析后解除。旧选题仍保留其证据关联，写作时遇到已排除的依据会拒绝生成。重新分析保留用户收藏的选题和已被草稿引用的选题。

Report 的 groups 来自已入库的 topic 标签。尚未模型分类时使用“未分类”，不能误当成已经归纳好的主题。生成选题时按预算选取素材，analysis_coverage 明确记录实际提供给模型的 ID。语义分类必须完整覆盖实际提供的集合，否则结果不入库。

当前前端标题表达观察仍是问号/数字/场景词的可解释规则计数，不能解释为标题点击率或模型效果评估。互动统计不外推全站热度。

## 导入

使用 [导入格式示例](examples/import-template.json)。结构为 `{research,notes}`。最多 100 条，且不能超过研究的 limit；重复 platform_id 只保存首条。示例是字段说明，不能冒充真实小红书素材。导入不自动调用模型，用户在分析页点击生成分析与选题。

来源链接仅允许小红书 HTTPS 域名，删除查询参数后保存。导入不会凭空生成曝光、互动或发布时间。

## 草稿与版本

生成请求：`{brief:"作者真实经历与资料"}`。返回 job_id；完成后 Job.result_id 指向草稿 ID。

保存请求：

```json
{"base_version":1,"title":"我的文章","body":"# 我的文章\n\n正文","brief":"我的实际经历"}
```

通过数据库事务与条件更新保证版本冲突返回 409。历史版本保存在 draft_versions（删除所属研究时一并删除）；GET versions 返回倒序。GET export 可指定 `?version=1`，附件为保存后的内容。

前端“导出 Markdown”仍允许导出编辑器未保存内容，这是本地文件操作；历史版本查看和保存均访问真实后端。模型的事实准确性和文字原创性仍需作者审阅，结构与证据 ID 校验不能替代事实核对。

## 外部配置状态

Connections.model 的 configured 只表示服务端存在配置，未对模型发起付费测试，不等于 connected。MCP 状态检查实际调用只读登录检查。初次连接必须完成本机安装与账号登录；详情解析依赖适配版本，字段变化将明确失败，不返回伪造样本。


### 模型设置（2026-09-26）

PUT `/model-config` 输入 `{model,base_url,api_key?}`。服务地址必须为 HTTPS（localhost/127.0.0.1/::1 可用 HTTP），不接受地址内凭证、query 或 fragment。API Key 省略或空白保留现有 Key；更改地址时必须提供新 Key，否则 422。返回 `{model,base_url,key_configured,source}`，source 为 settings/environment，不回传明文 Key。

写入通过权限 0600 临时文件和原子替换完成；每次模型调用读取一个完整配置快照，API/worker 无需重启。旧 Settings.model 不再控制实际调用，避免排队任务的旧模型名称与新服务密钥混用。连接测试仅在 POST 时执行，真实额度和提供商兼容性需用户自行测试，失败返回脱敏错误。

MCP 实际部署后，连接检查使用后端 `XHS_TOOL_TIMEOUT`（默认 90 秒）；前端连接检查单独允许等待 100 秒。浏览器冷启动和平台跳转可能超过原来的 8 秒，请等待检查完成。

### 删除研究

`DELETE /api/v1/research-runs/{id}`：成功返回 `204`，无响应正文；不存在返回 `404`。若研究下有排队、采集、整理或分析中的任务（包括生成草稿），返回 `409 JOB_ALREADY_RUNNING`，需先取消任务并等待停止。

删除在一个 SQLite 写事务内完成，清除研究、样本、指标快照、选题、关联草稿及全部历史版本、任务记录和指向它们的幂等结果。其他研究及全局设置保留。前端要求二次确认，删除后刷新列表并修正页码；删除当前研究时切换到剩余研究。删除不可恢复，请先导出需要保留的草稿。

### 高互动研究与共性分析

研究输入新增可选字段：`strategy`（recent/engagement，API 默认 recent 兼容旧调用；新建页面默认 engagement）、`rank_by`（balanced/likes/saves/comments）、`content_type`（all/image/video）、`min_likes`（默认 1000）、`min_saves`（300）、`min_comments`（100）。门槛为非负整数，任一开启项达标即可；0 关闭该项。高互动策略必须确认发布时间在范围内，未知时间不入选。

研究响应增加 `collection_summary`，报表响应增加 `collection_summary` 和 `patterns`。每条 pattern 包含 `observation`、`hypothesis`、`experiment`、`evidence_ids`；服务端校验证据至少有两个不同的本次输入样本。旧研究字段为空，重新分析后才可能生成共性。点击/涨粉、视觉分析均未提供，详见 [爆款研究说明](../爆款研究说明.md)。
