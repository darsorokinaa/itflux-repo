const SUBJECTS_WITH_OR_ALTERNATIVES = ["math", "math_base", "chem", "history"];

const INF_TABLE_TASK_NUMBERS = [18, 20, 25, 26, 27];
const INF_TABLE_ROWS = 7;
const INF_TABLE_COLS = 2;

export function normalize(str) {
  return String(str ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * Серверная проверка ответа (эталон ученику в JSON не отдаётся).
 * @param {number|string} variantId
 * @param {{ taskId?: number|string, taskNumber?: number|string, answer: string, apiBase?: string }} opts
 * @returns {Promise<boolean>}
 */
export async function checkVariantAnswerOnServer(variantId, opts = {}) {
  const vid = Number(variantId);
  if (!Number.isFinite(vid) || vid <= 0) return false;
  const apiBase = String(opts.apiBase || "").replace(/\/$/, "");
  const url = `${apiBase}/api/variant/${encodeURIComponent(String(vid))}/check-answer/`;
  const body = {
    task_id: opts.taskId ?? null,
    task_number: opts.taskNumber != null ? String(opts.taskNumber) : "",
    answer: opts.answer ?? "",
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    if (typeof data?.correct === "boolean") return data.correct;
    if (typeof data?.is_correct === "boolean") return data.is_correct;
    return false;
  } catch {
    return false;
  }
}

export function getTextFromHtml(html) {
  if (!html || typeof html !== "string") return "";
  try {
    const withBreaks = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
    const div = document.createElement("div");
    div.innerHTML = withBreaks;
    return (div.textContent || div.innerText || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

/** Текст эталона для таблицы результатов (без HTML-таблиц, ломающих вёрстку). */
export function formatCorrectAnswerPlain(html) {
  return getTextFromHtml(html || "");
}

function tryNumericAnswerEqual(rawUserValue, correctAnswerHtml) {
  const correctText = getTextFromHtml(correctAnswerHtml || "");
  if (/\sили\s/i.test(correctText)) return null;
  const stripNum = (s) =>
    String(s ?? "")
      .normalize("NFC")
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
      .replace(/\u00a0/g, " ")
      .trim()
      .replace(/,/g, ".");
  const uStr = stripNum(rawUserValue);
  const cStr = stripNum(correctText);
  if (!uStr || !cStr) return null;
  const uNum = parseFloat(uStr);
  const cNum = parseFloat(cStr);
  if (!Number.isFinite(uNum) || !Number.isFinite(cNum)) return null;
  const plainNum = (x) =>
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/i.test(String(x).replace(/\s/g, ""));
  if (!plainNum(uStr) || !plainNum(cStr)) return null;
  const tol = 1e-9 * Math.max(1, Math.abs(cNum));
  return Math.abs(uNum - cNum) <= tol;
}

export function isUserAnswerCorrect(rawUserValue, correctAnswerHtml, subject) {
  const userNorm = normalize(rawUserValue);
  const correctText = getTextFromHtml(correctAnswerHtml || "");
  const correctNorm = normalize(correctText);
  const subj = String(subject || "").toLowerCase();

  if (
    SUBJECTS_WITH_OR_ALTERNATIVES.includes(subj) &&
    /\sили\s/i.test(correctText)
  ) {
    const alternatives = correctText
      .split(/\s+или\s+/i)
      .map((part) => normalize(part))
      .filter(Boolean);
    if (alternatives.length > 0) {
      return alternatives.includes(userNorm);
    }
  }

  const numEq = tryNumericAnswerEqual(rawUserValue, correctAnswerHtml);
  if (numEq !== null) return numEq;

  return userNorm === correctNorm;
}

export function isTableAnswerTask(subject, taskNumber) {
  return String(subject || "").toLowerCase() === "inf" && INF_TABLE_TASK_NUMBERS.includes(Number(taskNumber));
}

export function parseUserTableAnswer(raw, rows = INF_TABLE_ROWS, cols = INF_TABLE_COLS) {
  const lines = String(raw || "").split(/\r?\n/);
  const matrix = [];
  for (let r = 0; r < rows; r += 1) {
    const line = lines[r] || "";
    matrix.push(line.split(/\t/).slice(0, cols));
    while (matrix[r].length < cols) matrix[r].push("");
  }
  return matrix;
}

export function tableAnswerCheckString(raw, rows = INF_TABLE_ROWS, cols = INF_TABLE_COLS) {
  const matrix = parseUserTableAnswer(raw, rows, cols);
  return matrix.map((rowArr) => rowArr.join("\t")).join("\n");
}

export function parseCorrectTableAnswer(correctAnswerHtml, rows = INF_TABLE_ROWS, cols = INF_TABLE_COLS) {
  const text = getTextFromHtml(correctAnswerHtml || "");
  const lines = text.split(/\r?\n/);
  const matrix = [];
  for (let r = 0; r < rows; r += 1) {
    const line = lines[r] || "";
    matrix.push(line.split(/\t/).slice(0, cols).map((s) => s.trim()));
    while (matrix[r].length < cols) matrix[r].push("");
  }
  return matrix;
}

const INF_CELL_SPLIT_RE = /[\t ]+/;

function infRowTokens(line) {
  return String(line ?? "")
    .replace(/\u00a0/g, " ")
    .trim()
    .split(INF_CELL_SPLIT_RE)
    .map((cell) => normalize(cell))
    .filter(Boolean);
}

/** Строка ученика по позициям ячеек (таб). Одна ячейка «788 1284» — старый ввод, делим по пробелу. */
function infUserRow(line) {
  const cells = String(line ?? "").split("\t").map((cell) => cell.replace(/\u00a0/g, " ").trim());
  if (cells[0] && !cells.slice(1).some(Boolean) && INF_CELL_SPLIT_RE.test(cells[0])) {
    return infRowTokens(cells[0]);
  }
  const out = cells.map((cell) => normalize(cell));
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

export function parseInfUserRows(raw, rows = INF_TABLE_ROWS) {
  const lines = String(raw || "").split(/\r?\n/);
  const out = [];
  for (let r = 0; r < rows; r += 1) out.push(infUserRow(lines[r] || ""));
  return out;
}

/** Эталон: подряд идущие непустые строки до первой пустой (дальше «Справочно: …»). Ячейки — таб или пробел. */
export function parseInfExpectedRows(correctAnswerHtml) {
  const out = [];
  for (const line of getTextFromHtml(correctAnswerHtml || "").split(/\r?\n/)) {
    const tokens = infRowTokens(line);
    if (tokens.length) out.push(tokens);
    else if (out.length) break;
  }
  return out;
}

function infPairEqual(user, expected) {
  if (!expected || !expected.length) return false;
  if (user.length === expected.length && user.every((cell, i) => cell === expected[i])) return true;
  // Совместимость: раньше оба числа вводили в одну ячейку слитно.
  return user.length === 1 && expected.length > 1 && user[0] === expected.join("");
}

/** ФИПИ 2026/2027: 2 — оба числа на местах; 1 — перепутаны местами или одно верное число на своём месте. */
function infSinglePairScore(user, expected) {
  if (infPairEqual(user, expected)) return 2;
  if (expected.length !== 2 || user.length > 2) return 0;
  const [first, second] = expected;
  const u0 = user[0] ?? "";
  const u1 = user[1] ?? "";
  if (u0 === second && u1 === first) return 1;
  if (u0 === first || u1 === second) return 1;
  return 0;
}

/** Баллы 0/1/2 для ЕГЭ информатика №26 и №27. null — это не такое задание. */
export function scoreInformaticsTableTask(taskNumber, userRaw, correctHtml) {
  const num = Number(taskNumber);
  if (num !== 26 && num !== 27) return null;
  const user = parseInfUserRows(userRaw);
  const expected = parseInfExpectedRows(correctHtml || "");
  if (!expected.length) return 0;
  if (num === 26 || expected.length === 1) return infSinglePairScore(user[0], expected[0]);
  // №27 формата 2025–2026 (файлы A и B): две пары в двух строках.
  const firstOk = infPairEqual(user[0], expected[0]);
  const secondOk = infPairEqual(user[1], expected[1]);
  if (firstOk && secondOk) return 2;
  if (firstOk || secondOk) return 1;
  if (infPairEqual(user[0], expected[1]) && infPairEqual(user[1], expected[0])) return 1;
  return 0;
}

/**
 * Авто-проверка части 1: true/false или null если ответа нет.
 */
export function computePart1TaskCorrect(task, userAnswer, subject) {
  const answer = String(userAnswer ?? "").trim();
  if (!answer) return null;

  const subj = String(subject || "").toLowerCase();
  const num = Number(task?.number);

  if (isTableAnswerTask(subj, num)) {
    if (num === 26 || num === 27) {
      return (scoreInformaticsTableTask(num, answer, task?.answer || "") ?? 0) > 0;
    }
    const checkValue = tableAnswerCheckString(answer);
    return isUserAnswerCorrect(checkValue, task?.answer || "", subj);
  }

  return isUserAnswerCorrect(answer, task?.answer || "", subj);
}
