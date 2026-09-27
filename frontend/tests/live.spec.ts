import { test, expect } from "@playwright/test";
test("真实 HTTP 与 SQLite：空状态、导入、排除、设置和异步任务", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/research");
  await expect(page.getByText("LIVE · 本地服务")).toBeVisible();
  await expect(
    page.getByText("还没有研究。新建任务采集真实数据，或导入已有 JSON 素材。"),
  ).toBeVisible();
  const data = {
    research: {
      name: "集成测试素材",
      keywords: ["测试"],
      audience: "测试读者",
      limit: 2,
    },
    notes: [
      {
        platform_id: "fixture-a",
        title: "来自用户文件的素材",
        author: "测试作者",
        body: "只用于隔离数据库验证，不是真实平台内容",
        likes: 0,
        saves: null,
      },
      {
        platform_id: "fixture-b",
        title: "另一份素材",
        author: "测试作者",
        likes: 25,
      },
    ],
  };
  await page.getByLabel("导入 JSON 文件").setInputFiles({
    name: "samples.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator(".stat").first()).toContainText("2");
  await expect(page.getByText("用户导入", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(768);
  await page.getByText("样本明细", { exact: true }).click();
  await page.getByRole("button", { name: "来自用户文件的素材" }).click();
  await expect(page.getByText("此样本没有来源链接")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "排除样本" }).first().click();
  await expect(page.locator(".stat").first()).toContainText("1");
  await page.getByRole("link", { name: "设置", exact: false }).click();
  await page.getByRole("tab", { name: "作者与预算" }).click();
  await page.getByLabel("作者定位").fill("存入真实 SQLite 的设置");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("设置已保存")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "作者与预算" }).click();
  await expect(page.getByLabel("作者定位")).toHaveValue(
    "存入真实 SQLite 的设置",
  );

  await page.getByRole("link", { name: "研究任务" }).click();
  await page.getByRole("button", { name: "新建研究" }).click();
  await page.getByLabel("研究名称").fill("后台队列验证");
  await page.getByRole("button", { name: "开始研究", exact: true }).click();
  await expect(page.getByText("等待执行").first()).toBeVisible();
  const result = await request.get("/api/v1/research-runs");
  expect(result.ok()).toBe(true);
  const runs = (await result.json()).items;
  expect(runs.some((r: { name: string }) => r.name === "后台队列验证")).toBe(
    true,
  );
  const denied = await request.post(
    `/api/v1/research-runs/${runs.find((r: { source: string }) => r.source === "import").id}/topic-jobs`,
    { headers: { "Idempotency-Key": "test-no-model" } },
  );
  expect(denied.status()).toBe(503);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "../docs/design/backend-live-integration.png",
    fullPage: true,
  });
});

test("页面保存模型与密钥，切换模型即时持久化且不回显 Key", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/settings");
  await page
    .getByLabel("服务地址（Base URL）")
    .fill("https://test-provider.invalid/v1");
  await page.getByLabel("模型名称", { exact: true }).fill("free-model-a");
  await page.getByLabel("API Key", { exact: true }).fill("browser-test-secret");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await expect(
    page.getByText("模型配置已保存，后续调用立即生效"),
  ).toBeVisible();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("模型名称", { exact: true })).toHaveValue(
    "free-model-a",
  );
  await page.getByLabel("模型名称", { exact: true }).fill("free-model-b");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await expect(
    page.getByText("模型配置已保存，后续调用立即生效"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "测试已保存的模型" }),
  ).toBeEnabled();
  const result = await request.get("/api/v1/model-config");
  expect(await result.json()).toMatchObject({
    model: "free-model-b",
    key_configured: true,
  });
  expect(await result.text()).not.toContain("browser-test-secret");
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("browser-test-secret");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/design/settings-model.png",
    fullPage: true,
  });
});

