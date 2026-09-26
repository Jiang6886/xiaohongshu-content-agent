# HTTP 接口层：校验请求、读写本地数据、投递后台任务并统一返回错误。
# 耗时采集和内容生成交给 worker；显式连接测试在当前请求内执行。

from .model_settings import ModelInput, ModelPublic, public, resolve, save
from .intelligence import Intelligence
from .schemas import ErrorResponse
from .schemas import (
    Page as PageResponse,
    ResearchOut,
    JobOut,
    NoteOut,
    TopicOut,
    DraftOut,
    AcceptedJob,
    AcceptedResearch,
    Imported,
    ReportOut,
    Connections,
    Health,
)
import asyncio
import json
from datetime import datetime, timezone
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import insert, select, update

from .analytics import report
from .config import ROOT, Config
from .connectors import MCPConnector
from .schemas import (
    Brief,
    DraftInput,
    Exclusion,
    ImportInput,
    ResearchInput,
    Settings,
    TopicPatch,
)
from .storage import (
    TERMINAL,
    Problem,
    Store,
    drafts,
    jobs,
    notes,
    now,
    runs,
    settings,
    topics,
    uid,
    versions,
)

Key = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=200)]
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]


# 统一列表分页格式；total 是筛选后总数，不是当前页条数。
def paginate(values, page, page_size):
    return {
        "items": values[(page - 1) * page_size : page * page_size],
        "total": len(values),
        "page": page,
        "page_size": page_size,
    }


# 任务内部 payload 含执行上下文，不作为公开接口响应返回。
def public_job(job):
    return {k: v for k, v in job.items() if k != "payload"}


