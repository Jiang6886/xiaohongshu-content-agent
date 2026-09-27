// 研究管理页：创建研究、分页查看进度、取消任务和显式导入用户 JSON。
// 真实采集由后台执行，页面只发起操作并展示父组件传入的最新状态。

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
  DeleteOutlined,
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
import ResearchUsage from "../components/ResearchUsage";

export default function ResearchPage({
  db,
  onCreate,
  onView,
  onCancel,
  onDelete,
}: {
  db: Database;
  onCreate: () => void;
  onView: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const { message, modal } = AntApp.useApp();
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<string>();
  // 最后一页删除后回到有效页码，避免列表看起来为空但仍有其他研究。
  useEffect(() => {
    setPage((current) =>
      Math.min(current, Math.max(1, Math.ceil(db.runs.length / 2))),
    );
  }, [db.runs.length]);
  const confirmDelete = (research: Research) => {
    modal.confirm({
      title: `删除研究“${research.name}”？`,
      content:
        "将永久删除这项研究的样本、选题、关联草稿及全部历史版本和任务记录，无法恢复。其他研究不受影响。",
      okText: "确认删除",
      cancelText: "保留研究",
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeleting(research.id);
        try {
          await onDelete(research.id);
          message.success("研究已删除");
        } catch (e) {
          message.error((e as Error).message);
          throw e;
        } finally {
          setDeleting(undefined);
        }
      },
    });
  };
  const [importing, setImporting] = useState(false);
  // 检查文件大小并解析 JSON 后提交导入；字段合法性和数量上限由后端再次校验。
  const importFile = async (file: File) => {
    setImporting(true);
    try {
      if (file.size > 2_000_000) throw Error("导入文件不能超过 2 MB");
      const result = await backend.importNotes(JSON.parse(await file.text()));
      message.success(`已导入 ${result.imported} 条样本`);
      location.assign("/analysis");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  };
  return (
    <>
      <Heading
        eyebrow="RESEARCH / 01"
        title="好内容，从一个好问题开始。"
        description="圈定你关心的领域，把零散的观察变成可追溯的研究。"
        action={
          <div className="row">
            {!isDemo && (
              <label
                className="ant-btn ant-btn-default"
                style={{
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                {" "}
                {importing ? "正在导入…" : "导入 JSON"}
                <input
                  aria-label="导入 JSON 文件"
                  type="file"
                  accept=".json,application/json"
                  disabled={importing}
                  style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    opacity: 0,
                  }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importFile(file);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
              新建研究
            </Button>
          </div>
        }
      />
      <div className="journey glass mint">
        <div className="journey-intro">
          <span className="pill">研究路径</span>
          <h2>把好奇心，变成创作方向。</h2>
          <p>选择范围，理解样本，再形成自己的判断。</p>
        </div>
        <div className="journey-steps">
          {["定义问题", "采集样本", "提炼观察", "开始创作"].map((x, i) => (
            <div key={x}>
              <b>0{i + 1}</b>
              <span>{x}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="section-title">
        <h2>我的研究</h2>
        <span>
          {db.runs.length} 项研究 ·{" "}
          {isDemo ? "保存在当前浏览器" : "保存在本机数据库"}
        </span>
      </div>
      <div className="run-list">
        {!db.runs.length && (
          <Empty description="还没有研究。新建任务采集真实数据，或导入已有 JSON 素材。" />
        )}
        {db.runs.slice((page - 1) * 2, page * 2).map((r) => (
          <section className="glass run-card" key={r.id}>
            <div className="run-icon">
              <ExperimentOutlined />
            </div>
            <div className="run-body">
              <div className="row">
                <h3>{r.name}</h3>
                <Tag
                  color={
                    r.status === "completed"
                      ? "success"
                      : r.status === "failed"
                        ? "error"
                        : "default"
                  }
                >
                  {statusLabel[r.status]}
                </Tag>
              </div>
              <p>
                {r.keywords.join(" / ")} <span className="dot">·</span> 最近{" "}
                {r.days} 天 <span className="dot">·</span> 上限 {r.limit} 篇
                <span className="dot">·</span>{" "}
                {r.strategy === "engagement" ? "高互动筛选" : "最新内容探索"}
              </p>
              <small>
                {new Date(r.created_at).toLocaleString("zh-CN")} · {r.audience}
              </small>
              <ResearchUsage
                name={r.name}
                jobs={(db.jobs ?? []).filter((j) => j.research_run_id === r.id)}
                demo={isDemo}
              />
              {activeStatuses.includes(r.status) && (
                <Progress
                  percent={r.progress}
                  size="small"
                  strokeColor="#65978a"
                />
              )}
              {r.error && (
                <Alert
                  type={r.status === "partial" ? "warning" : "error"}
                  title={r.error}
                />
              )}
            </div>
            <div className="run-actions">
              {activeStatuses.includes(r.status) ? (
                <Button onClick={() => onCancel(r.id)}>取消任务</Button>
              ) : (
                <Button
                  icon={<ArrowRightOutlined />}
                  onClick={() => onView(r.id)}
                >
                  查看结果
                </Button>
              )}
              <Button
                danger
                type="text"
                icon={<DeleteOutlined />}
                loading={deleting === r.id}
                disabled={
                  Boolean(deleting) ||
                  activeStatuses.includes(r.status) ||
                  db.jobs?.some(
                    (j) =>
                      j.research_run_id === r.id &&
                      activeStatuses.includes(j.status),
                  )
                }
                title="永久删除研究；有活动任务时请先取消并等待停止"
                onClick={() => confirmDelete(r)}
              >
                删除研究
              </Button>
            </div>
          </section>
        ))}
      </div>
      <Pagination
        className="run-pagination"
        current={page}
        onChange={setPage}
        total={db.runs.length}
        pageSize={2}
        showSizeChanger={false}
        hideOnSinglePage
      />
    </>
  );
}
