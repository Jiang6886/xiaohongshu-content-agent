// 前端数据入口：统一请求、幂等提交、任务轮询和页面数据聚合。
// 默认连接真实 API；只有显式设置 VITE_DATA_MODE=demo 才使用演示实现。

import { api as mock, download } from "./api.mock";
import type {
  Database,
  Research,
  Topic,
  Draft,
  Settings,
  Job,
  Note,
  Report,
} from "./types";
export * from "./types";
export { download };
export const isDemo = import.meta.env.VITE_DATA_MODE === "demo";
interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
// 统一 API 前缀、JSON 请求头、默认超时和错误提示；调用方可覆盖超时信号。
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `请求失败 (${response.status})`);
  }
  return response.json();
}
// 按后端 total 拉取所有分页，避免页面统计只包含第一页。
async function all<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; ; page++) {
    const data = await request<Page<T>>(
      `${path}${path.includes("?") ? "&" : "?"}page=${page}&page_size=100`,
    );
    result.push(...data.items);
    if (result.length >= data.total || !data.items.length) return result;
  }
}
// 请求路径和内容摘要关联一个幂等键；失败保留键，成功后清除。
// 网络重试可复用后台结果，避免重复创建研究或消耗生成额度。
async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const encoded = JSON.stringify(body);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(path + encoded),
  );
  const storageKey =
    "xhs-pending-" +
    Array.from(new Uint8Array(hash))
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  const result = await request<T>(path, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: encoded,
  });
  sessionStorage.removeItem(storageKey);
  return result;
}
// 缓存最近一次完整读取结果，用于从样本/选题 ID 找到所属研究等关联信息。
let snapshot: Database;
// 等待生成任务完成后取草稿；轮询达到次数上限时不会取消后台任务。
async function waitJob(id: string): Promise<Job> {
  for (let i = 0; i < 180; i++) {
    const job = await request<Job>(`/jobs/${id}`);
    if (["failed", "partial", "cancelled"].includes(job.status))
      throw Error(job.error ?? "任务未完成");
    if (job.status === "completed") return job;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw Error(
    "任务仍在后台执行，可在任务状态中查看，完成后草稿会出现在列表中。",
  );
}
const live = {
  // 汇总研究、草稿、设置、任务及每项研究的样本/选题/报表，形成页面快照。
  async load(): Promise<Database> {
    const [runs, drafts, settings, jobs] = await Promise.all([
      all<Research>("/research-runs"),
      all<Draft>("/drafts"),
      request<Settings>("/settings"),
      all<Job>("/jobs"),
    ]);
    const collections = await Promise.all(
      runs.map(async (r) => ({
        id: r.id,
        notes: await all<Note>(`/research-runs/${r.id}/notes`),
        topics: await request<Topic[]>(`/research-runs/${r.id}/topics`),
        report: await request<Report>(`/research-runs/${r.id}/report`),
      })),
    );
    snapshot = {
      runs,
      drafts,
      settings,
      jobs,
      notes: collections.flatMap((x) => x.notes),
      topics: collections.flatMap((x) => x.topics),
      reports: Object.fromEntries(collections.map((x) => [x.id, x.report])),
    };
    return snapshot;
  },
  // 创建接口只返回受理 ID，再获取研究记录用于立即更新界面。
  async create(
    input: Omit<Research, "id" | "status" | "progress" | "created_at">,
  ) {
    const result = await post<{ research_run_id: string; job_id: string }>(
      "/research-runs",
      input,
    );
    return request<Research>(`/research-runs/${result.research_run_id}`);
  },
  // 研究页的取消按钮作用于该研究关联的采集任务。
  async cancel(id: string) {
    const run = snapshot.runs.find((r) => r.id === id);
    if (run?.job_id) await post(`/jobs/${run.job_id}/cancel`);
  },
  // 先解析样本所属研究，再更新排除状态；后端会标记原分析过期。
  async exclude(id: string, excluded: boolean) {
    const n = snapshot.notes.find((n) => n.id === id);
    if (!n) throw Error("找不到样本");
    await request(`/research-runs/${n.run_id}/notes/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ excluded }),
    });
  },
  // 根据当前快照在候选与收藏状态之间切换。
  async saveTopic(id: string) {
    const t = snapshot.topics.find((t) => t.id === id);
    if (!t) throw Error("找不到选题");
    await request(`/topics/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: t.status === "saved" ? "candidate" : "saved",
      }),
    });
  },
  // 先投递生成任务，待其完成后按 result_id 读取草稿。
  async generate(topic: Topic, brief: string) {
    const result = await post<{ job_id: string }>(
      `/topics/${topic.id}/draft-jobs`,
      { brief },
    );
    const job = await waitJob(result.job_id);
    return request<Draft>(`/drafts/${job.result_id}`);
  },
  // 携带正在编辑的版本号；后端发现版本已变化时返回冲突而不是覆盖。
  async saveDraft(draft: Draft) {
    return request<Draft>(`/drafts/${draft.id}/versions`, {
      method: "POST",
      body: JSON.stringify({
        base_version: draft.version,
        title: draft.title,
        body: draft.body,
        brief: draft.brief,
      }),
    });
  },
  async settings(settings: Settings) {
    await request("/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  },
  async reset() {
    throw Error("真实工作区不提供一键清空操作");
  },
};
// 真实模式请求失败会报错，不会自动用假数据代替。
export const api = isDemo ? mock : live;
// 密钥只用 key_configured 表示是否存在，不能通过此接口读取原文。
export interface ModelConfig {
  model: string;
  base_url: string;
  key_configured: boolean;
  source: string;
}
export const backend = {
  modelConfig: () => request<ModelConfig>("/model-config"),
  // 含密钥请求直接发送，不进入幂等摘要缓存；密钥不写入浏览器持久存储。
  saveModel: (data: { model: string; base_url: string; api_key?: string }) =>
    request<ModelConfig>("/model-config", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  // 手动连接测试可能消耗少量模型额度，给它单独设置较长超时。
  testModel: () =>
    request<{ status: string; message: string }>("/model-config/test", {
      method: "POST",
      signal: AbortSignal.timeout(130000),
    }),
  health: () => request<{ worker: string; status: string }>("/health"),
  connections: () =>
    request<{
      mcp: { status: string; message: string };
      model: { status: string; message: string };
      worker: string;
    }>("/connections", { signal: AbortSignal.timeout(100000) }),
  importNotes: (data: unknown) =>
    post<{ research_run_id: string; imported: number }>("/imports", data),
  generateTopics: (id: string) =>
    post<{ job_id: string }>(`/research-runs/${id}/topic-jobs`),
  retry: (id: string) => post<{ job_id: string }>(`/jobs/${id}/retry`),
  cancelJob: (id: string) => post(`/jobs/${id}/cancel`),
  history: (id: string) => all<Draft>(`/drafts/${id}/versions`),
};
