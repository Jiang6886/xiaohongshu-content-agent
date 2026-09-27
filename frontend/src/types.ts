// 前端业务类型：描述页面使用的 API 数据与聚合快照。
// 后端 schemas.py 负责运行时校验；这里的类型用于编译期检查。

export type Status =
  | "queued"
  | "collecting"
  | "cleaning"
  | "analyzing"
  | "completed"
  | "partial"
  | "cancelled"
  | "failed";
// 研究范围与总体进度；job_id 指向关联任务。
export interface Research {
  id: string;
  name: string;
  keywords: string[];
  audience: string;
  days: number;
  limit: number;
  created_at: string;
  status: Status;
  progress: number;
  error?: string | null;
  job_id?: string | null;
  source?: string;
  analysis_stale?: boolean;
  analysis_note?: string;
  strategy?: "recent" | "engagement";
  rank_by?: "balanced" | "likes" | "saves" | "comments";
  content_type?: "all" | "image" | "video";
  min_likes?: number;
  min_saves?: number;
  min_comments?: number;
  collection_summary?: { note?: string; scope?: string };
}
// 研究样本；可空指标表示未知，excluded 仅影响有效样本统计。
export interface Note {
  id: string;
  run_id: string;
  title: string;
  author: string;
  topic: string;
  format: string;
  likes: number | null;
  saves: number | null;
  comments: number | null;
  published_at: string | null;
  captured_at?: string;
  comment_samples?: { id: string; content: string }[];
  comment_coverage?: { loaded: number; limit: number; complete: boolean };
  provenance?: Record<string, unknown>[];
  body: string;
  excluded: boolean;
  source_url: string | null;
}
// 候选/收藏选题；evidence_ids 关联内部样本 ID，可打开来源抽屉。
export interface Topic {
  id: string;
  title: string;
  angle: string;
  category: string;
  evidence_ids: string[];
  status: "candidate" | "saved";
  run_id: string;
}
// Markdown 草稿及版本号，保存时以 version 检查并发更新。
export interface Draft {
  id: string;
  topic_id: string;
  title: string;
  body: string;
  brief: string;
  version: number;
  updated_at: string;
}
// 普通创作偏好，不包含模型密钥。
export interface Settings {
  model: string;
  budget: number;
  comment_limit: number;
  author: string;
  voice: string;
}
// 页面聚合快照，不是 SQLite 表结构；reports 以研究 ID 索引。
export interface Database {
  runs: Research[];
  notes: Note[];
  topics: Topic[];
  drafts: Draft[];
  settings: Settings;
  jobs?: Job[];
  reports?: Record<string, Report>;
}

// 前端所需的后台任务字段；result_id 在完成后指向生成结果。
export interface Job {
  usage?: {
    reserved_tokens: number;
    input_tokens: number | null;
    output_tokens: number | null;
    tool_calls: number;
  };
  id: string;
  research_run_id: string;
  kind: "research" | "topics" | "draft";
  status: Status;
  progress: number;
  cancel_requested: boolean;
  error: string | null;
  result_id: string | null;
  created_at: string;
}
// 报表把样本统计、模型观察、证据和分析过期状态分开展示。
export interface Report {
  patterns?: {
    observation: string;
    hypothesis: string;
    experiment: string;
    evidence_ids: string[];
  }[];
  collection_summary?: { note?: string; scope?: string };
  analysis_stale: boolean;
  analysis_note: string;
  observations: {
    kind: string;
    text: string;
    evidence_ids: string[];
    stale: boolean;
  }[];
  scope: string;
  summary: {
    valid_notes: number;
    distinct_authors: number;
    topic_groups: number;
    candidate_topics: number;
  };
}
export const statusLabel: Record<Status, string> = {
  queued: "等待执行",
  collecting: "采集中",
  cleaning: "整理中",
  analyzing: "分析中",
  completed: "已完成",
  partial: "部分完成",
  cancelled: "已取消",
  failed: "失败",
};
// 活动态共用定义，供轮询频率、进度提示和操作按钮判断使用。
export const activeStatuses: Status[] = [
  "queued",
  "collecting",
  "cleaning",
  "analyzing",
];
