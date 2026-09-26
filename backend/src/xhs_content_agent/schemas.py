# 数据契约：校验 HTTP 输入、模型结构化输出，并声明 API 响应字段。
# 字段范围在这里约束；证据归属、任务冲突等业务规则在 app/worker 中校验。

from typing import Literal, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator


# 输入默认拒绝未知字段并清理字符串首尾空白，尽早发现接口拼写错误。
class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# 研究范围与采样上限；关键词去重保留用户给出的顺序。
class ResearchInput(Strict):
    name: str = Field(min_length=1, max_length=80)
    keywords: list[str] = Field(min_length=1, max_length=10)
    audience: str = Field(min_length=1, max_length=500)
    days: Literal[7, 30] = 7
    limit: int = Field(default=20, ge=1, le=100)

    # 拒绝空关键词，再去掉首尾空白并按首次出现顺序去重。
    @field_validator("keywords")
    @classmethod
    def clean_keywords(cls, values):
        if any(not x.strip() or len(x) > 100 for x in values):
            raise ValueError("关键词不能为空或超过 100 字")
        return list(dict.fromkeys(x.strip() for x in values))


# 公开创作偏好；model 为兼容字段，真实模型与密钥以运行时私密配置为准。
class Settings(Strict):
    model: str = Field(default="", max_length=200)
    budget: int = Field(default=20000, ge=1000, le=1000000)
    comment_limit: int = Field(default=20, ge=0, le=100)
    author: str = Field(default="记录个人实践的创作者", min_length=1, max_length=3000)
    voice: str = Field(
        default="自然、具体、有自己的判断", min_length=1, max_length=1000
    )


# 样本排除开关；原始样本保留，方便恢复与追溯。
class Exclusion(Strict):
    excluded: bool


# 只允许修改选题收藏状态。
class TopicPatch(Strict):
    status: Literal["candidate", "saved"]


# 保存草稿时必须带所基于的版本号，后端据此检测并发冲突。
class DraftInput(Strict):
    base_version: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=100000)
    brief: str = Field(default="", max_length=10000)


# 用户提供的写作补充要求，与作者长期偏好分开保存。
class Brief(Strict):
    brief: str = Field(default="", max_length=10000)


# 导入样本的最小字段集；未知指标/发布时间允许为空，不制造默认事实。
class ImportedNote(Strict):
    platform_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    title: str = Field(min_length=1, max_length=500)
    author: str = Field(default="未知作者", max_length=200)
    body: str = Field(default="", max_length=30000)
    topic: str = Field(default="未分类", max_length=100)
    format: str = Field(default="未知", max_length=100)
    likes: int | None = Field(default=None, ge=0)
    saves: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)
    published_at: str | None = None
    source_url: str | None = None

    # 只接受小红书来源链接，并移除查询参数、片段等非必要信息。
    @field_validator("source_url")
    @classmethod
    def source(cls, v):
        if v:
            from urllib.parse import urlparse, urlunparse

            u = urlparse(v)
            if u.scheme != "https" or u.hostname not in (
                "www.xiaohongshu.com",
                "xiaohongshu.com",
                "xhslink.com",
            ):
                raise ValueError("来源仅支持小红书 HTTPS 链接")
            return urlunparse((u.scheme, u.netloc, u.path, "", "", ""))
        return v

    # 验证 ISO 时间格式，保持导入记录可被时间展示与筛选逻辑理解。
    @field_validator("published_at")
    @classmethod
    def date(cls, v):
        if v:
            from datetime import datetime

            datetime.fromisoformat(v.replace("Z", "+00:00"))
        return v


# 一次导入由研究范围和样本列表组成，业务层再检查研究上限。
class ImportInput(Strict):
    research: ResearchInput
    notes: list[ImportedNote] = Field(min_length=1, max_length=100)


# 每个模型选题必须带证据 ID；证据真实性由 worker 对照本次输入校验。
class GeneratedTopic(Strict):
    title: str = Field(min_length=1, max_length=200)
    angle: str = Field(min_length=1, max_length=2000)
    category: str = Field(min_length=1, max_length=100)
    evidence_ids: list[str] = Field(min_length=1, max_length=20)


