/** r136: краткая тема из заголовка разбора («ОГЭ по информатике. Задание 1. Тема» → «Тема»). */
export function razborTopic(title: string, number?: number): string {
  const t = (title || "").trim();
  const m = t.match(/Задани[ея]\s*№?\s*\d+\s*(?:\([^)]*\))?\s*[.:—–-]?\s*(.*)$/i);
  const out = (m ? m[1] : t).trim().replace(/\.$/, "");
  if (!out) return number != null ? `Разбор задания №${number}` : t;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Ожидаемое число номеров в экзамене — для серых карточек «скоро». */
export const RAZBOR_TOTALS: Record<string, number> = { "oge/math": 25, "oge/inf": 16, "ege/math": 19, "ege/inf": 27 };
