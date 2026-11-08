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

/** Одна позиция: '' | '0' | '1'. Числовой 0 не отбрасывается. */
export function sanitizeBinaryChar(ch) {
  if (ch === 0 || ch === "0") return "0";
  if (ch === 1 || ch === "1") return "1";
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

/**
 * Оставить 0, 1, точку (пустая клетка) и пробелы между строками.
 * Точку и лишние пробелы не схлопываем: иначе пустая клетка сдвигает соседний 0.
 */
export function sanitizeTruthTableAnswerString(str) {
  return String(str ?? "")
    .replace(/[^01.\s]/g, "")
    .replace(/[ \t]*\r?\n[ \t]*/g, " ")
    .trim();
}

function truthCellChar(ch) {
  if (ch === 0 || ch === "0") return "0";
  if (ch === 1 || ch === "1") return "1";
  return ".";
}

/**
 * Сетка вычислимых столбцов → «10 .0 11 0.» (группа = строка, «.» = пустая клетка).
 * Числовой 0 остаётся нулём и не переезжает в другой столбец.
 * @param {Array<Array<string|number>>} grid [row][col]
 */
export function formatTruthTableAnswerFromGrid(grid) {
  return (grid || [])
    .map((row) => (row || []).map((c) => truthCellChar(c)).join(""))
    .join(" ");
}

function emptyTruthGrid(numRows, numComputed) {
  return Array.from({ length: numRows }, () => Array.from({ length: numComputed }, () => ""));
}

function bitAt(ch) {
  return ch === "0" || ch === "1" ? ch : "";
}

function placeColumn(numRows, numComputed, col, bits) {
  const grid = emptyTruthGrid(numRows, numComputed);
  for (let r = 0; r < numRows; r++) grid[r][col] = bitAt(bits[r]);
  return grid;
}

function placeRowGroups(groups, numRows, numComputed) {
  return Array.from({ length: numRows }, (_, r) => {
    const g = groups[r] || "";
    return Array.from({ length: numComputed }, (_, c) => bitAt(g[c]));
  });
}

function placeColumnGroups(groups, numRows, numComputed) {
  const grid = emptyTruthGrid(numRows, numComputed);
  for (let c = 0; c < numComputed; c++) {
    const g = groups[c] || "";
    for (let r = 0; r < numRows; r++) grid[r][c] = bitAt(g[r]);
  }
  return grid;
}

/** Группы 0/1/«.» . Пустые группы от двойного пробела сохраняют номер строки. */
export function truthTableAnswerGroups(value) {
  const cleaned = sanitizeTruthTableAnswerString(value);
  if (!cleaned) return [];
  return cleaned.split(" ");
}

/**
 * Разбор ответа в сетку.
 * — «10 .0 11 00» и «10 00 11 00»: группа = строка;
 * — «1010 0010»: группа = столбец (длина = числу строк), если групп не столько, сколько строк;
 * — слитно длины numRows*numComputed: построчно;
 * — слитно или по одной цифре на строку длины numRows: только столбец результата.
 * «.» — пустая клетка и не сдвигает 0/1.
 */
export function parseTruthTableAnswerToGrid(value, numRows, numComputed) {
  const grids = truthTableAnswerGridCandidates(value, numRows, numComputed);
  return grids[0] || emptyTruthGrid(numRows, numComputed);
}

/** Все допустимые раскладки одной строки ответа (строки / столбцы / только результат). */
export function truthTableAnswerGridCandidates(value, numRows, numComputed) {
  if (numRows === 0 || numComputed === 0) return [];
  const groups = truthTableAnswerGroups(value).filter((g) => g.length > 0);
  if (!groups.length) return [];
  const out = [];
  const push = (grid) => {
    const key = JSON.stringify(grid);
    if (!out.some((g) => JSON.stringify(g) === key)) out.push(grid);
  };

  if (groups.length === numRows) {
    const singles = groups.every((g) => g.length === 1 && g !== ".");
    if (singles && numComputed > 1) push(placeColumn(numRows, numComputed, numComputed - 1, groups.join("")));
    else push(placeRowGroups(groups, numRows, numComputed));
  }

  if (groups.length === numComputed && groups.every((g) => g.length === numRows)) {
    push(placeColumnGroups(groups, numRows, numComputed));
  }

  if (groups.length === 1) {
    const raw = groups[0];
    const digits = raw.replace(/\./g, "");
    if (!raw.includes(".") && digits.length === numRows * numComputed) {
      push(placeRowGroups(
        Array.from({ length: numRows }, (_, r) => digits.slice(r * numComputed, (r + 1) * numComputed)),
        numRows,
        numComputed
      ));
      push(placeColumnGroups(
        Array.from({ length: numComputed }, (_, c) => digits.slice(c * numRows, (c + 1) * numRows)),
        numRows,
        numComputed
      ));
    } else if (!raw.includes(".") && digits.length === numRows) {
      push(placeColumn(numRows, numComputed, numComputed - 1, digits));
    } else if (raw.length === numRows) {
      push(placeColumn(numRows, numComputed, numComputed - 1, raw));
    }
  }

  return out;
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
 * Конфиг таблицы истинности: флаг «Таблица истинности на сайте» и формула из условия.
 * Столбцы — подвыражения этой формулы (приоритет ¬, ∧, ⊕, ∨, →, ≡ и скобки), не шаблон A∧¬B.
 *
 * @param {Record<string, unknown>} task
 * @param {{ level?: string; subject?: string } | null | undefined} [examContext]
 * @returns {null | { expression: string; mode: "answer-column"|"full-table"; variables: string[] | null; steps: string[] | null }}
 */
export function getTruthTableConfig(task, examContext) {
  if (!isTruthTableFlagOn(task)) return null;

  const prompt = task?.text || task?.task_template || "";
  const built = buildTruthTableConfigFromPrompt(prompt, { requirePhrase: false });
  if (built) return built;
  if (promptHasLogicFormula(prompt)) return null;

  const specific = defaultTruthTableVprInf8AdvancedTask6(task, examContext);
  const raw = specific || DEFAULT_LOGIC_TRUTH_TABLE;
  return normalizeTruthTableObject(raw);
}

const FILL_TRUTH_TABLE_RE = /заполните\s+таблиц[а-яё]*\s+истинност/i;

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function isFillInTruthTable(text) {
  return FILL_TRUTH_TABLE_RE.test(String(text || ""));
}

function promptHasLogicFormula(prompt) {
  const text = decodeHtmlEntities(prompt);
  return /\\lnot|\\neg|\\land|\\lor|\\wedge|\\vee|\\equiv|\\to\b|\\rightarrow|\\oplus|[¬∧∨→≡⊕]|\/\\|\\\//.test(text);
}

function latexBlocks(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("\\(", i);
    if (start < 0) break;
    const end = text.indexOf("\\)", start + 2);
    if (end < 0) break;
    out.push(text.slice(start + 2, end));
    i = end + 2;
  }
  return out;
}

function isAssignmentBlock(block) {
  return /\{=\}|=[01]/.test(block);
}

function looksLikeLogic(block) {
  return /\\lnot|\\neg|\\land|\\lor|\\wedge|\\vee|\\equiv|\\rightarrow|\\leftrightarrow|\\oplus|\\to\b|[¬∧∨→≡⊕]|\/\\|\\\/|(?<![A-Za-zА-Яа-яЁё0-9_])(?:ИЛИ|НЕ|XOR|AND|OR|NOT|И)(?![A-Za-zА-Яа-яЁё0-9_])/i.test(
    block
  );
}

function extractLogicExpression(text) {
  for (const block of latexBlocks(text)) {
    if (isAssignmentBlock(block)) continue;
    if (looksLikeLogic(block)) return block;
  }
  const plain = text.replace(/\\\(|\\\)/g, " ");
  if (plain.length <= 240 && looksLikeLogic(plain) && !isAssignmentBlock(plain)) return plain;
  return "";
}

function variableOrderFromPrompt(text, fallback) {
  const found = [];
  const re = /([A-Za-z])\s*(?:\{=\}\s*|=)\s*[01]/g;
  let match = re.exec(text);
  while (match) {
    if (found.includes(match[1])) break;
    found.push(match[1]);
    match = re.exec(text);
  }
  if (!found.length) return fallback;
  if (!fallback.every((name) => found.includes(name))) return fallback;
  return found;
}

const LOGIC_PREC = { "!": 6, "&": 5, "^": 4, "|": 3, ">": 2, "=": 1 };
const LOGIC_PRETTY = { "!": "¬", "&": "∧", "^": "⊕", "|": "∨", ">": "→", "=": "≡" };

function formatLogicNode(node) {
  if (!node) return "";
  if (node.op === "var") return node.name;
  if (node.op === "!") {
    const inner = formatLogicNode(node.a);
    if (node.a && node.a.op !== "var" && node.a.op !== "!") return `¬(${inner})`;
    return `¬${inner}`;
  }
  const prec = LOGIC_PREC[node.op];
  const side = (child, isRight) => {
    const text = formatLogicNode(child);
    if (!child || child.op === "var" || child.op === "!") return text;
    const childPrec = LOGIC_PREC[child.op] || 0;
    const wrap =
      childPrec < prec
      || (childPrec === prec && node.op === ">" && !isRight)
      || (childPrec === prec && node.op !== ">" && isRight);
    return wrap ? `(${text})` : text;
  };
  return `${side(node.a, false)} ${LOGIC_PRETTY[node.op]} ${side(node.b, true)}`;
}

function tokenizeLogic(formula) {
  let s = String(formula || "");
  const reps = [
    [/\\leftrightarrow\b/g, " = "],
    [/\\rightarrow\b/g, " > "],
    [/\\implies\b/g, " > "],
    [/\\equiv\b/g, " = "],
    [/\\oplus\b/g, " ^ "],
    [/\\lnot\b/g, " ! "],
    [/\\neg\b/g, " ! "],
    [/\\land\b/g, " & "],
    [/\\wedge\b/g, " & "],
    [/\\lor\b/g, " | "],
    [/\\vee\b/g, " | "],
    [/\\to\b/g, " > "],
    [/<=>/g, " = "],
    [/<->/g, " = "],
    [/→/g, " > "],
    [/⇒/g, " > "],
    [/≡/g, " = "],
    [/⊕/g, " ^ "],
    [/∧/g, " & "],
    [/∨/g, " | "],
    [/¬/g, " ! "],
    [/\/\\/g, " & "],
    [/\\\//g, " | "],
    [/&&/g, " & "],
    [/\|\|/g, " | "],
    [/(?<![A-Za-zА-Яа-яЁё0-9_])ИЛИ(?![A-Za-zА-Яа-яЁё0-9_])/gi, " | "],
    [/(?<![A-Za-zА-Яа-яЁё0-9_])НЕ(?![A-Za-zА-Яа-яЁё0-9_])/gi, " ! "],
    [/(?<![A-Za-zА-Яа-яЁё0-9_])XOR(?![A-Za-zА-Яа-яЁё0-9_])/gi, " ^ "],
    [/(?<![A-Za-zА-Яа-яЁё0-9_])AND(?![A-Za-zА-Яа-яЁё0-9_])/gi, " & "],
    [/(?<![A-Za-zА-Яа-яЁё0-9_])OR(?![A-Za-zА-Яа-яЁё0-9_])/gi, " | "],
    [/(?<![A-Za-zА-Яа-яЁё0-9_])NOT(?![A-Za-zА-Яа-яЁё0-9_])/gi, " ! "],
    [/(?<![A-Za-zА-Яа-яЁё0-9_])И(?![A-Za-zА-Яа-яЁё0-9_])/gi, " & "],
  ];
  for (const [re, to] of reps) s = s.replace(re, to);
  s = s
    .replace(/\\left|\\right|\\bigl|\\bigr|\\Bigl|\\Bigr/g, "")
    .replace(/\\[,;:!\s]/g, " ")
    .replace(/~/g, " ! ");
  const tokens = s.match(/[A-Za-z]+|&&|\|\||[=&>^!&|()]/g);
  if (!tokens || !tokens.length) return null;
  return tokens.map((token) => {
    if (token === "&&") return "&";
    if (token === "||") return "|";
    if (/^[A-Za-z]+$/.test(token)) {
      if (token.length !== 1) return null;
      return token;
    }
    return token;
  });
}

function parseLogicFormula(formula) {
  const tokens = tokenizeLogic(formula);
  if (!tokens || tokens.some((token) => token == null)) return null;
  let i = 0;
  const peek = () => tokens[i];
  const eat = (op) => {
    if (peek() !== op) return false;
    i += 1;
    return true;
  };
  function parseEquiv() {
    let node = parseImpl();
    if (!node) return null;
    while (eat("=")) {
      const right = parseImpl();
      if (!right) return null;
      node = { op: "=", a: node, b: right };
    }
    return node;
  }
  function parseImpl() {
    const left = parseOr();
    if (!left || peek() !== ">") return left;
    i += 1;
    const right = parseImpl();
    if (!right) return null;
    return { op: ">", a: left, b: right };
  }
  function parseOr() {
    let node = parseXor();
    if (!node) return null;
    while (eat("|")) {
      const right = parseXor();
      if (!right) return null;
      node = { op: "|", a: node, b: right };
    }
    return node;
  }
  function parseXor() {
    let node = parseAnd();
    if (!node) return null;
    while (eat("^")) {
      const right = parseAnd();
      if (!right) return null;
      node = { op: "^", a: node, b: right };
    }
    return node;
  }
  function parseAnd() {
    let node = parseNot();
    if (!node) return null;
    while (eat("&")) {
      const right = parseNot();
      if (!right) return null;
      node = { op: "&", a: node, b: right };
    }
    return node;
  }
  function parseNot() {
    if (eat("!")) {
      const arg = parseNot();
      if (!arg) return null;
      return { op: "!", a: arg };
    }
    return parsePrimary();
  }
  function parsePrimary() {
    if (eat("(")) {
      const inner = parseEquiv();
      if (!inner || !eat(")")) return null;
      return inner;
    }
    const token = peek();
    if (token && /^[A-Za-z]$/.test(token)) {
      i += 1;
      return { op: "var", name: token };
    }
    return null;
  }
  const ast = parseEquiv();
  if (!ast || i !== tokens.length) return null;
  return ast;
}

function collectLogicSteps(ast) {
  const steps = [];
  const walk = (node) => {
    if (!node || node.op === "var") return;
    if (node.a) walk(node.a);
    if (node.b) walk(node.b);
    steps.push(node);
  };
  walk(ast);
  return steps;
}

function collectLogicVars(ast) {
  const names = [];
  const walk = (node) => {
    if (!node) return;
    if (node.op === "var") {
      if (!names.includes(node.name)) names.push(node.name);
      return;
    }
    walk(node.a);
    walk(node.b);
  };
  walk(ast);
  return names;
}

function evalLogicNode(node, env) {
  if (!node) return 0;
  if (node.op === "var") return env[node.name] ? 1 : 0;
  if (node.op === "!") return evalLogicNode(node.a, env) ? 0 : 1;
  const left = evalLogicNode(node.a, env);
  const right = evalLogicNode(node.b, env);
  if (node.op === "&") return left && right ? 1 : 0;
  if (node.op === "|") return left || right ? 1 : 0;
  if (node.op === "^") return left !== right ? 1 : 0;
  if (node.op === ">") return !left || right ? 1 : 0;
  if (node.op === "=") return left === right ? 1 : 0;
  return 0;
}

function compileTruthTable(prompt) {
  const text = decodeHtmlEntities(prompt);
  const formula = extractLogicExpression(text);
  if (!formula) return null;
  const ast = parseLogicFormula(formula);
  if (!ast) return null;
  const steps = collectLogicSteps(ast);
  if (!steps.length) return null;
  const variables = variableOrderFromPrompt(text, collectLogicVars(ast));
  if (!variables.length || variables.length > 8) return null;
  const rows = generateCombinations(variables);
  const columns = steps.map((step) =>
    rows.map((row) => {
      const env = {};
      variables.forEach((name, index) => {
        env[name] = row[index];
      });
      return String(evalLogicNode(step, env));
    }).join("")
  );
  return {
    variables,
    expression: formatLogicNode(ast),
    stepLabels: steps.map((step) => formatLogicNode(step)),
    columns,
    rows: rows.length,
  };
}

/**
 * Столбцы таблицы по формуле условия. null, если это не заполнение таблицы истинности.
 * @param {string} prompt
 * @param {{ requirePhrase?: boolean }} [options]
 */
export function buildTruthTableConfigFromPrompt(prompt, options = {}) {
  const requirePhrase = options.requirePhrase !== false;
  const text = decodeHtmlEntities(prompt);
  if (requirePhrase && !isFillInTruthTable(text)) return null;
  const spec = compileTruthTable(text);
  if (!spec) return null;
  return {
    expression: spec.expression,
    mode: "full-table",
    variables: spec.variables,
    steps: spec.stepLabels,
  };
}

/**
 * Значения всех вычислимых столбцов на каждом наборе входов.
 * columns[i] — строка из 0/1 длины 2^n, сверху вниз.
 */
export function evaluateTruthTable(prompt) {
  const spec = compileTruthTable(prompt);
  if (!spec) return null;
  return {
    variables: spec.variables,
    expression: spec.expression,
    steps: spec.stepLabels,
    columns: spec.columns,
  };
}

function readOfficialColumns(expected, spec) {
  const groups = truthTableAnswerGroups(expected).filter((g) => g.length > 0 && /^[01]+$/.test(g));
  if (!groups.length) return null;
  const rows = spec.rows;
  const steps = spec.columns.length;
  if (groups.length === 1 && groups[0].length === rows) {
    return { mode: "result", columns: [groups[0]] };
  }
  if (groups.length === rows && groups.every((g) => g.length === 1)) {
    return { mode: "result", columns: [groups.join("")] };
  }
  if (groups.length === steps && groups.every((g) => g.length === rows)) {
    return { mode: "all", columns: groups };
  }
  return null;
}

function officialAgrees(official, spec) {
  if (!official) return false;
  if (official.mode === "result") return official.columns[0] === spec.columns[spec.columns.length - 1];
  if (official.mode === "all" && official.columns.length === spec.columns.length) {
    return official.columns.every((col, index) => col === spec.columns[index]);
  }
  return false;
}

function gridMatchesExpected(grid, columns, required) {
  const rows = columns[0]?.length || 0;
  if (!grid || grid.length !== rows) return false;
  for (let c = 0; c < columns.length; c++) {
    for (let r = 0; r < rows; r++) {
      const got = grid[r]?.[c] ?? "";
      if (got !== "0" && got !== "1") {
        if (required[c]) return false;
        continue;
      }
      if (got !== columns[c][r]) return false;
    }
  }
  return true;
}

/**
 * Проверка ответа по клеткам.
 * true/false — задание на таблицу истинности и эталон совпал с вычислением формулы.
 * null — это не такая проверка (оставить обычное сравнение).
 * Пустая клетка обязательного столбца и неверный 0/1 не засчитываются.
 * Числовой ноль и ведущие нули («0001» и «1») не приравниваются.
 * @param {string} student
 * @param {{ prompt?: string, expected?: string, enabled?: boolean }} spec
 * @returns {boolean | null}
 */
export function matchTruthTableAnswer(student, spec = {}) {
  const prompt = spec.prompt || "";
  const expected = spec.expected || "";
  const text = decodeHtmlEntities(prompt);
  if (!spec.enabled && !isFillInTruthTable(text)) return null;
  if (!String(expected).trim()) return null;
  const compiled = compileTruthTable(text);
  if (!compiled) return null;
  const official = readOfficialColumns(expected, compiled);
  if (!officialAgrees(official, compiled)) return null;
  const required = compiled.columns.map((_, index) =>
    official.mode === "all" ? true : index === compiled.columns.length - 1
  );
  const candidates = truthTableAnswerGridCandidates(student, compiled.rows, compiled.columns.length);
  if (!candidates.length) return false;
  return candidates.some((grid) => gridMatchesExpected(grid, compiled.columns, required));
}

/** Обёртка над условием и эталоном задания. */
export function gradeTruthTableAnswer(student, task) {
  if (!task || typeof task !== "object") return null;
  return matchTruthTableAnswer(student, {
    prompt: task.text || task.task_template || "",
    expected: task.answer || "",
    enabled: isTruthTableFlagOn(task),
  });
}
