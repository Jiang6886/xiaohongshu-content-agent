# 持久化层：SQLite 保存研究、任务、样本、选题和草稿历史。
# 可查询字段单独建列，完整业务对象存入 JSON；事务由调用方显式控制。

import hashlib
import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Integer,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    create_engine,
    delete,
    event,
    insert,
    select,
    update,
)

from .config import Config
from .schemas import Settings

TERMINAL = {"completed", "partial", "cancelled", "failed"}


# 统一使用带时区的 UTC 时间，前端展示时再转换成本地时间。
def now():
    return datetime.now(timezone.utc).isoformat()


# 生成本地业务 ID，与小红书 platform_id 分开。
def uid():
    return uuid4().hex


# 对排序后的 JSON 求摘要，供幂等请求和内容快照比对使用。
def digest(value):
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()


# 可向前端公开的业务异常；不要把供应商原始响应或密钥放入 message/details。
class Problem(Exception):
    def __init__(self, code, message, status=400, details=None):
        self.code, self.message, self.status, self.details = (
            code,
            message,
            status,
            details or {},
        )
        super().__init__(message)


metadata = MetaData()
runs = Table(
    "research_runs",
    metadata,
    Column("id", String, primary_key=True),
    Column("data", JSON, nullable=False),
)
jobs = Table(
    "jobs",
    metadata,
    Column("id", String, primary_key=True),
    Column("run_id", String, index=True),
    Column("status", String, index=True),
    Column("cancel_requested", Boolean, default=False),
    Column("data", JSON, nullable=False),
)
notes = Table(
    "notes",
    metadata,
    Column("id", String, primary_key=True),
    Column("run_id", String, index=True),
    Column("platform_id", String),
    Column("data", JSON, nullable=False),
    UniqueConstraint("run_id", "platform_id"),
)
snapshots = Table(
    "metric_snapshots",
    metadata,
    Column("id", String, primary_key=True),
    Column("note_id", String, index=True),
    Column("data", JSON, nullable=False),
)
topics = Table(
    "topics",
    metadata,
    Column("id", String, primary_key=True),
    Column("run_id", String, index=True),
    Column("data", JSON, nullable=False),
)
drafts = Table(
    "drafts",
    metadata,
    Column("id", String, primary_key=True),
    Column("version", Integer, nullable=False),
    Column("data", JSON, nullable=False),
)
versions = Table(
    "draft_versions",
    metadata,
    Column("draft_id", String, primary_key=True),
    Column("version", Integer, primary_key=True),
    Column("data", JSON, nullable=False),
)
settings = Table(
    "settings",
    metadata,
    Column("id", String, primary_key=True),
    Column("data", JSON, nullable=False),
)
idem = Table(
    "idempotency",
    metadata,
    Column("key", String, primary_key=True),
    Column("fingerprint", String),
    Column("result", JSON),
    Column("created_at", String),
)


