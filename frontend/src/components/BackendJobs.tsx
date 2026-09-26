// 全局后台任务入口：展示活动/异常任务，支持取消与重试。
// 重试是新任务；同一研究按最新阶段展示，草稿任务则独立保留。

import { Button, Tag, Progress, App, Drawer } from "antd";
import { useState } from "react";
import {
  backend,
  statusLabel,
  activeStatuses,
  type Job,
  type Research,
} from "../api";
export default function BackendJobs({
  jobs,
  runs,
  onChange,
}: {
  jobs: Job[];
  runs: Research[];
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { message } = App.useApp();
  // 操作后刷新父组件快照，使取消请求或新重试任务及时反映到界面。
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await onChange();
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  // 研究采集与分析按研究合并为最新状态，避免旧失败在成功重试后仍报警。
  const latest = new Map<string, Job>();
  for (const job of [...jobs].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )) {
    const key = job.kind === "draft" ? job.id : job.research_run_id;
    if (!latest.has(key)) latest.set(key, job);
  }
  // 只提示进行中和失败/部分完成任务；完整历史仍保留在后端。
  const items = [...latest.values()].filter(
    (j) =>
      activeStatuses.includes(j.status) ||
      j.status === "failed" ||
      j.status === "partial",
  );
  if (!items.length) return null;
  return (
    <>
      <Button
        className="jobs-button"
        size="small"
        onClick={() => setOpen(true)}
      >
        后台任务 · {items.length}
      </Button>
      <Drawer title="后台任务" open={open} onClose={() => setOpen(false)}>
        {items.map((j) => (
          <div
            key={j.id}
            style={{ padding: "10px 0", borderTop: "1px solid #e1e6da" }}
          >
            <p className="muted">
              {runs.find((r) => r.id === j.research_run_id)?.name ?? "研究任务"}
            </p>
            <div className="row">
              <span>
                {j.kind === "draft"
                  ? "生成草稿"
                  : j.kind === "topics"
                    ? "分析与选题"
                    : "研究采集"}{" "}
                <Tag>{statusLabel[j.status]}</Tag>
              </span>
              {activeStatuses.includes(j.status) ? (
                <Button
                  size="small"
                  disabled={j.cancel_requested}
                  onClick={() => act(() => backend.cancelJob(j.id))}
                >
                  {j.cancel_requested ? "等待停止" : "取消"}
                </Button>
              ) : (
                <Button
                  size="small"
                  onClick={() => act(() => backend.retry(j.id))}
                >
                  重试
                </Button>
              )}
            </div>
            {activeStatuses.includes(j.status) && (
              <Progress percent={j.progress} size="small" />
            )}
            {j.error && (
              <p className="muted" style={{ marginBottom: 0 }}>
                {j.error}
              </p>
            )}
          </div>
        ))}
      </Drawer>
    </>
  );
}
