/** Предметы с «короткими» ответами (часть 1) и критериями (часть 2). */
export function isMathLikeSubject(subject) {
  const s = String(subject || "").toLowerCase();
  return s === "math" || s === "math_base";
}

/**
 * Логическая часть экзамена для UI/проверки:
 * 1 — автопроверка кратких ответов,
 * 2 — учитель выбирает критерии / ставит баллы.
 *
 * API часто отдаёт `part` = PK модели Part (не «номер части» из названия).
 * Говорение / устная / part_id ≥ 3 → как часть 2.
 */
export function inferExamTaskPart(task, level, subject) {
  const title = String(task?.part_title || "").toLowerCase();
  if (/говорен|устн|speaking|oral/.test(title)) return 2;
  if (/часть\s*2\b/.test(title) || title.trim() === "2") return 2;
  if (/часть\s*1\b/.test(title) || title.trim() === "1") return 1;

  const p = Number(task?.part);
  if (p === 1) return 1;
  if (p === 2) return 2;
  if (Number.isFinite(p) && p >= 3) return 2;

  const n = Number(task?.number);
  const lv = String(level || "").toLowerCase();
  const sub = String(subject || "").toLowerCase();
  if (lv === "ege" && (sub === "eng" || sub === "eng_speaking")) return 2;
  if (lv === "oge" && isMathLikeSubject(sub)) return n <= 19 ? 1 : 2;
  if (lv === "ege" && isMathLikeSubject(sub)) return n <= 11 ? 1 : 2;
  if (lv === "oge" && sub === "inf") return n <= 15 ? 1 : 2;
  if (lv === "ege" && sub === "inf") return n <= 27 ? 1 : 2;
  if (lv === "ege" && sub === "chem") return n <= 28 ? 1 : 2;
  return n <= 19 ? 1 : 2;
}

/** Подпись секции / формата по part_title из банка (fallback — «Часть N»). */
export function formatExamPartLabel(partId, partTitle) {
  const title = String(partTitle || "").trim();
  if (title) return title;
  const n = Number(partId);
  if (Number.isFinite(n) && n > 0) return `Часть ${n}`;
  return "Часть";
}