# 封装数据库操作；传入已有连接可让多个写操作共用一个事务。
class Store:
    def __init__(self, config: Config):
        self.config = config
        config.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.engine = create_engine(
            f"sqlite:///{config.data_dir / 'studio.sqlite3'}",
            connect_args={"check_same_thread": False, "timeout": 15},
        )

        @event.listens_for(self.engine, "connect")
        def setup(dbapi, _):
            dbapi.execute("PRAGMA journal_mode=WAL")
            dbapi.execute("PRAGMA busy_timeout=15000")

        metadata.create_all(self.engine)
        os.chmod(config.data_dir / "studio.sqlite3", 0o600)
        with self.tx() as c:
            if not c.execute(select(settings).where(settings.c.id == "app")).first():
                c.execute(
                    insert(settings).values(
                        id="app", data=Settings(model=config.model_name).model_dump()
                    )
                )
            row = (
                c.execute(select(settings).where(settings.c.id == "schema"))
                .mappings()
                .first()
            )
            if row and row["data"]["version"] != 1:
                raise RuntimeError("Unsupported database schema version")
            if not row:
                c.execute(insert(settings).values(id="schema", data={"version": 1}))

    # BEGIN IMMEDIATE 提前获取写锁，避免读后写之间出现竞争；异常时整体回滚。
    @contextmanager
    def tx(self):
        with self.engine.connect() as c:
            c.exec_driver_sql("BEGIN IMMEDIATE")
            try:
                yield c
                c.commit()
            except BaseException:
                c.rollback()
                raise

    # 按主键读取 JSON；可复用事务连接，找不到时统一抛出 404。
    def get(self, table, id, c=None):
        if c is None:
            with self.engine.connect() as conn:
                return self.get(table, id, conn)
        row = c.execute(
            select(table.c.data).where(table.c.id == id)
        ).scalar_one_or_none()
        if row is None:
            raise Problem("NOT_FOUND", "资源不存在", 404)
        return row

    # 读取符合条件的业务对象；分页和排序由上层按接口需求处理。
    def list(self, table, condition=None, c=None):
        if c is None:
            with self.engine.connect() as conn:
                return self.list(table, condition, conn)
        stmt = select(table.c.data)
        if condition is not None:
            stmt = stmt.where(condition)
        return list(c.execute(stmt).scalars())

    # 更新已有记录，同时允许同步状态等独立列；此方法不负责插入。
    def put(self, c, table, id, data, **extra):
        c.execute(update(table).where(table.c.id == id).values(data=data, **extra))

    # 普通创作偏好不包含 API Key，可安全返回给前端。
    def preference(self):
        return self.get(settings, "app")

    # 以独立状态列为准覆盖 JSON，保证取消标记和任务状态读取一致。
    def job(self, id, c=None):
        if c is None:
            with self.engine.connect() as conn:
                return self.job(id, conn)
        row = c.execute(select(jobs).where(jobs.c.id == id)).mappings().first()
        if not row:
            raise Problem("NOT_FOUND", "任务不存在", 404)
        return dict(
            row["data"], status=row["status"], cancel_requested=row["cancel_requested"]
        )

    # 仅创建排队记录；冻结本次任务的普通设置，实际执行由 worker 领取。
    def enqueue(self, c, run_id, kind, payload):
        id = uid()
        data = {
            "id": id,
            "kind": kind,
            "research_run_id": run_id,
            "progress": 0,
            "completed_count": 0,
            "total_count": None,
            "result_id": None,
            "error": None,
            "created_at": now(),
            "updated_at": now(),
            "payload": payload,
            "usage": {
                "reserved_tokens": 0,
                "input_tokens": None,
                "output_tokens": None,
                "tool_calls": 0,
            },
        }
        c.execute(
            insert(jobs).values(
                id=id, run_id=run_id, status="queued", cancel_requested=False, data=data
            )
        )
        return id

    # 相同幂等键和请求复用结果；键相同但内容不同返回冲突。
    # 业务写入与幂等结果在同一事务提交，避免网络重试重复创建任务。
    def idempotent(self, key, scope, payload, operation):
        fingerprint = digest([scope, payload])
        with self.tx() as c:
            old = c.execute(select(idem).where(idem.c.key == key)).mappings().first()
            if old:
                if old["fingerprint"] != fingerprint:
                    raise Problem(
                        "IDEMPOTENCY_CONFLICT", "同一请求标识对应了不同内容", 409
                    )
                return old["result"]
            result = operation(c)
            c.execute(
                insert(idem).values(
                    key=key, fingerprint=fingerprint, result=result, created_at=now()
                )
            )
            return result

    # 创建研究容器；采集样本、选题和后台任务都通过 run_id 关联它。
    def create_run(self, c, data, source="mcp"):
        id = uid()
        r = dict(
            data,
            id=id,
            job_id=None,
            created_at=now(),
            status="queued",
            progress=0,
            error=None,
            source=source,
            analysis_stale=False,
        )
        c.execute(insert(runs).values(id=id, data=r))
        return r

    # 按研究 ID + 平台笔记 ID 去重；重复命中只补充来源，新样本保存指标快照。
    def store_note(self, run_id, data, provenance):
        with self.tx() as c:
            existing = c.execute(
                select(notes.c.data).where(
                    notes.c.run_id == run_id, notes.c.platform_id == data["platform_id"]
                )
            ).scalar_one_or_none()
            if existing:
                existing["provenance"] = existing.get("provenance", []) + [provenance]
                self.put(c, notes, existing["id"], existing)
                return existing
            n = dict(
                data,
                id=uid(),
                run_id=run_id,
                excluded=False,
                captured_at=now(),
                provenance=[provenance],
            )
            n["content_hash"] = digest([n["title"], n["body"]])
            c.execute(
                insert(notes).values(
                    id=n["id"], run_id=run_id, platform_id=n["platform_id"], data=n
                )
            )
            c.execute(
                insert(snapshots).values(
                    id=uid(),
                    note_id=n["id"],
                    data={
                        k: n.get(k)
                        for k in [
                            "captured_at",
                            "likes",
                            "saves",
                            "comments",
                            "metric_raw",
                            "metrics_precision",
                            "content_hash",
                        ]
                    },
                )
            )
            return n

    # 同步任务状态与研究状态；仅已进入分析阶段的失败允许由成功重分析修复。
    def update_job(self, id, status=None, **fields):
        with self.tx() as c:
            job = self.job(id, c)
            job.update(fields)
            job["updated_at"] = now()
            current = status or job["status"]
            data = {
                k: v for k, v in job.items() if k not in ("status", "cancel_requested")
            }
            self.put(c, jobs, id, data, status=current)
            if job["kind"] == "research":
                r = self.get(runs, job["research_run_id"], c)
                r.update(status=current, progress=job["progress"], error=job["error"])
                self.put(c, runs, r["id"], r)
            elif job["kind"] == "topics" and current == "completed":
                r = self.get(runs, job["research_run_id"], c)
                # 采集阶段进度最多 75%，整理/模型阶段从 80% 开始。
                # 重分析成功只修复分析阶段失败，不把未完成的采集误标为完成。
                if r["status"] in {"partial", "failed"} and r["progress"] >= 80:
                    r.update(status="completed", progress=100, error=None)
                    self.put(c, runs, r["id"], r)

    # 持有写锁检查活动任务并级联删除，防止 worker 同时领取任务或写回结果。
    def delete_run(self, id):
        with self.tx() as c:
            self.get(runs, id, c)
            if c.execute(
                select(jobs.c.id).where(
                    jobs.c.run_id == id, jobs.c.status.not_in(TERMINAL)
                )
            ).first():
                raise Problem(
                    "JOB_ALREADY_RUNNING",
                    "该研究仍有活动任务，请先取消并等待停止后再删除",
                    409,
                )
            note_ids = select(notes.c.id).where(notes.c.run_id == id)
            topic_ids = {t["id"] for t in self.list(topics, topics.c.run_id == id, c)}
            draft_ids = [
                d["id"] for d in self.list(drafts, c=c) if d["topic_id"] in topic_ids
            ]
            job_ids = set(
                c.execute(select(jobs.c.id).where(jobs.c.run_id == id)).scalars()
            )
            c.execute(delete(snapshots).where(snapshots.c.note_id.in_(note_ids)))
            c.execute(delete(versions).where(versions.c.draft_id.in_(draft_ids)))
            c.execute(delete(drafts).where(drafts.c.id.in_(draft_ids)))
            # 清除指向已删除对象的幂等结果，避免后续提交拿到失效 ID。
            for entry in c.execute(select(idem)).mappings():
                result = entry["result"]
                if (
                    result.get("research_run_id") == id
                    or result.get("job_id") in job_ids
                ):
                    c.execute(delete(idem).where(idem.c.key == entry["key"]))
            for table in (topics, notes, jobs):
                c.execute(delete(table).where(table.c.run_id == id))
            c.execute(delete(runs).where(runs.c.id == id))

    # 协作式取消检查：在步骤边界抛出异常，不强行中断正在执行的外部请求。
    def check_cancel(self, id):
        if self.job(id)["cancel_requested"]:
            raise Problem("CANCELLED", "任务已取消", 409)