test("失败且无样本的研究显示真实空状态，桌面不溢出", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const created = await request.post("/api/v1/research-runs", {
    headers: { "Idempotency-Key": "failed-empty-layout" },
    data: {
      name: "失败空状态验证",
      keywords: ["Skills"],
      audience: "测试",
      days: 30,
      limit: 6,
    },
  });
  const { research_run_id: id } = await created.json();
  await page.addInitScript(
    (id) => sessionStorage.setItem("xhs-active-run", id),
    id,
  );
  // Simulate a terminal worker response without starting real MCP/model calls.
  await page.route("**/api/v1/research-runs?*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.items = data.items.map((r: { id: string }) =>
      r.id === id
        ? {
            ...r,
            status: "failed",
            error: "小红书未登录，请先在本机 MCP 完成登录",
          }
        : r,
    );
    await route.fulfill({ response, json: data });
  });
  await page.goto("/analysis");
  await expect(
    page.getByText("本次研究失败。小红书未登录，请先在本机 MCP 完成登录"),
  ).toBeVisible();
  await expect(page.locator(".stat strong")).toHaveText(["0", "0", "0", "0"]);
  await expect(page.getByText("尚未形成研究观察。")).toBeVisible();
  for (const tab of ["研究概览", "标题观察", "候选选题", "样本明细"]) {
    await page.getByTitle(tab, { exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
      tab,
    ).toBeLessThanOrEqual(768);
  }
  await expect(page.getByText("暂无样本", { exact: true })).toBeVisible();
});

