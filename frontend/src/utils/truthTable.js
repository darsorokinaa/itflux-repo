/**
 * Генерация строк таблицы истинности.
 * Первая переменная меняется медленнее всех (старший бит), последняя — быстрее всех.
 * @param {string[]} variables — порядок столбцов переменных
 * @returns {number[][]} строки из 0|1
 */
export function generateCombinations(variables) {
  const n = variables.length;
  if (n === 0) return [[]];
  const total = 1 << n;
  const rows = [];
  for (let i = 0; i < total; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      row.push((i >> (n - 1 - j)) & 1);
    }
    rows.push(row);
  }
  return rows;
}

/** Только латинские A–Z, уникальные, по алфавиту */
export function extractVariables(expression) {
  if (!expression || typeof expression !== "string") return [];
  const set = new Set();
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (ch >= "A" && ch <= "Z") set.add(ch);
  }
  return [...set].sort();
}

/** Оставить в строке только 0 и 1; при maxLen обрезать справа */
export function sanitizeBinaryAnswer(str, maxLen) {
  const only = String(str ?? "").replace(/[^01]/g, "");
  return maxLen != null ? only.slice(0, maxLen) : only;
}

/** Одна позиция: '' | '0' | '1' */
export function sanitizeBinaryChar(ch) {
  const s = String(ch ?? "").slice(-1);
  if (s === "0" || s === "1") return s;
  return "";
}

/**
 * Раскладывает ответ по строкам последнего столбца (только 0/1 подряд, без пробелов).
 * @returns {string[]} длина numRows
 */
export function splitAnswerToRows(value, numRows) {
  const digits = sanitizeBinaryAnswer(value, null);
  const out = Array.from({ length: numRows }, (_, i) => (i < digits.length ? digits[i] : ""));
  return out;
}

