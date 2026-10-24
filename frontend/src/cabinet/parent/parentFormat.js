/** r112: единый формат дат в кабинете родителя: «24 окт.», «24 окт., 13:00»; другой год — «24 окт. 2025». */

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function datePart(d, now) {
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function formatParentDate(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return value ? String(value) : "—";
  return datePart(d, now);
}

export function formatParentDateTime(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return value ? String(value) : "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${datePart(d, now)}, ${hh}:${mm}`;
}

/** Текст статуса без повтора: если рядом уже стоит бейдж «Просрочено», статус «Просрочено» не дублируем. */
export function parentStatusText(item, { overdueShown = false } = {}) {
  const label = String(item?.status_label || item?.status || "").trim();
  if (!label) return "";
  if (overdueShown && /просроч|^overdue$/i.test(label)) return "";
  return label;
}
