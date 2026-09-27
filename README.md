# 小红书选题与内容研究助手

根据小红书样本数据发现读者需求、研究话题与标题表达，结合作者自己的经验，辅助生成有依据的原创选题和文章草稿。

技术栈：React + TypeScript + Ant Design + Vite；FastAPI + AgentScope；SQLite；本地小红书 MCP。

阅读代码可从[代码阅读指南](docs/代码阅读指南.md)开始：包含模块职责、推荐阅读顺序和完整研究流程，前后端源码已补充中文注释。

当前状态：已实现 React 前端与真实 FastAPI / SQLite 后端、独立 worker、AgentScope 模型及只读 MCP 适配器。小红书 MCP 和已配置通义模型已完成真实研究联调：6 篇样本生成 5 个候选选题，页面与后端数据核对通过。

- [项目计划](./项目计划.md)：目标、模块、功能用途、技术栈、数据设计、实施阶段和验收标准。

- [界面设计说明](./docs/design/界面设计说明.md)：四个页面的职责与效果图。

项目目录：`~/Documents/xiaohongshu-content-agent`（访达中的“文稿”目录）。

- [前端设计 skill](.agents/skills/xhs-soft-glass-ui/SKILL.md)：基于 `1.jpg` 的配色、材质、组件与交互规范；项目 `AGENTS.md` 已关联。

- [第二套前端设计 skill](.agents/skills/xhs-ice-blue-dashboard/SKILL.md)：基于 `2.jpg` 的冰蓝科技看板，供选择使用。

## 运行前端

```bash
cd ~/Documents/xiaohongshu-content-agent/frontend
npm ci
npm run dev
```

- [前端说明](frontend/README.md)：运行、构建、测试与演示限制。
- [API 接口文档](docs/api/API接口说明.md)：页面需要的接口与后端实现规则。
- [OpenAPI 定义](docs/api/openapi.json)：30 个接口操作，可导入接口工具。
- [实际桌面截图](docs/design/frontend-analysis.png) / [手机截图](docs/design/frontend-mobile.png)。

## 运行真实后端

```bash
uv sync --project backend --frozen
./scripts/start-backend.sh
```

本机服务与构建后的前端：http://127.0.0.1:8000/；接口文档：http://127.0.0.1:8000/docs。

- [后端运行与配置](backend/README.md)
- [后端验收记录](docs/后端验收记录.md)

前端默认连接真实 API；演示模式通过 `VITE_DATA_MODE=demo` 单独开启，旧演示数据不会混入 SQLite。

模型可在 **设置 → 模型服务** 中填写服务地址、模型名称和 API Key。保存后对后续调用直接生效，无需重启；同一服务只换模型时 Key 留空保留。支持 OpenAI 兼容的文本对话接口。[模型设置截图](docs/design/settings-model.png)。

小红书 MCP 已部署到本机 Docker。使用 `./scripts/start-mcp.sh` 启动，扫码登录与停止方式见 [MCP 部署说明](deploy/xiaohongshu-mcp/README.md)。

[真实 Skills 研究与页面验收记录](docs/Skills研究页面验收.md)。
