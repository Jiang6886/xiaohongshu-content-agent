// 按研究累加所有关联任务的供应商实际用量，包括失败、重试和生成草稿。
// reserved_tokens 是预算预留，绝不能当成真实消耗；缺失用量也不能当成零。
import { Button, Modal, Tag } from "antd";
import { useState } from "react";
import { statusLabel, type Job } from "../types";

const number = (value: number) => value.toLocaleString("zh-CN");
const valid = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export function jobUsage(job: Job) {
  const usage = job.usage;
  // 尚未预留模型预算且没有返回用量，表示当前没有记录到模型调用。
  const untouched =
    usage?.reserved_tokens === 0 &&
    usage.input_tokens == null &&
    usage.output_tokens == null;
  const input = valid(usage?.input_tokens) ? usage.input_tokens : 0;
  const output = valid(usage?.output_tokens) ? usage.output_tokens : 0;
  const incomplete =
    !untouched && (!valid(usage?.input_tokens) || !valid(usage?.output_tokens));
  return { input, output, incomplete, untouched };
}

export default function ResearchUsage({
  name,
  jobs,
  demo,
}: {
  name: string;
  jobs: Job[];
  demo: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (demo)
    return (
      <div className="research-usage muted">Token：演示模式，未调用模型</div>
    );
  const rows = jobs.map((job) => ({ job, ...jobUsage(job) }));
  const input = rows.reduce((sum, row) => sum + row.input, 0);
  const output = rows.reduce((sum, row) => sum + row.output, 0);
  const unknown = rows.filter((row) => row.incomplete).length;
  const total = input + output;
  const label = unknown
    ? `Token：已记录 ${number(total)} · ${unknown} 项用量待确认`
    : `Token：${number(total)}（输入 ${number(input)} / 输出 ${number(output)}）`;
  return (
    <>
      <Button
        type="text"
        size="small"
        className="research-usage"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Modal
        title={`${name} · Token 用量`}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={640}
      >
        <p>
          <strong>
            {unknown ? "已记录用量" : "累计用量"}：{number(total)} tokens
          </strong>{" "}
          · 输入 {number(input)} / 输出 {number(output)}
        </p>
        <p className="muted">
          累计该研究下采集分析、重新分析、重试和草稿任务的供应商返回用量，不含模型连接测试。预算预留不计入实际消耗。
        </p>
        {unknown > 0 && (
          <p>
            有 {unknown}{" "}
            项任务用量不完整（调用中或供应商未返回），总量尚不能确定；已记录数不是最终总量。
          </p>
        )}
        <div className="usage-history">
          {!rows.length && (
            <p className="muted">
              暂无模型任务记录。导入和读取样本本身不消耗模型 token。
            </p>
          )}
          {rows.map(({ job, input, output, incomplete, untouched }) => (
            <section className="usage-row" key={job.id}>
              <div>
                {job.kind === "draft"
                  ? "生成草稿"
                  : job.kind === "topics"
                    ? "分析与选题"
                    : "研究采集与分析"}{" "}
                <Tag>{statusLabel[job.status]}</Tag>
              </div>
              <small className="muted">
                {new Date(job.created_at).toLocaleString("zh-CN")} ·{" "}
                {job.id.slice(0, 8)}
              </small>
              <p>
                {untouched ? (
                  "0 tokens · 未记录到模型调用"
                ) : (
                  <>
                    输入{" "}
                    {valid(job.usage?.input_tokens) ? number(input) : "待确认"}{" "}
                    / 输出{" "}
                    {valid(job.usage?.output_tokens)
                      ? number(output)
                      : "待确认"}
                    {!incomplete && ` · 合计 ${number(input + output)} tokens`}
                  </>
                )}
              </p>
            </section>
          ))}
        </div>
      </Modal>
    </>
  );
}
