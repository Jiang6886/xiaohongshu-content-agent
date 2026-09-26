// 时间展示工具：未知或无效日期明确标为未知，避免把缺失时间显示成当前时间。

export function displayDate(value: string | null | undefined) {
  if (!value) return "发布时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "发布时间未知"
    : date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
}