# 装配存储、接口、中间件与前端静态资源；可注入配置用于隔离测试。
def create_app(config=None):
    config = config or Config()
    store = Store(config)
    app = FastAPI(
        title="拾叶内容研究台 API",
        version="0.2.0",
        responses={
            code: {"model": ErrorResponse, "description": description}
            for code, description in [
                (400, "请求错误"),
                (403, "来源或操作不允许"),
                (404, "资源不存在"),
                (409, "状态或版本冲突"),
                (422, "字段校验失败"),
                (429, "频率限制"),
                (503, "外部服务未配置或不可用"),
            ]
        },
        description="本地单用户 FastAPI 服务。数据存储于 SQLite，长任务由独立 worker 执行。",
    )
    app.state.store = store

    # 限制浏览器来源并分配请求 ID；这是本地单用户保护，不是公网身份认证。
    @app.middleware("http")
    async def local_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        # 本服务面向本地工作区；来源限制不能替代公网部署所需的身份认证。
        if origin and origin not in {
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:8000",
            "http://localhost:8000",
            "http://127.0.0.1:4173",
            "http://localhost:4173",
            config.extra_origin,
        }:
            return JSONResponse(
                {
                    "error": {
                        "code": "ORIGIN_DENIED",
                        "message": "不允许此网页来源访问本地服务",
                        "details": {},
                    },
                    "request_id": uid(),
                },
                status_code=403,
            )
        request.state.request_id = uid()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    # 将业务异常转换为稳定的 error + request_id 响应格式。
    @app.exception_handler(Problem)
    async def problem(request, e):
        return JSONResponse(
            {
                "error": {"code": e.code, "message": e.message, "details": e.details},
                "request_id": getattr(request.state, "request_id", uid()),
            },
            status_code=e.status,
        )

    # 只返回字段位置和校验信息，不回显可能含 API Key 的原始输入。
    @app.exception_handler(RequestValidationError)
    async def validation(request, e):
        return await problem(
            request,
            Problem(
                "VALIDATION_ERROR",
                "请求字段校验失败",
                422,
                {
                    "fields": [
                        {"loc": list(x["loc"]), "message": x["msg"]} for x in e.errors()
                    ]
                },
            ),
        )

    # 日志仅记录异常类型与请求 ID，避免外部服务异常泄露敏感内容。
    @app.exception_handler(Exception)
    async def unexpected(request, e):
        import logging

        logging.getLogger(__name__).error(
            "Request %s: %s",
            getattr(request.state, "request_id", "?"),
            type(e).__name__,
        )
        return await problem(
            request, Problem("INTERNAL_ERROR", "服务异常，请按请求 ID 检查日志", 500)
        )

    prefix = "/api/v1"

    # 读取 worker 心跳；API 可用和 worker 在线是两个独立状态。
    @app.get(prefix + "/health", response_model=Health, tags=["system"])
    def health():
        marker = config.data_dir / "worker.heartbeat"
        try:
            alive = (
                datetime.now(timezone.utc) - datetime.fromisoformat(marker.read_text())
            ).total_seconds() < 15
        except (FileNotFoundError, ValueError):
            alive = False
        return {
            "status": "ok",
            "worker": "running" if alive else "offline",
            "mode": "live",
        }

    # 读取作者设定、语气、预算等普通创作设置。
    @app.get(prefix + "/settings", response_model=Settings, tags=["settings"])
    def get_settings():
        return store.preference()

    # 保存普通设置；已排队任务仍使用入队时的设置快照。
    @app.put(prefix + "/settings", response_model=Settings, tags=["settings"])
    def put_settings(body: Settings):
        with store.tx() as c:
            store.put(c, settings, "app", body.model_dump())
        return body

    # 读取当前生效模型的公开配置，不返回密钥。
    @app.get(prefix + "/model-config", response_model=ModelPublic, tags=["settings"])
    def get_model_config():
        return public(config)

    # 安全保存模型配置，后续模型调用自动读取新值。
    @app.put(prefix + "/model-config", response_model=ModelPublic, tags=["settings"])
    def put_model_config(body: ModelInput):
        return save(config, body)

    # 用户显式触发的小额真实模型调用；保存配置本身不会执行此测试。
    @app.post(prefix + "/model-config/test", tags=["settings"])
    async def test_model_config():
        await Intelligence(config).generate(
            'Return only JSON: {"ok":true}', 'Connection test', '', 64
        )
        return {"status": "connected", "message": "模型调用成功"}

    # 检查 MCP 登录和 worker 状态；模型这里只检查配置是否存在。
    @app.get(prefix + "/connections", response_model=Connections, tags=["system"])
    async def connections():
        try:
            async with asyncio.timeout(config.tool_timeout):
                await MCPConnector(config).login()
            mcp = {"status": "connected", "message": "MCP 可访问，账号已登录"}
        except (Problem, TimeoutError) as e:
            mcp = {
                "status": "disconnected",
                "message": e.message if isinstance(e, Problem) else "MCP 状态检查超时",
            }
        return {
            "mcp": mcp,
            "model": {
                "status": "configured" if resolve(config).model_configured else "disconnected",
                "message": "已配置；尚未验证实际模型调用"
                if resolve(config).model_configured
                else "请在设置的模型服务中填写模型名称、服务地址和 API Key",
            },
            "worker": health()["worker"],
        }

    # 按创建时间倒序列出研究，便于前端优先展示最近任务。
    @app.get(
        prefix + "/research-runs",
        response_model=PageResponse[ResearchOut],
        tags=["research"],
    )
    def list_runs(page: Page = 1, page_size: PageSize = 20):
        return paginate(
            sorted(store.list(runs), key=lambda r: r["created_at"], reverse=True),
            page,
            page_size,
        )

    # 同一事务创建研究与采集任务，立即返回 202，等待 worker 执行。
    @app.post(
        prefix + "/research-runs",
        response_model=AcceptedResearch,
        status_code=202,
        tags=["research"],
    )
    def create_run(body: ResearchInput, idempotency_key: Key):
        def action(c):
            r = store.create_run(c, body.model_dump())
            job = store.enqueue(
                c, r["id"], "research", {"settings": store.get(settings, "app", c)}
            )
            r["job_id"] = job
            store.put(c, runs, r["id"], r)
            return {"research_run_id": r["id"], "job_id": job}

        return store.idempotent(idempotency_key, "research", body.model_dump(), action)

    # 显式导入用户样本并去重、保存指标快照；导入完成不等于已做模型分析。
    @app.post(
        prefix + "/imports", response_model=Imported, status_code=201, tags=["research"]
    )
    def import_notes(body: ImportInput, idempotency_key: Key):
        # 这里只导入用户显式提供的样本，不自动填充演示数据。
        if len(body.notes) > body.research.limit:
            raise Problem("IMPORT_LIMIT", "导入笔记数量超过本次研究上限")

        def action(c):
            r = store.create_run(c, body.research.model_dump(), "import")
            seen = set()
            for n in body.notes:
                if n.platform_id in seen:
                    continue
                seen.add(n.platform_id)
                value = dict(
                    n.model_dump(),
                    id=uid(),
                    run_id=r["id"],
                    excluded=False,
                    captured_at=now(),
                    metrics_precision="unknown",
                    metric_raw={},
                    comment_samples=[],
                    comment_coverage={"loaded": 0, "limit": 0, "complete": False},
                    provenance=[{"source": "manual_import", "observed_at": now()}],
                    media_analyzed=False,
                )
                from .storage import digest, snapshots

                value["content_hash"] = digest([value["title"], value["body"]])
                c.execute(
                    insert(notes).values(
                        id=value["id"],
                        run_id=r["id"],
                        platform_id=n.platform_id,
                        data=value,
                    )
                )
                c.execute(
                    insert(snapshots).values(
                        id=uid(),
                        note_id=value["id"],
                        data={
                            k: value.get(k)
                            for k in [
                                "captured_at",
                                "likes",
                                "saves",
                                "comments",
                                "metrics_precision",
                                "content_hash",
                            ]
                        },
                    )
                )
            r.update(
                status="completed",
                progress=100,
                analysis_note="用户导入的数据；尚未进行模型分析",
            )
            store.put(c, runs, r["id"], r)
            return {"research_run_id": r["id"], "imported": len(seen)}

        return store.idempotent(idempotency_key, "import", body.model_dump(), action)

    # 读取研究总体状态，供详情和进度展示使用。
    @app.get(
        prefix + "/research-runs/{id}", response_model=ResearchOut, tags=["research"]
    )
    def get_run(id: str):
        return store.get(runs, id)

    # 读取单个任务状态及结果 ID，供前端轮询使用。
    @app.get(prefix + "/jobs/{id}", response_model=JobOut, tags=["jobs"])
    def get_job(id: str):
        return public_job(store.job(id))

    # 返回任务历史；界面可据此合并同一研究的重试状态。
    @app.get(prefix + "/jobs", response_model=PageResponse[JobOut], tags=["jobs"])
    def list_jobs(page: Page = 1, page_size: PageSize = 20):
        return paginate(
            sorted(
                [public_job(store.job(j["id"])) for j in store.list(jobs)],
                key=lambda j: j["created_at"],
                reverse=True,
            ),
            page,
            page_size,
        )

    # 仅设置取消请求；worker 在下一处取消检查时结束任务。
    @app.post(
        prefix + "/jobs/{id}/cancel",
        response_model=JobOut,
        status_code=202,
        tags=["jobs"],
    )
    def cancel(id: str):
        with store.tx() as c:
            j = store.job(id, c)
            if j["status"] not in TERMINAL:
                c.execute(
                    update(jobs).where(jobs.c.id == id).values(cancel_requested=True)
                )
        return public_job(store.job(id))

    # 为可重试终态创建新任务并刷新普通设置快照，保留原任务作为历史。
    @app.post(
        prefix + "/jobs/{id}/retry",
        response_model=AcceptedJob,
        status_code=202,
        tags=["jobs"],
    )
    def retry(id: str, idempotency_key: Key):
        def action(c):
            j = store.job(id, c)
            if j["status"] not in {"failed", "partial", "cancelled"}:
                raise Problem(
                    "JOB_NOT_RETRYABLE", "只能重试失败、取消或部分完成的任务", 409
                )
            active = c.execute(
                select(jobs.c.id).where(
                    jobs.c.run_id == j["research_run_id"],
                    jobs.c.status.not_in(TERMINAL),
                )
            ).first()
            if active:
                raise Problem("JOB_ALREADY_RUNNING", "该研究已有活动任务", 409)
            payload = j["payload"]
            payload["settings"] = store.get(settings, "app", c)
            new = store.enqueue(c, j["research_run_id"], j["kind"], payload)
            if j["kind"] == "research":
                r = store.get(runs, j["research_run_id"], c)
                r.update(job_id=new, status="queued", error=None)
                store.put(c, runs, r["id"], r)
            return {"job_id": new}

        return store.idempotent(idempotency_key, "retry:" + id, {}, action)

    # 同时校验研究存在与样本归属，防止跨研究错误引用。
    def get_note(run_id, note_id, c=None):
        store.get(runs, run_id, c)
        n = store.get(notes, note_id, c)
        if n["run_id"] != run_id:
            raise Problem("NOT_FOUND", "样本不属于该研究", 404)
        return n

    # 样本列表与导出共用过滤逻辑；点赞排序把未知值放到最后。
    def filtered(id, q, topic, excluded, sort):
        store.get(runs, id)
        values = store.list(notes, notes.c.run_id == id)
        values = [
            n
            for n in values
            if (not q or q.casefold() in (n["title"] + n["author"]).casefold())
            and (not topic or n["topic"] == topic)
            and (excluded is None or n["excluded"] == excluded)
        ]
        if sort == "published_desc":
            values.sort(key=lambda n: n["published_at"] or "", reverse=True)
        elif sort:
            values.sort(
                key=lambda n: (
                    n["likes"] is None,
                    -(n["likes"] or 0) if sort == "likes_desc" else (n["likes"] or 0),
                )
            )
        return values

    Sort = Literal["likes_desc", "likes_asc", "published_desc"]

    # 导出满足筛选条件的全部样本，不受列表分页影响。
    @app.get(
        prefix + "/research-runs/{id}/notes/export",
        tags=["notes"],
        response_model=list[NoteOut],
    )
    def export_notes(
        id: str,
        q: str = "",
        topic: str = "",
        excluded: bool | None = None,
        sort: Sort | None = None,
    ):
        return Response(
            json.dumps(
                filtered(id, q, topic, excluded, sort), ensure_ascii=False, indent=2
            ),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="notes.json"'},
        )

    # 先过滤排序再分页，保持总数与当前筛选条件一致。
    @app.get(
        prefix + "/research-runs/{id}/notes",
        response_model=PageResponse[NoteOut],
        tags=["notes"],
    )
    def list_notes(
        id: str,
        q: str = "",
        topic: str = "",
        excluded: bool | None = None,
        sort: Sort | None = None,
        page: Page = 1,
        page_size: PageSize = 20,
    ):
        return paginate(filtered(id, q, topic, excluded, sort), page, page_size)

    # 返回一条属于当前研究的完整样本与来源信息。
    @app.get(
        prefix + "/research-runs/{id}/notes/{note_id}",
        response_model=NoteOut,
        tags=["notes"],
    )
    def detail(id: str, note_id: str):
        return get_note(id, note_id)

    # 排除/恢复样本不删除原始数据，同时标记旧分析过期。
    @app.patch(
        prefix + "/research-runs/{id}/notes/{note_id}",
        response_model=NoteOut,
        tags=["notes"],
    )
    def exclusion(id: str, note_id: str, body: Exclusion):
        with store.tx() as c:
            n = get_note(id, note_id, c)
            n["excluded"] = body.excluded
            store.put(c, notes, note_id, n)
            r = store.get(runs, id, c)
            r["analysis_stale"] = True
            store.put(c, runs, id, r)
        return n

    # 汇总确定性统计和已有模型观察，不在读取报表时触发新模型调用。
    @app.get(
        prefix + "/research-runs/{id}/report",
        response_model=ReportOut,
        tags=["analysis"],
    )
    def get_report(id: str):
        return report(store, id)

    # 按研究读取候选与已收藏选题。
    @app.get(
        prefix + "/research-runs/{id}/topics",
        response_model=list[TopicOut],
        tags=["topics"],
    )
    def list_topics(id: str):
        store.get(runs, id)
        return store.list(topics, topics.c.run_id == id)

    # 提交生成任务前检查当前生效模型配置是否齐全。
    def model_required():
        if not resolve(config).model_configured:
            raise Problem(
                "MODEL_NOT_CONFIGURED",
                "请先在 backend/.env 配置模型，并重启 API 与 worker",
                503,
            )

    # 对现有有效样本重新分析；同一研究有活动任务时拒绝重复入队。
    @app.post(
        prefix + "/research-runs/{id}/topic-jobs",
        response_model=AcceptedJob,
        status_code=202,
        tags=["topics"],
    )
    def generate_topics(id: str, idempotency_key: Key):
        model_required()

        def action(c):
            store.get(runs, id, c)
            if c.execute(
                select(jobs.c.id).where(
                    jobs.c.run_id == id, jobs.c.status.not_in(TERMINAL)
                )
            ).first():
                raise Problem("JOB_ALREADY_RUNNING", "该研究已有活动任务", 409)
            if not any(
                not n["excluded"] for n in store.list(notes, notes.c.run_id == id, c)
            ):
                raise Problem("NO_SAMPLES", "请先采集或导入有效样本")
            return {
                "job_id": store.enqueue(
                    c, id, "topics", {"settings": store.get(settings, "app", c)}
                )
            }

        return store.idempotent(idempotency_key, "topics:" + id, {}, action)

    # 切换选题的候选/收藏状态。
    @app.patch(prefix + "/topics/{id}", response_model=TopicOut, tags=["topics"])
    def patch_topic(id: str, body: TopicPatch):
        with store.tx() as c:
            t = store.get(topics, id, c)
            t.update(body.model_dump())
            store.put(c, topics, id, t)
        return t

    # 把选题、补充要求和普通设置快照交给后台生成草稿。
    @app.post(
        prefix + "/topics/{id}/draft-jobs",
        response_model=AcceptedJob,
        status_code=202,
        tags=["drafts"],
    )
    def generate_draft(id: str, body: Brief, idempotency_key: Key):
        model_required()

        def action(c):
            t = store.get(topics, id, c)
            return {
                "job_id": store.enqueue(
                    c,
                    t["run_id"],
                    "draft",
                    dict(
                        body.model_dump(),
                        topic_id=id,
                        settings=store.get(settings, "app", c),
                    ),
                )
            }

        return store.idempotent(
            idempotency_key, "draft:" + id, body.model_dump(), action
        )

    # 按更新时间倒序展示最新草稿，可按选题过滤。
    @app.get(prefix + "/drafts", response_model=PageResponse[DraftOut], tags=["drafts"])
    def list_drafts(
        topic_id: str | None = None, page: Page = 1, page_size: PageSize = 20
    ):
        values = sorted(
            [
                d
                for d in store.list(drafts)
                if topic_id is None or d["topic_id"] == topic_id
            ],
            key=lambda d: d["updated_at"],
            reverse=True,
        )
        return paginate(values, page, page_size)

    # 读取草稿当前版本，历史版本通过独立接口访问。
    @app.get(prefix + "/drafts/{id}", response_model=DraftOut, tags=["drafts"])
    def get_draft(id: str):
        return store.get(drafts, id)

    # 用 base_version 实现乐观锁，防止旧页面覆盖新内容；正文与历史原子提交。
    @app.post(
        prefix + "/drafts/{id}/versions",
        response_model=DraftOut,
        status_code=201,
        tags=["drafts"],
    )
    def save_draft(id: str, body: DraftInput):
        with store.tx() as c:
            d = store.get(drafts, id, c)
            if d["version"] != body.base_version:
                raise Problem(
                    "VERSION_CONFLICT",
                    "草稿已更新，请比较最新版本后再保存",
                    409,
                    {"current_version": d["version"]},
                )
            d.update(
                title=body.title,
                body=body.body,
                brief=body.brief,
                version=d["version"] + 1,
                updated_at=now(),
            )
            result = c.execute(
                update(drafts)
                .where(drafts.c.id == id, drafts.c.version == body.base_version)
                .values(version=d["version"], data=d)
            )
            if result.rowcount != 1:
                raise Problem("VERSION_CONFLICT", "草稿已更新", 409)
            c.execute(
                insert(versions).values(draft_id=id, version=d["version"], data=d)
            )
        return d

    # 按版本倒序返回草稿历史，供只读回顾使用。
    @app.get(
        prefix + "/drafts/{id}/versions",
        response_model=PageResponse[DraftOut],
        tags=["drafts"],
    )
    def history(id: str, page: Page = 1, page_size: PageSize = 20):
        store.get(drafts, id)
        with store.engine.connect() as c:
            values = list(
                c.execute(
                    select(versions.c.data)
                    .where(versions.c.draft_id == id)
                    .order_by(versions.c.version.desc())
                ).scalars()
            )
        return paginate(values, page, page_size)

    # 导出当前或指定历史版本 Markdown；编码中文文件名用于附件下载。
    @app.get(
        prefix + "/drafts/{id}/export",
        tags=["drafts"],
        response_class=Response,
        responses={
            200: {
                "description": "Markdown 附件",
                "content": {"text/markdown": {"schema": {"type": "string"}}},
            }
        },
    )
    def export_draft(id: str, version: Annotated[int | None, Query(ge=1)] = None):
        d = store.get(drafts, id)
        if version is not None:
            with store.engine.connect() as c:
                d = c.execute(
                    select(versions.c.data).where(
                        versions.c.draft_id == id, versions.c.version == version
                    )
                ).scalar_one_or_none()
            if not d:
                raise Problem("NOT_FOUND", "草稿版本不存在", 404)
        return Response(
            d["body"],
            media_type="text/markdown",
            headers={
                "Content-Disposition": "attachment; filename*=UTF-8''"
                + quote(d["title"] + ".md", safe="")
            },
        )

    frontend = ROOT / "frontend" / "dist"
    if frontend.exists():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

        # 前端路由回退到 index.html；未知 API 路径仍返回 404。
        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise Problem("NOT_FOUND", "接口不存在", 404)
            return FileResponse(frontend / "index.html")

    return app


app = create_app()
