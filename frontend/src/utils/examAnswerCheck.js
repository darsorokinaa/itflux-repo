const SUBJECTS_WITH_OR_ALTERNATIVES = ["math", "math_base", "chem", "history"];

const INF_TABLE_TASK_NUMBERS = [18, 20, 25, 26, 27];
const INF_TABLE_ROWS = 7;
const INF_TABLE_COLS = 2;

export function normalize(str) {
  return String(str ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function getTextFromHtml(html) {
  if (!html || typeof html !== "string") return "";
  try {
    const div = document.createElement("div");
    div.innerHTML = html;
    return (div.textContent || div.innerText || "").trim();
  } catch {
    return String(html).replace(/<[^>]+>/g, "");
  }
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

function getInfTask26Score(userMatrix, correctMatrix) {
  const u = (userMatrix[0] || []).map((c) => normalize(c));
  const c = (correctMatrix[0] || []).map((cell) => normalize(cell));
  let match = 0;
  if (u[0] === c[0]) match += 1;
  if (u[1] === c[1]) match += 1;
  return match === 2 ? 2 : match === 1 ? 1 : 0;
}

function getInfTask27Score(userMatrix, correctMatrix) {
  const rowMatch = (r) => {
    const u = (userMatrix[r] || []).map((cell) => normalize(cell));
    const c = (correctMatrix[r] || []).map((cell) => normalize(cell));
    return u[0] === c[0] && u[1] === c[1];
  };
  const r0 = rowMatch(0);
  const r1 = rowMatch(1);
  if (r0 && r1) return 2;
  if (r0 || r1) return 1;
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
    const userMatrix = parseUserTableAnswer(answer);
    const correctMatrix = parseCorrectTableAnswer(task?.answer || "");
    if (num === 26) {
      return getInfTask26Score(userMatrix, correctMatrix) > 0;
    }
    if (num === 27) {
      return getInfTask27Score(userMatrix, correctMatrix) > 0;
    }
    const checkValue = tableAnswerCheckString(answer);
    return isUserAnswerCorrect(checkValue, task?.answer || "", subj);
  }

  return isUserAnswerCorrect(answer, task?.answer || "", subj);
}
