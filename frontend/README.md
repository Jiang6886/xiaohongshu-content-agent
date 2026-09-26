# 拾叶 · 内容研究台前端

React + TypeScript + Ant Design + Vite。遵循项目第一套视觉 skill。默认连接真实后端，四页通过 HTTP 读写 SQLite；需先按 backend/README.md 启动 API 与 worker。

## 本地运行

```bash
cd ~/Documents/xiaohongshu-content-agent/frontend
npm ci
npm run dev
```

打开终端显示的本机地址（默认 http://127.0.0.1:5173）。Node.js 使用本次验证的 24.x，依赖由 package-lock.json 锁定。

```bash
npm run build
npm run preview
npm test                 # 独立演示模式回归
npm run test:live        # 独立临时数据库的真实 HTTP 联调
```

浏览器测试首次运行需 `npx playwright install chromium`。

## 功能（同时保留独立演示模式）

- 研究任务：配置范围、创建模拟任务、进度、取消、查看结果。
- 样本与分析：研究选择、样本计数、话题分布、筛选、点赞排序、详情、排除/恢复、JSON 导出。
- 选题与草稿：证据查看、收藏、写作材料、模板草稿、Markdown 编辑/预览、保存最新版本、下载。
- 设置：作者资料、预算、模拟连接说明、重置演示数据。

仅在 `VITE_DATA_MODE=demo` 启动时，演示数据保存在当前浏览器 localStorage（xhs-studio-demo-v1）。不得放真实密钥。新任务固定复制最多 12 条虚构素材，不按输入实时生成；任务进度按本地时间模拟。模型不实际调用。正式后端应保存完整草稿历史。

## 代码与对接

- `src/api.ts`：HTTP 请求、幂等标识、任务轮询与模式选择。
- `src/api.mock.ts`：隔离的演示实现；`src/types.ts`：业务类型。
- `src/main.tsx`：应用布局与路由。
- `src/pages/`：四个业务页面；`src/components/`：共享页面标题。
- `src/style.css`：第一套风格与响应式样式。
- `tests/`：关键浏览器流程检查。
- `../docs/api/API接口说明.md` 与 `openapi.json`：后端契约。

真实模式中可导入 JSON 素材、查看后台失败和重试、读取历史草稿版本；模型未配置不会伪造文章。通过 `VITE_DATA_MODE=demo npm run dev` 可以启动演示版。开发代理已预留 `/api` 到 localhost:8000。部署时需 SPA fallback，以支持刷新子路由。
