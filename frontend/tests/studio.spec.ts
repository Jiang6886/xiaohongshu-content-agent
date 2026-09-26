import { test, expect } from "@playwright/test";
test("分析、证据、草稿保存、预览与导出", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/analysis");
  await expect(
    page.getByRole("heading", { name: "从观察里，拾起下一个灵感。" }),
  ).toBeVisible();
  await page.screenshot({
    path: "../docs/design/frontend-analysis.png",
    fullPage: true,
  });
  await page.getByText("样本明细", { exact: true }).click();
  await page.getByRole("textbox", { name: "搜索样本" }).fill("知识库");
  await expect(page.locator("tbody .title-button")).toHaveCount(2);
  await page.getByRole("button", { name: "知识库搭了很多" }).click();
  await expect(page.getByText("演示样本没有真实来源链接")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "排除样本" }).first().click();
  await expect(page.getByRole("button", { name: "恢复样本" })).toBeVisible();
  await page.getByRole("link", { name: "选题与草稿" }).click();
  await page.getByRole("button", { name: "选择写作" }).first().click();
  await page
    .getByLabel("你的经历与观点")
    .fill("我用一份任务清单整理了本周工作。");
  await page.getByRole("button", { name: "生成演示草稿" }).click();
  await page.getByRole("textbox", { name: "文章标题" }).fill("我的演示文章");
  await page.getByRole("button", { name: "保存版本" }).click();
  await expect(page.getByText("v2", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(768);
  await page.getByText("预览", { exact: true }).click();
  await expect(page.locator(".markdown-preview")).toContainText(
    "我用一份任务清单",
  );
  const file = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Markdown" }).click();
  const downloaded = await file;
  expect(downloaded.suggestedFilename()).toBe("我的演示文章.md");
  const stream = await downloaded.createReadStream();
  let text = "";
  for await (const chunk of stream!) text += chunk.toString();
  expect(text).toContain("# 我的演示文章");
  await page.reload();
  await page.getByRole("button", { name: "我的演示文章" }).click();
  await expect(page.getByRole("textbox", { name: "文章标题" })).toHaveValue(
    "我的演示文章",
  );
  expect(errors).toEqual([]);
});
test("新建、取消与完成研究", async ({ page }) => {
  await page.goto("/research");
  await page.getByRole("button", { name: "新建研究" }).click();
  await page.getByLabel("研究名称").fill("取消流程测试");
  await page.getByRole("button", { name: "开始模拟研究" }).click();
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建研究" }).click();
  await page.getByLabel("研究名称").fill("完成流程测试");
  await page.getByRole("button", { name: "开始模拟研究" }).click();
  await expect(
    page.locator(".run-card").first().getByText("已完成", { exact: true }),
  ).toBeVisible({ timeout: 18000 });
  await page
    .locator(".run-card")
    .first()
    .getByRole("button", { name: "查看结果" })
    .click();
  await expect(page.locator(".stat").first()).toContainText("12");
});
test("窄屏与设置持久化", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await page.getByLabel("作者定位").fill("我的创作定位");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("设置已保存")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("作者定位")).toHaveValue("我的创作定位");
  await page.getByRole("link", { name: "样本与分析" }).click();
  await expect(
    page.getByRole("heading", { name: "从观察里，拾起下一个灵感。" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/design/frontend-mobile.png",
    fullPage: true,
  });
});

test("少量采样不产生悬空证据，过期草稿版本不能覆盖", async ({ page }) => {
  await page.goto("/analysis");
  const result = await page.evaluate(async (modulePath) => {
    const { api } = await import(modulePath);
    const r = await api.create({
      name: "单条样本",
      keywords: ["AI"],
      audience: "初学者",
      days: 7,
      limit: 1,
    });
    const key = "xhs-studio-demo-v1";
    const local = JSON.parse(localStorage.getItem(key)!);
    local.runs.find((x: { id: string }) => x.id === r.id).created_at = new Date(
      Date.now() - 20000,
    ).toISOString();
    localStorage.setItem(key, JSON.stringify(local));
    const db = await api.load();
    const notes = db.notes.filter((n: { run_id: string }) => n.run_id === r.id);
    const topics = db.topics.filter(
      (t: { run_id: string }) => t.run_id === r.id,
    );
    const d = await api.generate(topics[0], "测试材料");
    await api.saveDraft({ ...d, title: "新的版本" });
    let rejected = false;
    try {
      await api.saveDraft({ ...d, title: "过期版本" });
    } catch {
      rejected = true;
    }
    return {
      notes: notes.length,
      valid: topics.every((t: { evidence_ids: string[] }) =>
        t.evidence_ids.every((id) =>
          notes.some((n: { id: string }) => n.id === id),
        ),
      ),
      rejected,
    };
  }, "/src/api.ts");
  expect(result).toEqual({ notes: 1, valid: true, rejected: true });
});

test("桌面主要视图一屏显示", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  for (const route of ["research", "analysis", "writing", "settings"]) {
    await page.goto("/" + route);
    await expect(page.locator(".heading")).toBeVisible();
    const sizes = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      width: document.documentElement.scrollWidth,
    }));
    expect(sizes.height, route).toBeLessThanOrEqual(768);
    expect(sizes.width, route).toBeLessThanOrEqual(1366);
  }
  await page.goto("/analysis");
  for (const tab of ["研究概览", "标题观察", "候选选题", "样本明细"]) {
    await page.getByTitle(tab, { exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
      tab,
    ).toBeLessThanOrEqual(768);
  }
});

test("候选选题分页保留完整角度与可追溯依据", async ({page}) => {
  await page.setViewportSize({width:1366,height:768});
  await page.goto('/analysis');
  await page.getByTitle('候选选题',{exact:true}).click();
  await expect(page.locator('.candidate-topics .topic-card')).toHaveCount(2);
  await page.locator('.topic-pagination .ant-pagination-next').click();
  await expect(page.locator('.candidate-topics .topic-card')).toHaveCount(1);
  await expect(page.locator('.candidate-topics .index')).toHaveText('03');
  await page.getByRole('button',{name:'查看详情',exact:true}).click();
  await expect(page.getByText('样本依据：',{exact:true})).toBeVisible();
  await page.locator('.ant-modal-body .ant-btn-link').first().click();
  await expect(page.getByText('样本与原始依据',{exact:true})).toBeVisible();
  await expect(page.getByText('演示样本没有真实来源链接')).toBeVisible();
});
