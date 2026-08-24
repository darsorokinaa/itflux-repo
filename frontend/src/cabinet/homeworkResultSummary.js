/** Единое форматирование summary результата ДЗ на карточках. */

export function roundResultPercent(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export function formatResultCounts(summary) {
  if (!summary || !summary.is_final) return "";
  const correct = summary.correct_count;
  const total = summary.total_count;
  if (correct == null || total == null || total <= 0) return "";
  return `${correct} из ${total}`;
}

export function formatResultPercent(summary) {
  if (!summary || !summary.is_final) return null;
  return roundResultPercent(summary.percentage);
}

export function formatResultLine(summary) {
  if (!summary || !summary.is_final) return "";
  const parts = [];
  const counts = formatResultCounts(summary);
  const pct = formatResultPercent(summary);
  if (counts) parts.push(counts);
  if (pct != null) parts.push(`${pct}%`);
  return parts.join(" · ");
}

export function formatAutoCheckLine(summary) {
  if (!summary || summary.is_final) return "";
  const correct = summary.auto_correct_count;
  const total = summary.auto_total_count;
  if (correct == null || total == null || total <= 0) return "";
  return `Автоматически: ${correct} / ${total}`;
}

export function commentPreview(text, maxLen = 140) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 1).trimEnd()}…`;
}

export function formatSubmittedAtLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `Сдано сегодня в ${time}`;
  }
  const day = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return `Сдано ${day} в ${time}`;
}
