# 高互动筛选的确定性规则：搜索排名用于候选分配，详情指标用于最终筛选。
# 该分数仅供候选池内排序，不表示点击率、涨粉率或全站爆款等级。
import math
from datetime import datetime


def eligible(note, run, cutoff):
    published = note.get("published_at")
    # 高互动模式必须能确认研究时间范围，未知发布时间不能冒充近期爆文。
    if not published or datetime.fromisoformat(published) < cutoff:
        return False
    expected = {"image": "图文", "video": "视频"}.get(run.get("content_type"))
    if expected and note["format"] != expected:
        return False
    thresholds = {
        k: run.get("min_" + k, v)
        for k, v in (("likes", 1000), ("saves", 300), ("comments", 100))
    }
    enabled = {k: v for k, v in thresholds.items() if v > 0}
    if not enabled:
        return any((note.get(k) or 0) > 0 for k in thresholds)
    # 任一开启的门槛达标即可；零表示关闭该项，未知值不能通过门槛。
    return any(note.get(k) is not None and note[k] >= v for k, v in enabled.items())


def score(note, rank_by):
    if rank_by in {"likes", "saves", "comments"}:
        return note.get(rank_by) if note.get(rank_by) is not None else -1
    return sum(math.log1p(note.get(k) or 0) for k in ("likes", "saves", "comments"))


def round_robin(groups):
    # 各关键词/排序按名次轮流提供候选，防止首个关键词独占详情调用预算。
    seen = set()
    for rank in range(max((len(g) for g in groups), default=0)):
        for group in groups:
            if rank < len(group):
                item = group[rank]
                if item["feed"]["id"] not in seen:
                    seen.add(item["feed"]["id"])
                    yield item
