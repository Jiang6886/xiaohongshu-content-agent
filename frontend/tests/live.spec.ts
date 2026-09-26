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
