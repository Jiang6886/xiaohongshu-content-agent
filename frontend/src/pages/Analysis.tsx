// 数据分析页：研究范围、有效样本统计、话题分布、选题证据和样本筛选。
// 数量来自样本/后端报表；模型观察与标题规则统计不代表平台点击率。

import { statusLabel, activeStatuses, isDemo, backend } from "../api";
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
  Pagination,
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
import { displayDate } from "../format";

// 未知指标保留占位显示，不混入真实的零值。
const fmt = (n: number | null) =>
  n === null ? "未知" : n.toLocaleString("zh-CN");
export default function Analysis({
  db,
  active,
  notes,
  topics,
  setRun,
  onCreate,
  inspect,
  exclude,
  goWrite,
}: {
  db: Database;
  active?: Research;
  notes: Note[];
  topics: Topic[];
  setRun: (id: string) => void;
  onCreate: () => void;
  inspect: (n: Note) => void;
  exclude: (n: Note) => void;
  goWrite: () => void;
}) {
  const [q, setQ] = useState("");
  const { message, modal } = AntApp.useApp();
  const [topicPage, setTopicPage] = useState(1);
  const [patternPage, setPatternPage] = useState(1);
  const [generating, setGenerating] = useState(false);
  const report = active ? db.reports?.[active.id] : undefined;
  // 切换研究时重置搜索、分组和选题页码，避免上一项研究的过滤条件残留。
  useEffect(() => {
    setGroup("全部话题");
    setQ("");
    setTopicPage(1);
    setPatternPage(1);
  }, [active?.id]);
  // 只提交重新分析任务；结果随父组件轮询刷新，不阻塞页面等待模型。
  const analyze = async () => {
    if (!active) return;
    setGenerating(true);
    try {
      await backend.generateTopics(active.id);
      message.success("已加入后台分析队列，可在上方查看进度");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };
  const [group, setGroup] = useState("全部话题");
  const [mode, setMode] = useState("研究概览");
  // 统计只计算未排除样本；样本表仍保留被排除项，便于追溯和恢复。
  const valid = notes.filter((n) => !n.excluded);
  const groups = [...new Set(notes.map((n) => n.topic))];
  // 搜索与话题过滤用于样本展示/导出，不改变数据库内容。
  const filtered = notes.filter(
    (n) =>
      (n.title + n.author).includes(q) &&
      (group === "全部话题" || n.topic === group),
  );
  // 话题柱状图按有效样本计数，而不是模型给出的热度分数。
  const counts = groups.map((name) => ({
    name,
    count: valid.filter((n) => n.topic === name).length,
  }));
  return (
    <>
      <Heading
        eyebrow="DISCOVER / 02"
        title="从观察里，拾起下一个灵感。"
        description="理解话题背后的需求，让每一次创作都有自己的出发点。"
        action={
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            新建研究
          </Button>
        }
      />
      <div className="research-filter">
        <Select
          aria-label="当前研究"
          value={active?.id}
          onChange={setRun}
          options={db.runs.map((r) => ({ value: r.id, label: r.name }))}
        />
        <span>最近 {active?.days ?? 7} 天</span>
        <Tag bordered={false}>
          {isDemo
            ? "模拟样本"
            : active?.source === "import"
              ? "用户导入"
              : "真实采样"}
        </Tag>
        <div className="filter-keywords">
          {active?.keywords.map((k) => (
            <span key={k}># {k}</span>
          ))}
        </div>
        {active?.strategy === "engagement" && (
          <Button
            size="small"
            onClick={() =>
              modal.info({
                title: "本次高互动筛选",
                content: (
                  <>
                    <p>
                      {active.collection_summary?.note ??
                        "任务尚未完成候选筛选"}
                    </p>
                    <p>
                      任一门槛达标：点赞 {active.min_likes ?? 1000} / 收藏{" "}
                      {active.min_saves ?? 300} / 评论{" "}
                      {active.min_comments ?? 100}（0 为关闭）。
                    </p>
                    <p>
                      {active.collection_summary?.scope ??
                        "没有点击量、曝光量和涨粉量。仅分析文字与评论，不分析图片或视频画面。"}
                    </p>
                    <p>
                      入选来自有限候选池，不代表全站排名。重试保留已有样本并补足剩余名额。
                    </p>
                  </>
                ),
              })
            }
          >
            筛选依据
          </Button>
        )}
      </div>
      {isDemo && active && active.status !== "completed" && (
        <Alert
          className="research-status"
          type={
            active.status === "failed"
              ? "error"
              : active.status === "partial"
                ? "warning"
                : "info"
          }
          title={`本次研究${statusLabel[active.status]}${isDemo ? "，完成后显示模拟分析结果。" : "。"}${active.error ?? ""}`}
        />
      )}
      {!isDemo && (
        <div className="analysis-action">
          {active && active.status !== "completed" ? (
            <Alert
              className="analysis-state"
              type={
                active.status === "failed"
                  ? "error"
                  : active.status === "partial"
                    ? "warning"
                    : "info"
              }
              title={`本次研究${statusLabel[active.status]}。${active.error ?? ""}`}
            />
          ) : (
            <p className="muted">
              {report?.analysis_note ?? "新建研究或导入素材后查看分析。"}
            </p>
          )}
          {report?.analysis_stale && (
            <Alert
              type="warning"
              title="样本范围已改变，旧选题与语义分析需要重新生成。"
            />
          )}
          {valid.length > 0 && (
            <Button
              loading={generating}
              disabled={
                generating ||
                !valid.length ||
                db.jobs?.some(
                  (j) =>
                    j.research_run_id === active?.id &&
                    activeStatuses.includes(j.status),
                )
              }
              onClick={analyze}
            >
              生成分析与选题
            </Button>
          )}
        </div>
      )}
      <div className="stats">
        {[
          [
            <FileTextOutlined />,
            "有效样本",
            valid.length,
            "本次研究的去重样本",
          ],
          [
            <TeamOutlined />,
            "覆盖作者",
            report?.summary.distinct_authors ??
              new Set(valid.map((n) => n.author)).size,
            "来自不同的创作视角",
          ],
          [
            <AppstoreOutlined />,
            "话题分组",
            counts.filter((c) => c.count).length,
            valid.some((n) => n.topic === "未分类")
              ? "包含尚未分析的未分类样本"
              : "从内容中归纳主题",
          ],
          [<BookOutlined />, "候选选题", topics.length, "等待加入你的经验"],
        ].map(([icon, label, value, sub], i) => (
          <section
            className={`glass stat ${i === 0 ? "mint" : i === 3 ? "peach" : ""}`}
            key={String(label)}
          >
            <div className="stat-label">
              {label}
              <span>{icon}</span>
            </div>
            <strong>{value}</strong>
            <small>{sub}</small>
          </section>
        ))}
      </div>
      <div className="section-title">
        <Segmented
          className="analysis-tabs"
          value={mode}
          onChange={setMode}
          options={["研究概览", "共性爆点", "标题观察", "候选选题", "样本明细"]}
        />
        <span className="scope">
          <InfoCircleOutlined /> 仅反映本次样本，不代表全平台热度
        </span>
      </div>
      {mode !== "样本明细" ? (
        <>
          {mode === "共性爆点" && (
            <>
              <p className="muted">
                依据文字和部分评论形成的假设，不代表点击或涨粉因果；封面、图片内容、视频节奏尚未分析。
                {report?.analysis_stale ? "样本已变化，请重新分析。" : ""}
              </p>
              {!report?.patterns?.length ? (
                <Empty
                  description={
                    isDemo
                      ? "演示模式没有真实共性分析"
                      : "尚无跨样本共性。生成分析后查看；材料不足时不会编造共性。"
                  }
                />
              ) : (
                <>
                  <div className="topic-grid candidate-topics">
                    {report.patterns
                      .slice((patternPage - 1) * 2, patternPage * 2)
                      .map((p, i) => (
                        <section className="glass topic-card" key={i}>
                          <Tag>证据支持的观察</Tag>
                          <h3>{p.observation}</h3>
                          <p className="topic-angle">
                            可能原因：{p.hypothesis}
                          </p>
                          <Button
                            onClick={() => {
                              const dialog = modal.info({
                                title: "共性与创作实验",
                                width: 680,
                                content: (
                                  <>
                                    <h3>观察到的共性</h3>
                                    <p>{p.observation}</p>
                                    <h3>可能原因（待验证）</h3>
                                    <p>{p.hypothesis}</p>
                                    <h3>用自己的账号验证</h3>
                                    <p>{p.experiment}</p>
                                    <h3>来源证据</h3>
                                    {p.evidence_ids.map((id) => (
                                      <Button
                                        key={id}
                                        type="link"
                                        onClick={() => {
                                          const n = notes.find(
                                            (n) => n.id === id,
                                          );
                                          if (n) {
                                            dialog.destroy();
                                            inspect(n);
                                          }
                                        }}
                                      >
                                        {notes.find((n) => n.id === id)
                                          ?.title ?? "样本"}
                                      </Button>
                                    ))}
                                    <p className="muted">
                                      只观察高互动样本会产生幸存者偏差。请与普通内容对照，发布后用自己账号的实际数据验证；不保证爆款。
                                    </p>
                                  </>
                                ),
                              });
                            }}
                          >
                            查看依据与实验
                          </Button>
                        </section>
                      ))}
                  </div>
                  <Pagination
                    className="topic-pagination"
                    current={patternPage}
                    onChange={setPatternPage}
                    total={report.patterns.length}
                    pageSize={2}
                    showSizeChanger={false}
                    hideOnSinglePage
                  />
                </>
              )}
            </>
          )}
          {mode === "研究概览" && (
            <div className="analysis-grid">
              <section className="glass chart-card">
                <div className="row">
                  <h2>大家在讨论什么</h2>
                  <Tag bordered={false}>话题分布</Tag>
                </div>
                <p className="muted">按有效样本计数 · 点击话题查看样本</p>
                {valid.length ? (
                  counts.map((c, i) => (
                    <button
                      className="bar-row"
                      key={c.name}
                      onClick={() => {
                        setGroup(c.name);
                        setMode("样本明细");
                      }}
                    >
                      <span title={c.name}>{c.name}</span>
                      <div className="bar-track">
                        <div
                          style={{
                            width: `${(c.count / Math.max(...counts.map((x) => x.count))) * 100}%`,
                            background: [
                              "#729f91",
                              "#a5c3b8",
                              "#b1bbb0",
                              "#d9b4a8",
                            ][i % 4],
                          }}
                        />
                      </div>
                      <b>
                        {c.count}
                        <small> 篇</small>
                      </b>
                    </button>
                  ))
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="暂无有效样本"
                  />
                )}
                <div className="chart-foot">看见共同问题，也留意不同声音。</div>
              </section>
              <section className="glass observation peach">
                <div className="row">
                  <span className="pill">观察手记</span>
                  <span>✧</span>
                </div>
                <h2>
                  {isDemo ? (
                    <>
                      具体的问题，
                      <br />
                      比泛泛的技巧更有启发。
                    </>
                  ) : report?.observations.length ? (
                    "从真实材料，形成创作假设。"
                  ) : (
                    "尚未形成研究观察。"
                  )}
                </h2>
                <p className="observation-text">
                  {isDemo
                    ? "示例素材围绕工作场景、整理方法和实践步骤展开。可以从一个自己经历过的问题切入。"
                    : (report?.observations[0]?.text ??
                      "完成采样后点击生成分析与选题。统计结果由代码计算，语义建议由模型根据所选证据生成。")}
                </p>
                {!isDemo && report?.observations[0] && (
                  <Button
                    type="text"
                    onClick={() =>
                      modal.info({
                        title: "完整观察",
                        width: 640,
                        content: (
                          <p
                            style={{
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {report.observations[0].text}
                          </p>
                        ),
                      })
                    }
                  >
                    查看完整观察
                  </Button>
                )}
                <div className="observation-footer">
                  {isDemo
                    ? "创作假设 · 尚未经真实数据验证"
                    : "创作建议 · 请核对样本依据，不代表因果结论"}
                </div>
                <Button
                  type="text"
                  disabled={!notes.length}
                  onClick={() => {
                    setMode("样本明细");
                    setGroup("全部话题");
                  }}
                >
                  看看这些样本 <ArrowRightOutlined />
                </Button>
              </section>
            </div>
          )}
          {mode === "标题观察" && (
            <>
              <div className="section-title">
                <h2>
                  标题表达观察 <small>特征可重叠，不代表点击效果</small>
                </h2>
              </div>
              <div className="topic-grid title-patterns">
                {[
                  {
                    name: "问题切入",
                    pattern: /[？?]/,
                    hint: "统计标题中含中文或英文问号的样本",
                  },
                  {
                    name: "数字表达",
                    pattern: /[0-9]/,
                    hint: "统计标题中含 0–9 阿拉伯数字的样本",
                  },
                  {
                    name: "工作场景词",
                    pattern: /周报|会议|工作流/,
                    hint: "统计标题中含周报、会议或工作流的样本",
                  },
                ].map((pattern) => {
                  const matches = valid.filter((n) =>
                    pattern.pattern.test(n.title),
                  );
                  return (
                    <section className="glass pattern-card" key={pattern.name}>
                      <div className="row">
                        <h3>{pattern.name}</h3>
                        <span>{matches.length} 篇</span>
                      </div>
                      <p>{pattern.hint}</p>
                      <Button
                        type="text"
                        disabled={!matches.length}
                        onClick={() => inspect(matches[0])}
                      >
                        查看示例 <ArrowRightOutlined />
                      </Button>
                    </section>
                  );
                })}
              </div>
            </>
          )}
          {mode === "候选选题" && (
            <>
              <div className="section-title">
                <h2>
                  值得写下来的方向 <small>从研究，到你的表达</small>
                </h2>
                <Button type="text" onClick={goWrite}>
                  进入选题工作台 <ArrowRightOutlined />
                </Button>
              </div>
              <div className="topic-grid candidate-topics">
                {topics.length ? (
                  topics
                    .slice((topicPage - 1) * 2, topicPage * 2)
                    .map((t, i) => (
                      <article
                        className={`glass topic-card ${i === 1 ? "mint" : ""}`}
                        key={t.id}
                      >
                        <div className="row">
                          <Tag>{t.category}</Tag>
                          <span className="index">
                            {String((topicPage - 1) * 2 + i + 1).padStart(
                              2,
                              "0",
                            )}
                          </span>
                        </div>
                        <h3 title={t.title}>{t.title}</h3>
                        <p className="topic-angle">{t.angle}</p>
                        <div className="row topic-bottom">
                          <span>
                            {t.evidence_ids.length} 条{isDemo ? "模拟" : "样本"}
                            依据
                          </span>
                          <Button
                            type="text"
                            onClick={() => {
                              const dialog = modal.info({
                                title: t.title,
                                width: 700,
                                content: (
                                  <>
                                    <p
                                      style={{
                                        whiteSpace: "pre-wrap",
                                        overflowWrap: "anywhere",
                                      }}
                                    >
                                      {t.angle}
                                    </p>
                                    <p>样本依据：</p>
                                    {t.evidence_ids.map((id) => {
                                      const n = notes.find((n) => n.id === id);
                                      return n ? (
                                        <Button
                                          key={id}
                                          type="link"
                                          onClick={() => {
                                            dialog.destroy();
                                            inspect(n);
                                          }}
                                          style={{
                                            whiteSpace: "normal",
                                            height: "auto",
                                            textAlign: "left",
                                          }}
                                        >
                                          {n.title}
                                        </Button>
                                      ) : null;
                                    })}
                                  </>
                                ),
                              });
                            }}
                          >
                            查看详情
                          </Button>
                          <Button type="text" onClick={goWrite}>
                            去创作 <ArrowRightOutlined />
                          </Button>
                        </div>
                      </article>
                    ))
                ) : (
                  <Empty description="研究完成后生成候选选题" />
                )}
              </div>
              <Pagination
                className="topic-pagination"
                current={topicPage}
                onChange={setTopicPage}
                total={topics.length}
                pageSize={2}
                size="small"
                showSizeChanger={false}
                hideOnSinglePage
                showTotal={(total) => `共 ${total} 个选题`}
              />
            </>
          )}
        </>
      ) : (
        <section className="glass samples">
          <div className="table-toolbar">
            <Input
              aria-label="搜索样本"
              placeholder="搜索标题或作者"
              prefix={<SearchOutlined />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              allowClear
            />
            <Select
              aria-label="筛选话题"
              value={group}
              onChange={setGroup}
              options={["全部话题", ...groups].map((value) => ({ value }))}
            />
            <Button
              icon={<ExportOutlined />}
              onClick={() =>
                download(
                  "样本数据.json",
                  JSON.stringify(filtered, null, 2),
                  "application/json",
                )
              }
            >
              导出样本
            </Button>
          </div>
          <Table<Note>
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无样本"
                />
              ),
            }}
            rowKey="id"
            dataSource={filtered}
            pagination={{ pageSize: 2, showSizeChanger: false }}
            size="small"
            scroll={{ x: 850 }}
            rowClassName={(n) => (n.excluded ? "excluded" : "")}
            columns={[
              {
                title: "笔记 / 作者",
                dataIndex: "title",
                width: 330,
                render: (_, n) => (
                  <button className="title-button" onClick={() => inspect(n)}>
                    {n.title}
                    <small>
                      {n.author} · {displayDate(n.published_at)}
                    </small>
                  </button>
                ),
              },
              {
                title: "话题",
                dataIndex: "topic",
                render: (v) => <Tag>{v}</Tag>,
              },
              {
                title: "点赞",
                dataIndex: "likes",
                sorter: (a, b) => (a.likes ?? -1) - (b.likes ?? -1),
                render: fmt,
              },
              { title: "收藏", dataIndex: "saves", render: fmt },
              { title: "评论", dataIndex: "comments", render: fmt },
              {
                title: "操作",
                render: (_, n) => (
                  <Button size="small" type="text" onClick={() => exclude(n)}>
                    {n.excluded ? "恢复样本" : "排除样本"}
                  </Button>
                ),
              },
            ]}
          />
        </section>
      )}
    </>
  );
}
