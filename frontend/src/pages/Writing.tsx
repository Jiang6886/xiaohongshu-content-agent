// 写作工作台：选题与证据 → 补充要求 → 生成 → 编辑/预览 → 保存版本或导出。
// 编辑中的草稿保存在组件本地，避免父组件轮询覆盖用户尚未保存的修改。

import { isDemo, backend } from "../api";
import React, { useState, useEffect } from "react";
import {
  App as AntApp,
  Button,
  Input,
  InputNumber,
  Select,
  Tag,
  Table,
  Form,
  Progress,
  Empty,
  Segmented,
  Alert,
  Popconfirm,
  Switch,
} from "antd";
import {
  AppstoreOutlined,
  ExperimentOutlined,
  EditOutlined,
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
import {
  api,
  download,
  type Database,
  type Research,
  type Note,
  type Topic,
  type Draft,
  type Settings,
} from "../api";
import Heading from "../components/Heading";
import ReactMarkdown from "react-markdown";
export default function Writing({
  topics,
  db,
  inspect,
  act,
}: {
  topics: Topic[];
  db: Database;
  inspect: (id: string) => void;
  act: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
}) {
  // 独立维护编辑副本；只有生成、选取或保存草稿时才显式替换它。
  const [draft, setDraft] = useState<Draft>();
  const [selected, setSelected] = useState<Topic>();
  const [brief, setBrief] = useState("");
  const [tab, setTab] = useState("编辑");
  const [busy, setBusy] = useState(false);
  // 标记未保存修改，用于页面离开和切换草稿前的确认。
  const [dirty, setDirty] = useState(false);
  const { modal, message } = AntApp.useApp();
  // 按需读取历史版本并只读展示，不把历史内容直接覆盖到编辑器。
  const showHistory = async () => {
    if (!draft) return;
    try {
      const list = await backend.history(draft.id);
      modal.info({
        title: "历史版本",
        width: 650,
        content: (
          <div style={{ maxHeight: 500, overflow: "auto" }}>
            {list.map((d) => (
              <details key={d.version}>
                <summary>
                  v{d.version} · {d.title} ·{" "}
                  {new Date(d.updated_at).toLocaleString()}
                </summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>{d.body}</pre>
              </details>
            ))}
          </div>
        ),
      });
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  // 保护关闭/刷新和站内链接跳转；监听器在卸载或 dirty 变化时清理。
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    const navigation = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (
        dirty &&
        a &&
        a.getAttribute("href")?.startsWith("/") &&
        !window.confirm("草稿有未保存修改，确定离开吗？")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", navigation, true);
    return () => {
      window.removeEventListener("beforeunload", handler);
      document.removeEventListener("click", navigation, true);
    };
  }, [dirty]);
  // 选题与草稿切换共用保护入口，用户确认后才丢弃未保存的编辑。
  const change = (fn: () => void) => {
    if (dirty)
      modal.confirm({
        title: "当前草稿有未保存修改",
        content: "切换后这些修改会丢失。",
        okText: "放弃修改并切换",
        onOk: () => {
          setDirty(false);
          fn();
        },
      });
    else fn();
  };
  return (
    <>
      <Heading
        eyebrow="CREATE / 03"
        title="把发现，写成自己的表达。"
        description="选择一个方向，加入真实经历，让文章有你的声音。"
      />
      <div className="writing-layout">
        <aside className="writing-list">
          <div className="section-title">
            <h2>候选选题</h2>
            <span>{topics.length} 个</span>
          </div>
          {topics.map((t) => (
            <article
              className={`glass writing-topic ${selected?.id === t.id ? "selected" : ""}`}
              key={t.id}
            >
              <Tag>{t.category}</Tag>
              <h3>{t.title}</h3>
              <p>{t.angle}</p>
              <div className="evidence-links">
                {t.evidence_ids.map((id, i) => (
                  <button key={id} onClick={() => inspect(id)}>
                    依据 {i + 1}
                  </button>
                ))}
              </div>
              <div className="row">
                <Button
                  type="text"
                  onClick={() => act(() => api.saveTopic(t.id))}
                >
                  {t.status === "saved" ? "已收藏" : "收藏选题"}
                </Button>
                <Button
                  onClick={() =>
                    change(() => {
                      setSelected(t);
                      setDraft(undefined);
                      setBrief("");
                    })
                  }
                >
                  选择写作
                </Button>
              </div>
            </article>
          ))}
          {!topics.length && <Empty description="先完成一项研究" />}
          <h3>已保存的草稿</h3>
          {db.drafts.length ? (
            db.drafts.map((d) => (
              <button
                className="draft-link"
                key={d.id}
                onClick={() =>
                  change(() => {
                    setDraft(d);
                    setSelected(db.topics.find((t) => t.id === d.topic_id));
                    setBrief(d.brief);
                  })
                }
              >
                <FileTextOutlined /> {d.title}
                <small>版本 {d.version}</small>
              </button>
            ))
          ) : (
            <p className="muted">写下第一篇，就从这里开始。</p>
          )}
        </aside>
        <section className="glass editor-panel">
          {!selected && !draft ? (
            <div className="editor-empty">
              <div className="empty-symbol">
                <EditOutlined />
              </div>
              <span className="eyebrow">YOUR NEXT STORY</span>
              <h2>好选题，还需要你的故事。</h2>
              <p>
                从左侧选择一个方向，补充你实际做过的事，
                <br />
                再开始整理第一份草稿。
              </p>
            </div>
          ) : (
            <>
              <div className="row">
                <h2>{draft ? "草稿工作台" : "写作简报"}</h2>
                <Tag>
                  {draft
                    ? `v${draft.version}${dirty ? " · 未保存" : ""}`
                    : "待补充材料"}
                </Tag>
              </div>
              <label className="field-label" htmlFor="brief">
                你的经历与观点
              </label>
              <Input.TextArea
                id="brief"
                disabled={busy}
                value={brief}
                rows={4}
                placeholder="你遇到了什么问题？尝试了什么？哪些细节可以分享？"
                onChange={(e) => {
                  setBrief(e.target.value);
                  if (draft) {
                    setDraft({ ...draft, brief: e.target.value });
                    setDirty(true);
                  }
                }}
              />
              {!draft ? (
                <>
                  <div className="writing-hint">
                    材料不足的地方会标记为待填写，不会替你编造第一人称经历。
                  </div>
                  <Button
                    type="primary"
                    loading={busy}
                    disabled={busy}
                    onClick={async () => {
                      if (!selected) return;
                      setBusy(true);
                      await act(
                        async () => {
                          setDraft(await api.generate(selected, brief));
                          setDirty(false);
                        },
                        isDemo ? "演示草稿已生成" : "草稿已生成",
                      );
                      setBusy(false);
                    }}
                  >
                    {isDemo ? "生成演示草稿" : "生成草稿"}
                  </Button>
                </>
              ) : (
                <>
                  <div className="editor-toolbar">
                    <Segmented
                      value={tab}
                      onChange={setTab}
                      options={["编辑", "预览"]}
                    />
                    <span>{draft.body.length} 字符</span>
                  </div>
                  <Input
                    aria-label="文章标题"
                    disabled={busy}
                    value={draft.title}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        title: e.target.value,
                        body: draft.body.replace(
                          /^# [^\n]*(?:\n|$)/,
                          `# ${e.target.value}\n`,
                        ),
                      });
                      setDirty(true);
                    }}
                  />
                  {tab === "编辑" ? (
                    <Input.TextArea
                      aria-label="草稿正文"
                      disabled={busy}
                      className="markdown-editor"
                      value={draft.body}
                      onChange={(e) => {
                        setDraft({ ...draft, body: e.target.value });
                        setDirty(true);
                      }}
                    />
                  ) : (
                    <article className="markdown-preview">
                      <ReactMarkdown>{draft.body}</ReactMarkdown>
                    </article>
                  )}
                  <div className="editor-actions">
                    {!isDemo && <Button onClick={showHistory}>历史版本</Button>}
                    <span className="muted">
                      {dirty ? "有修改尚未保存" : "已保存到本地工作区"}
                    </span>
                    <Button
                      icon={<ExportOutlined />}
                      onClick={() =>
                        download(
                          `${draft.title.replace(/[\\/:*?"<>|]/g, "-") || "草稿"}.md`,
                          draft.body,
                        )
                      }
                    >
                      导出 Markdown
                    </Button>
                    <Button
                      type="primary"
                      loading={busy}
                      disabled={busy}
                      icon={<CheckOutlined />}
                      onClick={async () => {
                        setBusy(true);
                        await act(async () => {
                          setDraft(await api.saveDraft(draft));
                          setDirty(false);
                        }, "新版本已保存");
                        setBusy(false);
                      }}
                    >
                      保存版本
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
