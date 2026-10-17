/**
 * Официальные правила оценивания кратких ответов (спецификации ФИПИ 2026).
 * Зеркало SHORT_ANSWER_RULES в Generator/variant_scoring.py.
 *  pos1      — 2 балла; 1 балл при ошибке ровно в одной позиции; лишние символы — 0
 *              (ОГЭ физика №1, 2, 4, 12, 13)
 *  set1      — 2 балла, порядок не важен; 1 балл, если один символ неверен или один
 *              отсутствует; лишние символы — 0 (ОГЭ физика №14, 16)
 *  posdec    — максимум минус 1 за каждую неверную позицию; лишние символы — 0
 *              (ЕГЭ английский №1, 11 — 2 балла; №2, 10 — 3 балла)
 *  unordered — порядок символов не важен (ОГЭ русский №2, 3, 5–7, 10, 11)
 * Применяется только к эталонам из одних цифр.
 */
import { getTextFromHtml, normalize } from "./examAnswerCheck";

const RULES = {
  "oge/phys": { 1: "pos1", 2: "pos1", 4: "pos1", 12: "pos1", 13: "pos1", 14: "set1", 16: "set1" },
  "ege/eng_write": { 1: "posdec", 2: "posdec", 10: "posdec", 11: "posdec" },
  "oge/rus": { 2: "unordered", 3: "unordered", 5: "unordered", 6: "unordered", 7: "unordered", 10: "unordered", 11: "unordered" },
};

export function shortAnswerRule(task, level, subject) {
  const key = `${String(level || "").trim().toLowerCase()}/${String(subject || "").trim().toLowerCase()}`;
  const rules = RULES[key];
  if (!rules) return null;
  const n = Number(task?.number);
  if (!Number.isInteger(n)) return null;
  return rules[n] || null;
}

function countChars(str) {
  const map = new Map();
  for (const ch of str) map.set(ch, (map.get(ch) || 0) + 1);
  return map;
}

function htmlToPlain(value) {
  const raw = String(value ?? "");
  if (!/[<&]/.test(raw)) return raw;
  try {
    return getTextFromHtml(raw);
  } catch {
    return raw.replace(/<[^>]*>/g, "");
  }
}

/** Балл по правилу или null, если правило к эталону неприменимо. */
export function scoreShortAnswerRule(rule, userRaw, expectedHtml, maxPoints) {
  const expected = normalize(htmlToPlain(expectedHtml));
  if (!rule || !expected || !/^\d+$/.test(expected)) return null;
  const user = normalize(htmlToPlain(userRaw));
  const max = Number(maxPoints) || 0;
  if (!user) return 0;
  if (rule === "unordered") {
    return [...user].sort().join("") === [...expected].sort().join("") ? max : 0;
  }
  if (user.length > expected.length) return 0;
  if (rule === "pos1" || rule === "posdec") {
    let wrong = 0;
    for (let i = 0; i < expected.length; i += 1) {
      if (i >= user.length || user[i] !== expected[i]) wrong += 1;
    }
    if (wrong === 0) return max;
    if (rule === "pos1") return wrong === 1 && max >= 2 ? 1 : 0;
    return Math.max(0, max - wrong);
  }
  if (rule === "set1") {
    const cu = countChars(user);
    const ce = countChars(expected);
    let missing = 0;
    let extra = 0;
    for (const [ch, n] of ce) missing += Math.max(0, n - (cu.get(ch) || 0));
    for (const [ch, n] of cu) extra += Math.max(0, n - (ce.get(ch) || 0));
    if (missing === 0 && extra === 0) return max;
    if (missing === 1 && extra <= 1 && max >= 2) return 1;
    return 0;
  }
  return null;
}