test("删除研究：保留、确认、末页回退与持久化", async ({ page, request }) => {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const response = await request.post("/api/v1/imports", {
      headers: { "Idempotency-Key": `delete-fixture-${i}` },
      data: {
        research: {
          name: `删除验收-${i}`,
          keywords: ["删除测试"],
          audience: "测试",
          limit: 1,
        },
        notes: [{ platform_id: `delete-${i}`, title: "临时素材" }],
      },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).research_run_id);
  }
  await page.goto("/research");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".run-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // 删除最新项，先验证关闭确认框不会发出删除操作。
  const card = page.locator(".run-card").filter({ hasText: "删除验收-2" });
  await card.getByRole("button", { name: "删除研究" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "关联草稿及全部历史版本",
  );
  await page.getByRole("button", { name: "保留研究" }).click();
  expect((await request.get(`/api/v1/research-runs/${ids[2]}`)).status()).toBe(
    200,
  );
  await card.getByRole("button", { name: "删除研究" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(card).toHaveCount(0);
  expect((await request.get(`/api/v1/research-runs/${ids[2]}`)).status()).toBe(
    404,
  );
  // 将最后一页逐项删空，验证页码能回退，避免误显示空列表。
  while (await page.locator(".run-card").count()) {
    const next = page.locator(
      ".run-pagination .ant-pagination-next:not(.ant-pagination-disabled)",
    );
    if (await next.count()) {
      await next.click();
      continue;
    }
    const button = page
      .locator(".run-card")
      .last()
      .getByRole("button", { name: "删除研究" });
    if (await button.isDisabled()) break;
    const count = (
      await request.get("/api/v1/research-runs?page_size=100")
    ).json();
    const before = (await count).total;
    await button.click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await (
              await request.get("/api/v1/research-runs?page_size=100")
            ).json()
          ).total,
      )
      .toBe(before - 1);
  }
  await page.reload();
  await expect(page.getByText("删除验收-2", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("新研究默认高互动，支持类型和门槛并持久化", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/research");
  await page.getByRole("button", { name: "新建研究" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("高互动筛选（爆款候选）");
  await page.getByLabel("研究名称", { exact: true }).fill("高互动配置验收");
  await page.getByText("高互动门槛与排序（可调整）", { exact: true }).click();
  await page.getByLabel("最低点赞", { exact: true }).fill("2000");
  await page.getByLabel("最低收藏", { exact: true }).fill("500");
  await page.getByLabel("最低评论", { exact: true }).fill("200");
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/research-runs") &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "开始研究", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  const { research_run_id: id } = await response.json();
  const data = await (await request.get(`/api/v1/research-runs/${id}`)).json();
  expect(data.strategy).toBe("engagement");
  expect(data.content_type).toBe("all");
  expect([data.min_likes, data.min_saves, data.min_comments]).toEqual([
    2000, 500, 200,
  ]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "样本与分析" }).click();
  await page.getByText("共性爆点", { exact: true }).click();
  await expect(
    page.getByText("尚无跨样本共性。生成分析后查看；材料不足时不会编造共性。"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("共性结果区分观察与假设并能追溯样本", async ({ page, request }) => {
  const imported = await request.post("/api/v1/imports", {
    headers: { "Idempotency-Key": "pattern-ui" },
    data: {
      research: {
        name: "共性界面验收",
        keywords: ["测试"],
        audience: "测试",
        limit: 2,
      },
      notes: [
        { platform_id: "pattern-a", title: "证据标题甲" },
        { platform_id: "pattern-b", title: "证据标题乙" },
      ],
    },
  });
  const id = (await imported.json()).research_run_id;
  const notes = (
    await (await request.get(`/api/v1/research-runs/${id}/notes`)).json()
  ).items;
  // 只模拟模型分析结果；研究与证据仍来自隔离后端，避免真实模型费用。
  await page.route(`**/api/v1/research-runs/${id}/report`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.patterns = [
      {
        observation: "共同使用具体场景",
        hypothesis: "可能降低理解成本",
        experiment: "对照两种原创标题",
        evidence_ids: notes.map((n: { id: string }) => n.id),
      },
    ];
    await route.fulfill({ response, json: body });
  });
  await page.addInitScript(
    (id) => sessionStorage.setItem("xhs-active-run", id),
    id,
  );
  await page.goto("/analysis");
  await page.getByText("共性爆点", { exact: true }).click();
  await page.getByRole("button", { name: "查看依据与实验" }).click();
  await expect(page.getByRole("dialog")).toContainText("可能原因（待验证）");
  await expect(page.getByRole("dialog")).toContainText("对照两种原创标题");
  await page.getByRole("button", { name: "证据标题甲", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "证据标题甲", exact: true }),
  ).toBeVisible();
});

test("顶部任务入口固定在布局内，研究 token 汇总保留未知用量", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/v1/imports", {
    headers: { "Idempotency-Key": "usage-ui" },
    data: {
      research: {
        name: "Token 统计验收",
        keywords: ["测试"],
        audience: "测试",
        limit: 1,
      },
      notes: [{ platform_id: "usage-a", title: "用量测试素材" }],
    },
  });
  const id = (await response.json()).research_run_id;
  const make = (
    key: string,
    kind: string,
    input: number | null,
    output: number | null,
    reserved = 20000,
  ) => ({
    id: key,
    kind,
    research_run_id: id,
    status: "completed",
    progress: 100,
    cancel_requested: false,
    error: null,
    result_id: null,
    created_at: "2026-09-28T10:00:00Z",
    usage: {
      reserved_tokens: reserved,
      input_tokens: input,
      output_tokens: output,
      tool_calls: 1,
    },
  });
  let jobs: object[] = [
    make("research", "research", 100, 40),
    make("retry", "topics", 20, 10),
    make("draft", "draft", 30, 15),
    { ...make("partial", "topics", 8, null), status: "failed" },
    make("unused", "research", null, null, 0),
    { ...make("legacy", "topics", null, null), usage: undefined },
    { ...make("unrelated", "draft", 9999, 9999), research_run_id: "other" },
  ];
  await page.route("**/api/v1/jobs?*", (route) =>
    route.fulfill({
      json: { items: jobs, total: jobs.length, page: 1, page_size: 100 },
    }),
  );
  await page.goto("/research");
  const card = page.locator(".run-card").filter({ hasText: "Token 统计验收" });
  await expect(
    card.getByRole("button", { name: "Token：已记录 223 · 2 项用量待确认" }),
  ).toBeVisible();
  await card.getByRole("button", { name: /Token：/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("输入 158 / 输出 65");
  await expect(dialog).toContainText("输入 8 / 输出 待确认");
  await expect(dialog).toContainText("0 tokens · 未记录到模型调用");
  await page.keyboard.press("Escape");
  const button = page.locator(".topbar .jobs-button");
  await expect(button).toBeVisible();
  expect(await button.evaluate((e) => getComputedStyle(e).position)).not.toBe(
    "fixed",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  jobs = [];
  await page.reload();
  await expect(page.locator(".topbar .jobs-button")).toHaveText("后台任务 · 0");
  await expect(
    card.getByRole("button", { name: "Token：0（输入 0 / 输出 0）" }),
  ).toBeVisible();
  await page.locator(".topbar .jobs-button").click();
  await expect(page.getByText("暂无进行中或需要处理的任务")).toBeVisible();
});