# 限制一次分析生成的选题数，控制结果规模。
class TopicOutput(Strict):
    topics: list[GeneratedTopic] = Field(min_length=1, max_length=5)


# 模型生成的最小草稿结构，入库后再补充版本和关联 ID。
class DraftOutput(Strict):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=30000)


# 一条样本的模型分类结果；完整覆盖与重复 ID 校验在 worker 中。
class Classification(Strict):
    note_id: str
    topic: str = Field(min_length=1, max_length=100)


# 一次分析同时输出分类和选题，便于事务内统一保存。
class AnalysisOutput(TopicOutput):
    classifications: list[Classification] = Field(max_length=100)


T = TypeVar("T")
Status = Literal[
    "queued",
    "collecting",
    "cleaning",
    "analyzing",
    "completed",
    "partial",
    "failed",
    "cancelled",
]


# 通用分页响应，前端依照 total 拉取完整集合。
class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


# 研究总体状态与分析覆盖信息；analysis_stale 表示样本变更后结果需重算。
class ResearchOut(ResearchInput):
    id: str
    job_id: str | None
    created_at: str
    status: Status
    progress: int
    error: str | None = None
    source: str
    analysis_stale: bool = False
    analysis_note: str = "尚未进行模型分析"
    analysis_coverage: list[str] = Field(default_factory=list)


# 公开任务状态与用量，不暴露内部 payload。
class JobOut(BaseModel):
    id: str
    kind: Literal["research", "topics", "draft"]
    research_run_id: str
    status: Status
    progress: int
    completed_count: int
    total_count: int | None
    cancel_requested: bool
    result_id: str | None
    error: str | None
    created_at: str
    updated_at: str
    usage: dict


# 样本响应补充采集时间、精度、评论覆盖及来源，区分观察事实与未知数据。
class NoteOut(ImportedNote):
    id: str
    run_id: str
    excluded: bool
    captured_at: str
    metrics_precision: Literal["exact", "approximate", "unknown"]
    metric_raw: dict = Field(default_factory=dict)
    comment_samples: list[dict] = Field(default_factory=list)
    comment_coverage: dict
    provenance: list[dict]
    content_hash: str
    media_analyzed: bool = False
    author_id: str | None = None


# 模型选题加上本地 ID、所属研究和收藏状态。
class TopicOut(GeneratedTopic):
    id: str
    run_id: str
    status: Literal["candidate", "saved"]


# 当前草稿/历史版本共用的响应结构，允许用户编辑更长正文。
class DraftOut(DraftOutput):
    body: str = Field(min_length=1, max_length=100000)
    id: str
    topic_id: str
    brief: str
    version: int
    updated_at: str


# 后台任务已入队；收到此响应不代表生成完成。
class AcceptedJob(BaseModel):
    job_id: str


# 创建研究同时返回研究 ID 与后台任务 ID。
class AcceptedResearch(AcceptedJob):
    research_run_id: str


# 导入完成后返回去重后的实际样本数量。
class Imported(BaseModel):
    research_run_id: str
    imported: int


# 确定性统计、模型观察与分析范围共同组成页面报表。
class ReportOut(BaseModel):
    run_id: str
    summary: dict[str, int]
    groups: list[dict]
    observations: list[dict]
    scope: str
    generated_at: str
    analysis_stale: bool
    analysis_note: str
    analysis_coverage: list[str]


# configured 只代表已配置，connected 才表示对应检查成功。
class ConnectionState(BaseModel):
    status: Literal["connected", "configured", "disconnected", "error"]
    message: str


# 分别呈现 MCP、模型与 worker 状态，避免混为一个连接结果。
class Connections(BaseModel):
    mcp: ConnectionState
    model: ConnectionState
    worker: Literal["running", "offline"]


# 轻量健康检查响应，不调用 MCP 或模型。
class Health(BaseModel):
    status: Literal["ok"]
    worker: Literal["running", "offline"]
    mode: Literal["live"]


# 可公开的错误码、提示和补充字段。
class ErrorInfo(BaseModel):
    code: str
    message: str
    details: dict = Field(default_factory=dict)


# 统一错误封套，以 request_id 关联后台日志。
class ErrorResponse(BaseModel):
    error: ErrorInfo
    request_id: str
