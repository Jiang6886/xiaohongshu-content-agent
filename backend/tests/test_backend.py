import json
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert
from xhs_content_agent.app import create_app
from xhs_content_agent.config import Config
from xhs_content_agent.connectors import MCPConnector, metric, normalize
from xhs_content_agent.intelligence import Intelligence
from xhs_content_agent.storage import (
    Problem,
    Store,
    drafts,
    notes,
    now,
    runs,
    topics,
    versions,
)
from xhs_content_agent.worker import Worker


@pytest.fixture
def app(tmp_path):
    return create_app(
        Config(
            data_dir=tmp_path,
            model_name="",
            model_api_key="",
            _env_file=None,
            collection_delay=0,
        )
    )


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


def create(client, key="r1", **extra):
    return client.post(
        "/api/v1/research-runs",
        headers={"Idempotency-Key": key},
        json=dict(
            name="研究", keywords=["AI"], audience="初学者", days=7, limit=3, **extra
        ),
    )


def imported(client):
    response = client.post(
        "/api/v1/imports",
        headers={"Idempotency-Key": "import1"},
        json={
            "research": {
                "name": "导入研究",
                "keywords": ["AI"],
                "audience": "读者",
                "limit": 3,
            },
            "notes": [
                {
                    "platform_id": "n1",
                    "title": "第一篇",
                    "likes": 0,
                    "saves": None,
                    "body": "用户提供的材料",
                },
                {"platform_id": "n1", "title": "重复样本"},
                {"platform_id": "n2", "title": "第二篇", "likes": 12},
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["research_run_id"]


def test_idempotency_validation_and_cancel(client, app):
    first = create(client)
    assert first.status_code == 202
    assert create(client).json() == first.json()
    bad = client.post(
        "/api/v1/research-runs",
        headers={"Idempotency-Key": "r1"},
        json={"name": "不同内容", "keywords": ["AI"], "audience": "读者"},
    )
    assert bad.status_code == 409
    assert client.get("/api/v1/research-runs").json()["total"] == 1
    id = first.json()["job_id"]
    assert client.post(f"/api/v1/jobs/{id}/cancel").json()["cancel_requested"]
    assert client.get("/api/v1/jobs/" + id).json().get("payload") is None
    assert client.post("/api/v1/research-runs", json={}).status_code == 422
    assert client.put("/api/v1/settings", json={"budget": -1}).status_code == 422
    assert (
        client.get(
            "/api/v1/health", headers={"Origin": "https://unrelated.example"}
        ).status_code
        == 403
    )


def test_import_dedup_filters_missing_stale_and_persistence(client, app):
    id = imported(client)
    values = client.get(f"/api/v1/research-runs/{id}/notes").json()
    assert values["total"] == 2
    first = values["items"][0]
    assert first["likes"] == 0 and first["saves"] is None
    assert client.get(f"/api/v1/research-runs/{id}/notes?q=第一").json()["total"] == 1
    assert (
        client.get(f"/api/v1/research-runs/{id}/notes?page_size=1&page=2").json()[
            "items"
        ][0]["title"]
        == "第二篇"
    )
    assert (
        client.patch(
            f"/api/v1/research-runs/{id}/notes/{first['id']}", json={"excluded": True}
        ).status_code
        == 200
    )
    report = client.get(f"/api/v1/research-runs/{id}/report").json()
    assert report["summary"]["valid_notes"] == 1 and report["analysis_stale"]
    assert Store(app.state.store.config).get(runs, id)["source"] == "import"
    exported = client.get(f"/api/v1/research-runs/{id}/notes/export?excluded=false")
    assert (
        len(exported.json()) == 1
        and "attachment" in exported.headers["content-disposition"]
    )
    assert (
        client.post(
            f"/api/v1/research-runs/{id}/topic-jobs",
            headers={"Idempotency-Key": "no-model"},
        ).status_code
        == 503
    )


def test_draft_versions_conflict(client, app):
    value = {
        "id": "draft1",
        "topic_id": "t1",
        "title": "标题",
        "body": "# 标题",
        "brief": "我的经历",
        "version": 1,
        "updated_at": now(),
    }
    with app.state.store.tx() as c:
        c.execute(insert(drafts).values(id="draft1", version=1, data=value))
        c.execute(insert(versions).values(draft_id="draft1", version=1, data=value))
    payload = {
        "base_version": 1,
        "title": "新标题",
        "body": "# 新标题",
        "brief": "实际经历",
    }
    response = client.post("/api/v1/drafts/draft1/versions", json=payload)
    assert response.status_code == 201 and response.json()["version"] == 2
    assert (
        client.post("/api/v1/drafts/draft1/versions", json=payload).status_code == 409
    )
    assert client.get("/api/v1/drafts/draft1/versions").json()["total"] == 2
    assert client.get("/api/v1/drafts/draft1/export?version=1").text == "# 标题"
    assert client.get("/api/v1/drafts/draft1/export").text == "# 新标题"


@pytest.mark.parametrize(
    "raw,value,precision",
    [
        ("1.2万", 12000, "approximate"),
        ("0", 0, "exact"),
        (None, None, "unknown"),
        ("", None, "unknown"),
        ("1,234", 1234, "exact"),
        ("10+", 10, "approximate"),
        (-1, None, "unknown"),
    ],
)
def test_metric(raw, value, precision):
    assert metric(raw) == (value, precision)


def detail(id="abc"):
    return {
        "data": {
            "note": {
                "noteId": id,
                "title": "如何写周报",
                "desc": "真实流程材料",
                "time": int(__import__("time").time() * 1000),
                "user": {"userId": "u1", "nickname": "作者"},
                "interactInfo": {"likedCount": "1.2万", "collectedCount": "0"},
            },
            "comments": {
                "list": [{"id": "c1", "content": "希望有步骤"}],
                "hasMore": True,
            },
        }
    }


def test_normalize_has_no_access_token():
    d = detail()
    d["data"]["note"]["xsecToken"] = "secret"
    n = normalize(d, "AI", 0)
    assert n["likes"] == 12000 and n["comments"] is None and n["comment_samples"] == []
    assert not n["comment_coverage"]["complete"] and "secret" not in json.dumps(n)


@pytest.mark.asyncio
async def test_worker_partial_resume_and_cancel(app, client):
    result = create(client).json()
    source = AsyncMock()
    source.search.return_value = {"feeds": [{"id": "abc", "xsecToken": "secret"}]}
    source.detail.return_value = detail()
    worker = Worker(app.state.store, source)
    assert await worker.run_one()
    job = app.state.store.job(result["job_id"])
    assert job["status"] == "partial"
    assert len(app.state.store.list(notes)) == 1
    assert (
        client.get("/api/v1/research-runs/" + result["research_run_id"]).json()[
            "status"
        ]
        == "partial"
    )
    second = create(client, "cancel").json()
    client.post("/api/v1/jobs/" + second["job_id"] + "/cancel")
    await worker.run_one()
    assert app.state.store.job(second["job_id"])["status"] == "cancelled"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("previous_progress", "expected_status"), [(85, "completed"), (50, "partial")]
)
async def test_worker_analysis_evidence_and_draft(
    tmp_path, previous_progress, expected_status
):
    config = Config(
        data_dir=tmp_path,
        model_name="test",
        model_api_key="test-key",
        _env_file=None,
        collection_delay=0,
    )
    app = create_app(config)
    client = TestClient(app)
    id = imported(client)
    store = app.state.store
    selected = store.list(notes, notes.c.run_id == id)
    with store.tx() as c:
        run = store.get(runs, id, c)
        run.update(status="partial", progress=previous_progress, error="上次任务失败")
        store.put(c, runs, id, run)
    ai = AsyncMock()
    ai.generate.return_value = (
        {
            "topics": [
                {
                    "title": "原创选题",
                    "angle": "个人材料切入",
                    "category": "经验",
                    "evidence_ids": [selected[0]["id"]],
                }
            ],
            "classifications": [
                {"note_id": n["id"], "topic": "AI 实践"} for n in selected
            ],
        },
        {"input_tokens": 20, "output_tokens": 30},
    )
    j = client.post(
        f"/api/v1/research-runs/{id}/topic-jobs", headers={"Idempotency-Key": "topics"}
    ).json()["job_id"]
    worker = Worker(store, intelligence=ai)
    await worker.run_one()
    assert store.job(j)["status"] == "completed", store.job(j)
    assert store.get(runs, id)["status"] == expected_status
    if expected_status == "completed":
        assert store.get(runs, id)["error"] is None
    else:
        assert store.get(runs, id)["error"] == "上次任务失败"
    t = store.list(topics)[0]
    ai.generate.return_value = (
        {"title": "草稿", "body": "# 草稿\n【待填写经历】"},
        {"input_tokens": 20, "output_tokens": 30},
    )
    r = client.post(
        f"/api/v1/topics/{t['id']}/draft-jobs",
        headers={"Idempotency-Key": "draft"},
        json={"brief": ""},
    )
    assert r.status_code == 202
    await worker.run_one()
    assert len(store.list(drafts)) == 1
    assert (
        client.get(f"/api/v1/research-runs/{id}/report").json()["groups"][0]["name"]
        == "AI 实践"
    )
    ai.generate.return_value = (
        {
            "topics": [
                {
                    "title": "坏引用",
                    "angle": "角度",
                    "category": "分类",
                    "evidence_ids": ["does-not-exist"],
                }
            ],
            "classifications": [{"note_id": n["id"], "topic": "AI"} for n in selected],
        },
        {},
    )
    j = client.post(
        f"/api/v1/research-runs/{id}/topic-jobs",
        headers={"Idempotency-Key": "bad-evidence"},
    ).json()["job_id"]
    await worker.run_one()
    assert store.job(j)["status"] == "failed" and len(store.list(topics)) == 1


@pytest.mark.asyncio
async def test_agentscope_actual_serialization(tmp_path, monkeypatch):
    import xhs_content_agent.intelligence as module

    original = module.OpenAIChatModel
    captured = []
    destinations = []

    async def handler(request):
        body = json.loads(request.content)
        captured.append(body)
        destinations.append((str(request.url), request.headers["authorization"]))
        return httpx.Response(
            200,
            json={
                "id": "chat-test",
                "object": "chat.completion",
                "created": 1,
                "model": "test",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": '{"title":"测试","body":"正文"}',
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 8,
                    "total_tokens": 18,
                },
            },
        )

    def model(**kwargs):
        kwargs["client_kwargs"] = {
            "http_client": httpx.AsyncClient(transport=httpx.MockTransport(handler)),
            "max_retries": 0,
        }
        return original(**kwargs)

    model.Parameters = original.Parameters
    monkeypatch.setattr(module, "OpenAIChatModel", model)
    config = Config(
        data_dir=tmp_path,
        model_name="test",
        model_api_key="fake",
        model_base_url="https://mock.invalid/v1",
        _env_file=None,
    )
    intelligence = Intelligence(config)
    result, usage = await intelligence.generate("系统要求", "素材", "test", 100)
    assert result["title"] == "测试" and usage["input_tokens"] == 10
    assert captured[0]["messages"][0]["role"] == "system"
    from xhs_content_agent.model_settings import ModelInput, save

    save(
        config,
        ModelInput(
            model="replacement",
            base_url="https://second.invalid/v1",
            api_key="new-fake",
        ),
    )
    await intelligence.generate("系统", "测试", "stale-job-model", 64)
    assert captured[-1]["model"] == "replacement"
    assert destinations[-1] == (
        "https://second.invalid/v1/chat/completions",
        "Bearer new-fake",
    )
    assert "enable_thinking" not in captured[-1]
    save(
        config,
        ModelInput(
            model="qwen3.7-flash-2026-07-15",
            base_url="https://test.maas.aliyuncs.com/compatible-mode/v1",
            api_key="fake-qwen",
        ),
    )
    await intelligence.generate("Return JSON", "test", "", 100)
    assert captured[-1]["enable_thinking"] is False
    assert captured[-1]["response_format"] == {"type": "json_object"}


@pytest.mark.asyncio
async def test_tool_allowlist(tmp_path):
    with pytest.raises(Problem, match="只读"):
        await MCPConnector(Config(data_dir=tmp_path, _env_file=None)).call(
            "publish_content", {}
        )


@pytest.mark.asyncio
async def test_budget_and_recovery(tmp_path):
    config = Config(
        data_dir=tmp_path, model_name="test", model_api_key="fake", _env_file=None
    )
    app = create_app(config)
    client = TestClient(app)
    run_id = imported(client)
    store = app.state.store
    settings = client.get("/api/v1/settings").json()
    settings["budget"] = 1000
    client.put("/api/v1/settings", json=settings)
    j = client.post(
        f"/api/v1/research-runs/{run_id}/topic-jobs",
        headers={"Idempotency-Key": "budget"},
    ).json()["job_id"]
    model = AsyncMock()
    worker = Worker(store, intelligence=model)
    await worker.run_one()
    assert store.job(j)["status"] == "failed"
    model.generate.assert_not_called()
    result = create(client, "recover").json()
    store.update_job(result["job_id"], "collecting", progress=15)
    worker.recover()
    assert store.job(result["job_id"])["status"] == "queued"
    store.update_job(result["job_id"], "analyzing")
    worker.recover()
    assert store.job(result["job_id"])["status"] == "failed"


def test_schema_error_contract(client):
    schema = client.get("/openapi.json").json()
    assert schema["paths"]["/api/v1/jobs/{id}"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]["$ref"].endswith("JobOut")
    assert schema["paths"]["/api/v1/settings"]["put"]["responses"]["422"]["content"][
        "application/json"
    ]["schema"]["$ref"].endswith("ErrorResponse")


def test_model_config_private_persistent_and_test(client, app, monkeypatch):
    config = app.state.store.config
    path = config.data_dir / "model-config.json"
    url = "/api/v1/model-config"
    assert client.get(url).json()["key_configured"] is False
    payload = {
        "model": "free-a",
        "base_url": "https://provider.invalid/v1",
        "api_key": "private-test-key",
    }
    result = client.put(url, json=payload)
    assert result.status_code == 200
    assert "private-test-key" not in result.text
    assert result.json()["key_configured"]
    assert path.stat().st_mode & 0o777 == 0o600
    payload.pop("api_key")
    payload["model"] = "free-b"
    assert client.put(url, json=payload).status_code == 200
    from xhs_content_agent.model_settings import resolve

    assert resolve(config).model_api_key.get_secret_value() == "private-test-key"
    with TestClient(create_app(config)) as reloaded:
        assert reloaded.get(url).json()["model"] == "free-b"
    payload["base_url"] = "https://another.invalid/v1"
    assert client.put(url, json=payload).status_code == 422
    assert client.get(url).json()["base_url"] == "https://provider.invalid/v1"
    payload.update(
        base_url="https://secret:password@bad.invalid/v1", api_key="private-test-key"
    )
    invalid = client.put(url, json=payload)
    assert (
        invalid.status_code == 422
        and "private-test-key" not in invalid.text
        and "password" not in invalid.text
    )
    fake = AsyncMock(return_value=({"ok": True}, {}))
    monkeypatch.setattr(Intelligence, "generate", fake)
    assert client.post(url + "/test").json()["status"] == "connected"
    fake.assert_awaited_once()
    fake.side_effect = Problem("MODEL_CALL_FAILED", "模型调用失败", 503)
    assert client.post(url + "/test").status_code == 503
    assert "private-test-key" not in client.get("/api/v1/settings").text


@pytest.mark.asyncio
async def test_invalid_json_preserves_provider_usage(client, app):
    from xhs_content_agent.schemas import AnalysisOutput

    j = create(client, "usage-on-invalid-json").json()["job_id"]
    ai = AsyncMock()
    ai.generate.side_effect = Problem(
        "MODEL_INVALID_OUTPUT",
        "JSON 错误",
        502,
        details={"usage": {"input_tokens": 321, "output_tokens": 99}},
    )
    worker = Worker(app.state.store, intelligence=ai)
    with pytest.raises(Problem, match="JSON 错误"):
        await worker.model_call(j, AnalysisOutput, {"notes": []})
    usage = app.state.store.job(j)["usage"]
    assert usage["input_tokens"] == 321 and usage["output_tokens"] == 99


@pytest.mark.parametrize("status", ["queued", "collecting", "cleaning", "analyzing"])
def test_delete_research_rejects_active_job(client, app, status):
    from xhs_content_agent.storage import jobs

    accepted = create(client).json()
    id, job = accepted["research_run_id"], accepted["job_id"]
    app.state.store.update_job(job, status)
    response = client.delete(f"/api/v1/research-runs/{id}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "JOB_ALREADY_RUNNING"
    assert app.state.store.get(runs, id)
    assert app.state.store.get(jobs, job)


def test_delete_research_cascades_and_preserves_other_research(client, app):
    from sqlalchemy import select
    from xhs_content_agent.storage import idem, jobs, snapshots

    store = app.state.store
    id = imported(client)
    other = create(client, key="keep").json()
    with store.tx() as c:
        c.execute(
            insert(topics).values(
                id="delete-topic", run_id=id, data={"id": "delete-topic"}
            )
        )
        for name, topic in [
            ("delete-draft", "delete-topic"),
            ("keep-draft", "other-topic"),
        ]:
            value = {"id": name, "topic_id": topic}
            c.execute(insert(drafts).values(id=name, version=2, data=value))
            for version in (1, 2):
                c.execute(
                    insert(versions).values(draft_id=name, version=version, data=value)
                )
        job = store.enqueue(c, id, "topics", {"settings": store.preference()})
    # 研究状态已完成，但其新分析任务仍在排队时也必须拦截。
    assert client.delete(f"/api/v1/research-runs/{id}").status_code == 409
    store.update_job(job, "failed")
    assert client.delete(f"/api/v1/research-runs/{id}").status_code == 204
    assert client.get(f"/api/v1/research-runs/{id}").status_code == 404
    assert client.delete(f"/api/v1/research-runs/{id}").status_code == 404
    for table in (notes, topics, jobs):
        assert not store.list(table, table.c.run_id == id)
    assert not store.list(snapshots)
    assert [d["id"] for d in store.list(drafts)] == ["keep-draft"]
    with store.engine.connect() as c:
        assert c.execute(select(versions.c.draft_id)).scalars().all() == [
            "keep-draft",
            "keep-draft",
        ]
        assert c.execute(select(idem.c.key)).scalars().all() == ["keep"]
    assert (
        client.get(f"/api/v1/research-runs/{other['research_run_id']}").status_code
        == 200
    )
    assert store.preference()
