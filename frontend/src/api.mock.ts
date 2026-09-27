// 独立演示数据源：使用 localStorage 模拟研究、选题和草稿操作。
// 本文件中的笔记与生成内容均为虚构；不会写入真实后端数据库。

import type { Database, Research, Note, Topic, Draft, Settings } from "./types";
const KEY = "xhs-studio-demo-v1";
const titles = [
  "我把每周两小时的周报，拆成了这 3 步",
  "知识库搭了很多，为什么还是找不到资料？",
  "给 AI 的不是一句话，而是一份工作说明",
  "试了 5 个工具，最后只留下这两个",
  "不再囤教程：我的一周 AI 学习记录",
  "从零搭个人知识库，先想清楚这件事",
  "会议纪要怎么整理，才真的有人看",
  "普通人的 AI 入门清单：从一个小任务开始",
  "收藏了 100 篇笔记之后，我做了一次整理",
  "AI 写作的最后一步，还是自己的判断",
  "我的轻量笔记系统：只留三个文件夹",
  "效率工具越多，真的越有效率吗？",
];
const groups = ["AI 办公", "知识管理", "提示词实践", "工具实测"];
// 构造可重复的虚构样本与默认设置，供独立演示模式使用。
export function seed(): Database {
  return {
    runs: [
      {
        id: "r-demo",
        name: "AI 与个人效率：寻找真实的使用场景",
        keywords: ["AI 办公", "个人知识库", "效率工具"],
        audience: "希望用 AI 改善日常工作的初学者",
        days: 7,
        limit: 20,
        created_at: "2026-09-24T01:30:00Z",
        status: "completed",
        progress: 100,
      },
    ],
    notes: titles.map((title, i) => ({
      id: `n-${i + 1}`,
      run_id: "r-demo",
      title,
      author: [
        "木木的工作笔记",
        "一颗慢慢生长的树",
        "周末实验室",
        "小林在学习",
      ][i % 4],
      topic: groups[i % 4],
      format: i % 3 === 0 ? "经验分享" : "教程清单",
      likes: [1320, 864, 720, 652, 540, 480, 392, 320, 248, 186, 124, 86][i],
      saves:
        i === 11
          ? null
          : [986, 1204, 612, 510, 430, 650, 320, 288, 312, 142, 160][i],
      comments: 18 + i * 7,
      published_at: `2026-09-${String(23 - (i % 6)).padStart(2, "0")}`,
      body: `${title}\n\n这是一条用于界面演示的虚构笔记。它讨论了具体使用场景、实践步骤，以及如何判断工具是否真正节省时间。\n\n评论样例：“能不能分享更适合新手的操作步骤？”\n\n正文与互动数均为模拟数据，不对应真实小红书用户。`,
      excluded: false,
      source_url: null,
    })),
    topics: [
      {
        id: "t-1",
        run_id: "r-demo",
        title: "让 AI 帮你写周报，先整理这三类材料",
        angle: "从真实工作任务出发，展示输入材料与人工修改过程。",
        category: "场景切入",
        evidence_ids: ["n-1", "n-7", "n-3"],
        status: "candidate",
      },
      {
        id: "t-2",
        run_id: "r-demo",
        title: "知识库不是收藏夹：从找回一条信息开始",
        angle: "用一次查找任务比较整理前后的体验，而不是罗列工具。",
        category: "需求观察",
        evidence_ids: ["n-2", "n-6", "n-11"],
        status: "candidate",
      },
      {
        id: "t-3",
        run_id: "r-demo",
        title: "少装一个工具，多完成一个小任务",
        angle: "分享自己的取舍标准，给初学者一份可执行的实践清单。",
        category: "经验分享",
        evidence_ids: ["n-4", "n-8", "n-12"],
        status: "saved",
      },
    ],
    drafts: [],
    settings: {
      model: "演示模型 · 不调用 API",
      budget: 20000,
      comment_limit: 20,
      author: "记录 AI 与个人效率实践的学习者",
      voice: "自然、具体、有自己的判断",
    },
  };
}
// 首次访问创建种子数据；已有数据损坏时抛错，避免静默覆盖用户演示编辑。
function read(): Database {
  const raw = localStorage.getItem(KEY);
  if (!raw) return seed();
  try {
    const d = JSON.parse(raw);
    if (!Array.isArray(d.runs) || !Array.isArray(d.notes) || !d.settings)
      throw Error();
    return d;
  } catch {
    throw new Error("本地演示数据无法读取，请到设置页重置演示数据。");
  }
}
// 仅持久化到演示专用存储键，与真实数据完全分开。
function write(d: Database) {
  localStorage.setItem(KEY, JSON.stringify(d));
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 200));
export const api = {
  // 用经过时间模拟任务进度，并在完成时生成关联到该研究的虚构样本。
  async load() {
    await wait();
    const d = read();
    let changed = false;
    d.runs.forEach((r) => {
      if (["collecting", "analyzing"].includes(r.status)) {
        r.progress = Math.min(
          100,
          Math.floor((Date.now() - Date.parse(r.created_at)) / 120),
        );
        r.status =
          r.progress >= 100
            ? "completed"
            : r.progress > 45
              ? "analyzing"
              : "collecting";
        changed = true;
        if (
          r.status === "completed" &&
          !d.notes.some((n) => n.run_id === r.id)
        ) {
          const source = seed();
          d.notes.push(
            ...source.notes
              .slice(0, Math.min(r.limit, 12))
              .map((n) => ({ ...n, id: `${r.id}-${n.id}`, run_id: r.id })),
          );
          d.topics.push(
            ...source.topics
              .map((t) => ({
                ...t,
                id: `${r.id}-${t.id}`,
                run_id: r.id,
                evidence_ids: t.evidence_ids
                  .map((id) => `${r.id}-${id}`)
                  .filter((id) => d.notes.some((n) => n.id === id)),
              }))
              .filter((t) => t.evidence_ids.length > 0),
          );
        }
      }
    });
    if (changed) write(d);
    return d;
  },
  async create(
    input: Omit<Research, "id" | "status" | "progress" | "created_at">,
  ) {
    await wait();
    const d = read();
    const r: Research = {
      ...input,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      status: "collecting",
      progress: 0,
    };
    d.runs.unshift(r);
    write(d);
    return r;
  },
  // 演示模式同样级联移除关联数据，保持与真实接口一致的页面行为。
  async deleteResearch(id: string) {
    const d = read();
    const run = d.runs.find((r) => r.id === id);
    if (!run) throw Error("研究不存在");
    if (["queued", "collecting", "cleaning", "analyzing"].includes(run.status))
      throw Error("请先取消任务并等待停止后再删除");
    const topicIds = new Set(d.topics.filter((t) => t.run_id === id).map((t) => t.id));
    d.drafts = d.drafts.filter((x) => !topicIds.has(x.topic_id));
    d.topics = d.topics.filter((x) => x.run_id !== id);
    d.notes = d.notes.filter((x) => x.run_id !== id);
    d.runs = d.runs.filter((x) => x.id !== id);
    d.jobs = d.jobs?.filter((x) => x.research_run_id !== id);
    if (d.reports) delete d.reports[id];
    write(d);
  },
  async cancel(id: string) {
    await wait();
    const d = read();
    const r = d.runs.find((r) => r.id === id);
    if (r && ["collecting", "analyzing"].includes(r.status))
      r.status = "cancelled";
    write(d);
  },
  async exclude(id: string, excluded: boolean) {
    const d = read();
    const n = d.notes.find((n) => n.id === id);
    if (n) n.excluded = excluded;
    write(d);
  },
  async saveTopic(id: string) {
    const d = read();
    const t = d.topics.find((t) => t.id === id);
    if (t) t.status = t.status === "saved" ? "candidate" : "saved";
    write(d);
  },
  // 演示草稿由固定模板生成，不调用模型。
  async generate(topic: Topic, brief: string) {
    await wait();
    const d = read();
    const draft: Draft = {
      id: crypto.randomUUID(),
      topic_id: topic.id,
      title: topic.title,
      brief,
      version: 1,
      updated_at: new Date().toISOString(),
      body: `# ${topic.title}\n\n> 演示草稿 · 请补充实际经历并核实后使用\n\n## 为什么想聊这个问题\n\n${topic.angle}\n\n## 我的材料与观点\n\n${brief || "【待填写：你遇到的具体问题、实际操作与个人观点】"}\n\n## 可以尝试的三个步骤\n\n1. 选一个小而具体的任务，记录当前的做法。\n2. 整理输入材料，再用工具辅助处理。\n3. 人工检查结果，记录有用与需要改进的部分。\n\n## 最后的一点思考\n\n【待填写：自己的判断，不编造实际效果和节省时间】\n\n---\n研究依据：${topic.evidence_ids.join("、")}（模拟样本，仅供演示）`,
    };
    d.drafts.unshift(draft);
    write(d);
    return draft;
  },
  // 模拟版本冲突检查与版本递增；演示存储只保留当前草稿。
  async saveDraft(draft: Draft) {
    await wait();
    const d = read();
    const current = d.drafts.find((x) => x.id === draft.id);
    if (!current) throw Error("草稿不存在");
    if (current.version !== draft.version)
      throw Error("草稿已在其他窗口更新，请重新选择草稿后再编辑。");
    const next = {
      ...draft,
      version: draft.version + 1,
      updated_at: new Date().toISOString(),
    };
    d.drafts = d.drafts.map((x) => (x.id === draft.id ? next : x));
    write(d);
    return next;
  },
  async settings(settings: Settings) {
    await wait();
    const d = read();
    d.settings = settings;
    write(d);
  },
  async reset() {
    write(seed());
  },
};
// 把文本转换成 Blob 触发下载，随后释放临时 URL；真实模式也复用此工具。
export function download(
  name: string,
  text: string,
  type = "text/markdown;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
