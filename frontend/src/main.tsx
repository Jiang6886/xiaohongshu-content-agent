// 应用入口与共享状态：路由、研究选择、数据轮询、新建研究和样本详情抽屉。
// 各业务页面通过 props 读取快照，通过 api 提交变更后刷新。

import BackendJobs from "./components/BackendJobs";
import { statusLabel, activeStatuses, isDemo, backend } from "./api";
import ResearchPage from "./pages/ResearchPage";
import Analysis from "./pages/Analysis";
import Writing from "./pages/Writing";
import SettingsPage from "./pages/SettingsPage";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  useNavigate,
  Navigate,
} from "react-router";
import {
  App as AntApp,
  ConfigProvider,
  Button,
  Input,
  InputNumber,
  Select,
  Tag,
  Table,
  Drawer,
  Form,
  Modal,
  Progress,
  Empty,
  Segmented,
  Alert,
  Spin,
  Popconfirm,
  Switch,
} from "antd";
import zhCN from "antd/locale/zh_CN";
import {
  AppstoreOutlined,
  ExperimentOutlined,
  BarChartOutlined,
  EditOutlined,
  SettingOutlined,
  PlusOutlined,
  ArrowRightOutlined,
  SearchOutlined,
  ExportOutlined,
  CheckOutlined,
  BookOutlined,
  FileTextOutlined,
  TeamOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import {
  api,
  download,
  type Database,
  type Research,
  type Note,
  type Topic,
  type Draft,
  type Settings,
} from "./api";
import "./style.css";
import { displayDate } from "./format";

// 未知互动数显示破折号，不能用零代替未采集到的数据。
const fmt = (n: number | null) =>
  n === null ? "未知" : n.toLocaleString("zh-CN");
// 共享工作区壳层；当前研究决定分析页看到的样本和选题范围。
function Shell() {
  const [db, setDb] = useState<Database>();
  const [error, setError] = useState("");
  // 会话只记住当前研究 ID；若记录不存在，下面会回退到第一项研究。
  const [run, setRun] = useState(
    sessionStorage.getItem("xhs-active-run") ?? "r-demo",
  );
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>();
  const [form] = Form.useForm();
  useEffect(() => {
    sessionStorage.setItem("xhs-active-run", run);
  }, [run]);
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  // 写操作后主动刷新；失败保留旧快照并展示错误，避免界面突然变为空白。
  const reload = async () => {
    try {
      setDb(await api.load());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    // 串行 setTimeout 避免请求重叠；有活动任务时 2 秒轮询，空闲时 15 秒。
    // 失败逐步退避至 30 秒，卸载后停止更新状态。
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 2000;
    const tick = async () => {
      try {
        const next = await api.load();
        if (stopped) return;
        setDb(next);
        setError("");
        delay =
          isDemo || next.jobs?.some((j) => activeStatuses.includes(j.status))
            ? 2000
            : 15000;
      } catch (e) {
        if (stopped) return;
        setError((e as Error).message);
        delay = Math.min(delay * 2, 30000);
      }
      if (!stopped) timer = setTimeout(tick, delay);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  // 页面共用的变更包装器：执行操作、刷新快照并统一显示成功/失败消息。
  async function act(fn: () => Promise<unknown>, success?: string) {
    try {
      await fn();
      await reload();
      if (success) message.success(success);
    } catch (e) {
      message.error((e as Error).message);
    }
  }
  // 从全局快照派生当前研究视图，不另存一份可能失步的样本列表。
  const active = db?.runs.find((r) => r.id === run) ?? db?.runs[0];
  const notes = db?.notes.filter((n) => n.run_id === active?.id) ?? [];
  const topics = db?.topics.filter((t) => t.run_id === active?.id) ?? [];
  return (
    <div className="workspace">
      <aside className="sidebar">
        <a href="/analysis" className="brand">
          <span className="brand-icon">叶</span>
          <span>
            拾叶<small>内容研究台</small>
          </span>
        </a>
        <div className="nav-caption">你的创作工作区</div>
        <nav>
          {[
            ["/research", <ExperimentOutlined />, "研究任务"],
            ["/analysis", <BarChartOutlined />, "样本与分析"],
            ["/writing", <EditOutlined />, "选题与草稿"],
            ["/settings", <SettingOutlined />, "设置"],
          ].map(([path, icon, label]) => (
            <NavLink key={String(path)} to={String(path)}>
              {icon}
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="leaf-art">✳</span>
          <h3>让灵感，有据可循。</h3>
          <p>
            从一次认真观察开始，
            <br />
            写下属于自己的内容。
          </p>
        </div>
        <div className="local">
          <i />
          {isDemo ? "本地演示工作区" : "本地工作区"}
          <small>
            {isDemo ? "仅模拟数据 · 未连接小红书" : "数据保存在本机数据库"}
          </small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            WORKSPACE <span className="slash">/</span> 个人创作空间
          </span>
          <div>
            <Tag bordered={false}>
              {isDemo ? "DEMO · 演示模式" : "LIVE · 本地服务"}
            </Tag>
            <span className="avatar">我</span>
          </div>
        </header>
        <div className="content">
          {error && (
            <Alert
              type="error"
              title={error}
              action={<Button onClick={reload}>重新连接</Button>}
              style={{ marginBottom: 20 }}
            />
          )}
          {!isDemo && db?.jobs && (
            <BackendJobs jobs={db.jobs} runs={db.runs} onChange={reload} />
          )}
          {!db ? (
            <div className="loading">
              <Spin />
              <p>正在打开你的工作区…</p>
            </div>
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to="/analysis" replace />} />
              <Route
                path="/research"
                element={
                  <ResearchPage
                    db={db}
                    onCreate={() => setCreating(true)}
                    onView={(id) => {
                      setRun(id);
                      navigate("/analysis");
                    }}
                    onCancel={(id) =>
                      act(
                        () => api.cancel(id),
                        isDemo
                          ? "任务已取消"
                          : "已请求取消，worker 将在步骤边界停止",
                      )
                    }
                  />
                }
              />
              <Route
                path="/analysis"
                element={
                  <Analysis
                    db={db}
                    active={active}
                    notes={notes}
                    topics={topics}
                    setRun={setRun}
                    onCreate={() => setCreating(true)}
                    inspect={setNote}
                    exclude={(n) => act(() => api.exclude(n.id, !n.excluded))}
                    goWrite={() => navigate("/writing")}
                  />
                }
              />
              <Route
                path="/writing"
                element={
                  <Writing
                    topics={topics}
                    db={db}
                    inspect={(id) => setNote(db.notes.find((n) => n.id === id))}
                    act={act}
                  />
                }
              />
              <Route
                path="/settings"
                element={<SettingsPage settings={db.settings} act={act} />}
              />
              <Route
                path="*"
                element={
                  <Empty description="这个页面不存在">
                    <Button onClick={() => navigate("/analysis")}>
                      返回工作区
                    </Button>
                  </Empty>
                }
              />
            </Routes>
          )}
          <footer>
            拾叶 CONTENT STUDIO <span>认真观察，自由创作。</span>
          </footer>
        </div>
      </main>
      <Modal
        title="开始一项新的研究"
        open={creating}
        onCancel={() => setCreating(false)}
        confirmLoading={busy}
        okText={isDemo ? "开始模拟研究" : "开始研究"}
        onOk={() => form.submit()}
      >
        <p className="muted">
          {isDemo
            ? "演示任务约 12 秒完成，生成固定示例素材；关键词不会触发真实采集。"
            : "提交后由后台采集真实样本。请先在设置页检查 MCP 和 worker 状态。"}
        </p>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            name: "我的新选题研究",
            keywords: ["AI 办公"],
            audience: "对 AI 感兴趣的初学者",
            days: 7,
            limit: 20,
          }}
          onFinish={async (values) => {
            setBusy(true);
            try {
              const r = await api.create(values);
              await reload();
              setRun(r.id);
              setCreating(false);
              navigate("/research");
              message.success(isDemo ? "模拟研究已开始" : "研究已加入后台队列");
            } catch (e) {
              message.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Form.Item
            name="name"
            label="研究名称"
            rules={[{ required: true, whitespace: true, max: 80 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="keywords"
            label="关键词"
            rules={[{ required: true, type: "array", min: 1, max: 10 }]}
          >
            <Select
              mode="tags"
              tokenSeparators={[",", "，"]}
              options={["AI 办公", "个人知识库", "效率工具"].map((value) => ({
                value,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="audience"
            label="目标读者"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input />
          </Form.Item>
          <div className="two">
            <Form.Item name="days" label="时间范围">
              <Select
                options={[
                  { value: 7, label: "最近 7 天" },
                  { value: 30, label: "最近 30 天" },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="limit"
              label="采样上限"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={100} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
      <Drawer
        title="样本与原始依据"
        open={!!note}
        onClose={() => setNote(undefined)}
        size={520}
      >
        {note && (
          <>
            <Tag>{isDemo ? "虚构样本" : "来源证据"}</Tag>
            <h2>{note.title}</h2>
            <p className="muted">
              {note.author} · {displayDate(note.published_at)}
            </p>
            <div className="evidence-stats">
              点赞 {fmt(note.likes)} · 收藏 {fmt(note.saves)} · 评论{" "}
              {fmt(note.comments)}
            </div>
            <p className="note-body">{note.body}</p>
            {note.source_url ? (
              <a href={note.source_url} target="_blank" rel="noreferrer">
                打开小红书原文 ↗
              </a>
            ) : (
              <Alert
                type="info"
                title={
                  isDemo ? "演示样本没有真实来源链接" : "此样本没有来源链接"
                }
              />
            )}
            {!isDemo && (
              <>
                <p className="muted">
                  采样：{note.captured_at} · 证据 ID：{note.id}
                </p>
                <p>
                  已保存评论 {note.comment_coverage?.loaded ?? 0} 条；
                  {note.comment_coverage?.complete
                    ? "已完整加载"
                    : "仅为部分样本"}
                </p>
                {note.comment_samples?.map((c) => (
                  <blockquote key={c.id}>{c.content}</blockquote>
                ))}
              </>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#28665d",
          colorText: "#293631",
          colorTextSecondary: "#59665f",
          colorBgLayout: "#f7f4ee",
          colorBgContainer: "#fcfaf6",
          colorBorder: "#b7c3ba",
          borderRadius: 12,
          controlHeight: 40,
          fontFamily:
            '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
        },
        components: {
          Table: { headerBg: "#f1f3ed" },
          Segmented: { trackBg: "#e9eee6", itemSelectedBg: "#fcfaf6" },
          Button: { primaryShadow: "0 4px 10px rgba(40,102,93,.16)" },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
