# 研究报表：用已保存的有效样本计算数量，用选题结果提供观察与证据。
# 统计描述本次采样范围，不代表小红书全站热度或点击率。

from collections import Counter

from .storage import notes, runs, topics


# 排除无效样本后确定性计算统计；模型观察单独附带证据与过期标记。
def report(store, run_id):
    run = store.get(runs, run_id)
    data = [n for n in store.list(notes, notes.c.run_id == run_id) if not n["excluded"]]
    candidates = store.list(topics, topics.c.run_id == run_id)
    groups = Counter(n["topic"] for n in data)
    return {
        "run_id": run_id,
        "summary": {
            "valid_notes": len(data),
            "distinct_authors": len(
                {
                    n.get("author_id") or n["author"]
                    for n in data
                    if n["author"] != "未知作者"
                }
            ),
            "topic_groups": len(groups),
            "candidate_topics": len(candidates),
        },
        "groups": [{"name": k, "count": v} for k, v in groups.most_common()],
        "observations": [
            {
                "kind": "suggestion",
                "text": t["angle"],
                "evidence_ids": t["evidence_ids"],
                "stale": run.get("analysis_stale", False),
            }
            for t in candidates
        ],
        "scope": "仅反映本次采样；未知发布时间保留并注明，模型输入可能因预算截断。未分类样本不等于已完成主题分析。",
        "generated_at": run["created_at"],
        "analysis_stale": run.get("analysis_stale", False),
        "analysis_note": run.get("analysis_note", "尚未进行模型分析"),
        "analysis_coverage": run.get("analysis_coverage", []),
        "patterns": run.get("patterns", []),
        "collection_summary": run.get("collection_summary", {}),
    }