/** Оставить только 0, 1 и одиночные пробелы между группами */
export function sanitizeTruthTableAnswerString(str) {
  return String(str ?? "")
    .replace(/[^01\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Сетка вычислимых столбцов → ответ вида «01 00 01 00» (каждая группа — строка таблицы).
 * @param {string[][]} grid [row][col] в '' | '0' | '1'
 */
export function formatTruthTableAnswerFromGrid(grid) {
  return grid
    .map((row) => row.map((c) => (c === "0" || c === "1" ? c : "")).join(""))
    .join(" ");
}

/**
 * Разбор ответа в сетку. Поддержка:
 * — «01 00 01 00» (группы по строкам);
 * — слитно длины numRows*numComputed (построчно по столбцам);
 * — слитно длины numRows при нескольких столбцах — только последний столбец (старый режим).
 */
export function parseTruthTableAnswerToGrid(value, numRows, numComputed) {
  const empty = () =>
    Array.from({ length: numRows }, () => Array.from({ length: numComputed }, () => ""));
  if (numRows === 0 || numComputed === 0) return empty();

  const cleaned = sanitizeTruthTableAnswerString(value);
  if (!cleaned) return empty();

  const groups = cleaned.split(" ").filter((g) => g.length > 0);
  const onlyDigits = cleaned.replace(/\s/g, "");

  if (groups.length === 1) {
    const s = onlyDigits;
    if (s.length === numRows * numComputed) {
      return Array.from({ length: numRows }, (_, r) =>
        Array.from({ length: numComputed }, (_, c) => {
          const ch = s[r * numComputed + c];
          return ch === "0" || ch === "1" ? ch : "";
        })
      );
    }
    if (s.length === numRows && numComputed > 1) {
      return Array.from({ length: numRows }, (_, r) => {
        const row = Array(numComputed).fill("");
        const ch = s[r];
        row[numComputed - 1] = ch === "0" || ch === "1" ? ch : "";
        return row;
      });
    }
  }

  return Array.from({ length: numRows }, (_, r) => {
    const g = (groups[r] || "").replace(/[^01]/g, "");
    return Array.from({ length: numComputed }, (_, c) => {
      const ch = g[c];
      return ch === "0" || ch === "1" ? ch : "";
    });
  });
}

/** Число вычислимых столбцов по конфигу */
export function truthTableNumComputedColumns(config) {
  if (!config || typeof config !== "object") return 0;
  if (Array.isArray(config.steps) && config.steps.length > 0) return config.steps.length;
  return config.expression ? 1 : 0;
}

/** Макс. длина строки ответа (с пробелами между строками таблицы) */
export function truthTableAnswerMaxChars(config) {
  const n = truthTableNumRows(config);
  const k = truthTableNumComputedColumns(config);
  if (n === 0 || k === 0) return 0;
  return n * k + Math.max(0, n - 1);
}

/** Для vanilla: data-steps с разделителем | */
export function parseSteps(stepsString, expression) {
  if (stepsString == null || String(stepsString).trim() === "") {
    return expression ? [expression] : [];
  }
  return String(stepsString)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Число строк 2^n по конфигу (для обрезки ответа в поле ввода).
 * @param {{ variables?: string[]; expression?: string }} config
 */
export function truthTableNumRows(config) {
  if (!config || typeof config !== "object") return 0;
  const vars =
    Array.isArray(config.variables) && config.variables.length > 0
      ? config.variables.map((v) => String(v).trim()).filter(Boolean)
      : extractVariables(String(config.expression || ""));
  return vars.length === 0 ? 0 : 1 << vars.length;
}

/**
 * @param {Record<string, unknown>} o
 * @returns {null | { expression: string; mode: "answer-column"|"full-table"; variables: string[] | null; steps: string[] | null }}
 */
function normalizeTruthTableObject(o) {
  if (!o || typeof o !== "object" || !o.enabled) return null;

  const steps = Array.isArray(o.steps)
    ? o.steps.map((x) => String(x).trim()).filter(Boolean)
    : null;

  let expression = String(o.expression ?? "").trim();
  if (!expression && steps?.length) expression = steps[steps.length - 1];

  if (!expression) return null;

  const mode = o.mode === "answer-column" ? "answer-column" : "full-table";
  const variables =
    Array.isArray(o.variables) && o.variables.length > 0
      ? o.variables.map((x) => String(x).trim()).filter(Boolean)
      : null;

  return { expression, mode, variables, steps };
}

/** Два логических признака, промежуточный столбец ¬B (шаблон по умолчанию). */
const DEFAULT_LOGIC_TRUTH_TABLE = {
  enabled: true,
  variables: ["A", "B"],
  expression: "A ∧ ¬B",
  steps: ["¬B", "A ∧ ¬B"],
  mode: "full-table",
};

function isTruthTableFlagOn(task) {
  const v = task?.truthTableEnabled ?? task?.truth_table_enabled;
  return v === true || v === 1;
}

/**
 * Встроенный конфиг для ВПР информатика, 8 класс, углублённый, задание 6 (логика).
 * Совпадает с DEFAULT_LOGIC_TRUTH_TABLE; оставлено для явной привязки к линейке заданий.
 * @param {Record<string, unknown>} task
 * @param {{ level?: string; subject?: string } | null | undefined} examContext — level/subject из URL экзамена
 */
export function defaultTruthTableVprInf8AdvancedTask6(task, examContext) {
  const { level, subject } = examContext || {};
  if (String(level || "").toLowerCase() !== "vpr") return null;
  if (String(subject || "").toLowerCase() !== "inf") return null;
  const n = Number(task?.number);
  if (!Number.isFinite(n) || n !== 6) return null;
  const cls = task?.vpr_class != null ? Number(task.vpr_class) : NaN;
  if (!Number.isFinite(cls) || cls !== 8) return null;
  if (!task?.vpr_advanced) return null;

  return { ...DEFAULT_LOGIC_TRUTH_TABLE };
}

/**
 * Конфиг таблицы истинности: только если в админке включён флаг «Таблица истинности на сайте».
 * Используется шаблон A, B, ¬B, A∧¬B (full-table). Для других сочетаний переменных позже можно расширить модель.
 *
 * @param {Record<string, unknown>} task
 * @param {{ level?: string; subject?: string } | null | undefined} [examContext]
 * @returns {null | { expression: string; mode: "answer-column"|"full-table"; variables: string[] | null; steps: string[] | null }}
 */
export function getTruthTableConfig(task, examContext) {
  if (!isTruthTableFlagOn(task)) return null;

  const specific = defaultTruthTableVprInf8AdvancedTask6(task, examContext);
  const raw = specific || DEFAULT_LOGIC_TRUTH_TABLE;
  return normalizeTruthTableObject(raw);
}
