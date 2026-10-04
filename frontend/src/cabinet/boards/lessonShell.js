/** Чистая раскладка оболочки доски. Не трогает store, sync и room id. */

export const LESSON_RAIL = [
  { id: "select", label: "Выбор", tool: "select", kbd: "V" },
  { id: "hand", label: "Перемещение", tool: "hand", kbd: "H" },
  { id: "divider-nav" },
  { id: "draw", label: "Рисование", tool: "draw", kbd: "D" },
  { id: "eraser", label: "Ластик", tool: "eraser", kbd: "E" },
  { id: "laser", label: "Лазер", tool: "laser", kbd: "K" },
  { id: "divider-draw" },
  { id: "text", label: "Текст", tool: "text", kbd: "T" },
  { id: "note", label: "Стикер", tool: "note", kbd: "N" },
  { id: "shapes", label: "Фигуры", tool: "geo", kbd: "R" },
  { id: "arrow", label: "Стрелка", tool: "arrow", kbd: "A" },
  { id: "frame", label: "Область", tool: "frame", kbd: "F" },
  { id: "line", label: "Линия", tool: "line", kbd: "L" },
  { id: "divider-objects" },
  { id: "insert", label: "Вставить" },
  { id: "files", label: "Файлы" },
  { id: "embed", label: "Вставка", tool: "embed" },
];

export const LESSON_TEXT_KINDS = [
  { id: "body", label: "Обычный текст", size: "m" },
  { id: "heading", label: "Заголовок", size: "xl" },
  { id: "caption", label: "Подпись", size: "s" },
];

export const LESSON_STICKER_COLORS = [
  { id: "yellow", label: "Жёлтый" },
  { id: "light-blue", label: "Голубой" },
  { id: "light-green", label: "Зелёный" },
  { id: "light-red", label: "Розовый" },
  { id: "orange", label: "Оранжевый" },
  { id: "violet", label: "Фиолетовый" },
];

export const LESSON_SHAPES = [
  { id: "rectangle", label: "Прямоугольник", geo: "rectangle" },
  { id: "ellipse", label: "Эллипс", geo: "ellipse" },
  { id: "triangle", label: "Треугольник", geo: "triangle" },
  { id: "diamond", label: "Ромб", geo: "diamond" },
  { id: "cloud", label: "Облако", geo: "cloud" },
  { id: "hexagon", label: "Шестиугольник", geo: "hexagon" },
];

export const LESSON_LINKS = [
  { id: "plain", label: "Обычная линия" },
  { id: "arrow", label: "Стрелка" },
  { id: "both", label: "Двусторонняя стрелка" },
  { id: "dashed", label: "Пунктир" },
  { id: "bind", label: "Автоматическое соединение" },
];

export const LESSON_FORMULAS = [
  { id: "pi", label: "π", tex: "\\pi" },
  { id: "sum", label: "∑", tex: "\\sum" },
  { id: "sqrt", label: "√", tex: "\\sqrt{x}" },
  { id: "inf", label: "∞", tex: "\\infty" },
  { id: "pm", label: "±", tex: "\\pm" },
  { id: "times", label: "×", tex: "\\times" },
  { id: "le", label: "≤", tex: "\\le" },
  { id: "neq", label: "≠", tex: "\\neq" },
  { id: "frac", label: "Дробь", tex: "\\frac{a}{b}" },
  { id: "power", label: "Степень", tex: "x^{n}" },
  { id: "root", label: "Корень", tex: "\\sqrt{x}" },
  { id: "index", label: "Индекс", tex: "x_{n}" },
  { id: "system", label: "Система", tex: "\\begin{cases} x \\\\ y \\end{cases}" },
  { id: "integral", label: "Интеграл", tex: "\\int_{a}^{b} f(x)\\,dx" },
  { id: "log", label: "Логарифм", tex: "\\log_{a} b" },
];

export const LESSON_INSERT = [
  { id: "image", label: "Изображение" },
  { id: "pdf", label: "PDF" },
  { id: "file", label: "Файл" },
  { id: "screenshot", label: "Скриншот" },
  { id: "clipboard", label: "Вставка из буфера" },
];

export const LESSON_TASKS = [
  { id: "bank", label: "Найти задание в банке" },
  { id: "insert", label: "Вставить задание" },
  { id: "empty", label: "Создать пустое задание" },
  { id: "ai", label: "AI-сгенерировать" },
  { id: "homework", label: "Вставить домашнее задание" },
];

export const LESSON_TEMPLATES = [
  { id: "explain", label: "Объяснение новой темы", cards: ["Тема", "Главная мысль", "Пример", "Вопрос классу"] },
  { id: "solve", label: "Решение задачи", cards: ["Дано", "Найти", "Решение", "Ответ"] },
  { id: "brainstorm", label: "Мозговой штурм", cards: ["Идея 1", "Идея 2", "Идея 3", "Идея 4"] },
  { id: "lesson", label: "Урок", cards: ["Цель", "Ход урока", "Практика", "Итог"] },
  { id: "plan", label: "План занятия", cards: ["Начало", "Середина", "Конец", "Домашнее"] },
  { id: "reflect", label: "Рефлексия", cards: ["Что понял", "Что было трудно", "Что попробую", "Вопрос"] },
  { id: "vocab", label: "Словарь", cards: ["Слово", "Значение", "Пример", "Перевод"] },
  { id: "cards", label: "Карточки", cards: ["Вопрос", "Ответ", "Вопрос", "Ответ"] },
  { id: "test", label: "Тест", cards: ["Вопрос 1", "Вопрос 2", "Вопрос 3", "Проверка"] },
  { id: "timeline", label: "Временная шкала", cards: ["Тогда", "Потом", "Сейчас", "Дальше"] },
  { id: "mindmap", label: "Интеллект-карта", cards: ["Тема", "Ветка 1", "Ветка 2", "Ветка 3"] },
];

export const LESSON_MORE = [
  { id: "frame", label: "Область", tool: "frame", kbd: "F" },
  { id: "line", label: "Линия", tool: "line", kbd: "L" },
  { id: "embed", label: "Вставка", tool: "embed" },
];

export const LESSON_EMOJIS = ["👍", "❓", "⭐", "✅", "🔥", "💡"];

export const LESSON_SESSION = [
  { id: "timer", label: "Таймер" },
];

export function lessonRailButton(item) {
  return Boolean(item?.tool) || item?.id === "insert" || item?.id === "files" || item?.id === "more";
}

export const LESSON_INK_COLORS = [
  { id: "black", label: "Чёрный" },
  { id: "red", label: "Красный" },
  { id: "blue", label: "Синий" },
];

export const LESSON_MARKER_COLORS = [
  { id: "yellow", label: "Жёлтый" },
  { id: "light-green", label: "Зелёный" },
  { id: "light-red", label: "Розовый" },
  { id: "blue", label: "Синий" },
];

export const LESSON_MARKER_OPACITY = 0.4;

export const LESSON_SIZE_STEPS = [
  { id: "s", label: "Тонкая", dot: 6 },
  { id: "m", label: "Средняя", dot: 10 },
  { id: "l", label: "Толстая", dot: 14 },
  { id: "xl", label: "Очень толстая", dot: 20 },
];

/** Множители tldraw поверх базового fontSize темы. Подпись — в пунктах. */
export const LESSON_TEXT_SIZE_STEPS = [
  { id: "s", scale: 1.125 },
  { id: "m", scale: 1.5 },
  { id: "l", scale: 2.25 },
  { id: "xl", scale: 2.75 },
];

export function lessonTextSizePt(id, base = 16) {
  const step = LESSON_TEXT_SIZE_STEPS.find((item) => item.id === id) || LESSON_TEXT_SIZE_STEPS[1];
  const pixels = Number(base) * step.scale;
  return Math.round(pixels * 0.75);
}

export function lessonTextSizeLabel(id, base = 16) {
  return `${lessonTextSizePt(id, base)} пт`;
}

/** Круглые ползунки стикера меняют масштаб, не создавая копию. */
export function lessonStickerResize(initial, handle, size) {
  const width = Number(size?.width);
  const height = Number(size?.height);
  if (!(width > 0) || !(height > 0)) return null;
  const start = Number(initial?.props?.scale) || 1;
  let next = start;
  let fixedX = null;
  let fixedY = null;
  if (handle?.id === "right") {
    next = (handle.x / width) * start;
  } else if (handle?.id === "left") {
    next = ((width - handle.x) / width) * start;
    fixedX = width;
    fixedY = 0;
  } else if (handle?.id === "bottom") {
    next = (handle.y / height) * start;
  } else if (handle?.id === "top") {
    next = ((height - handle.y) / height) * start;
    fixedX = 0;
    fixedY = height;
  } else {
    return null;
  }
  next = Math.min(8, Math.max(0.25, next));
  const rotation = initial.rotation || 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let x = initial.x;
  let y = initial.y;
  if (fixedX !== null) {
    const ratio = next / start;
    const pageX = initial.x + fixedX * cos - fixedY * sin;
    const pageY = initial.y + fixedX * sin + fixedY * cos;
    const localX = fixedX * ratio;
    const localY = fixedY * ratio;
    x = pageX - (localX * cos - localY * sin);
    y = pageY - (localX * sin + localY * cos);
  }
  return { x, y, scale: next };
}

export const LESSON_RAIL_OVERFLOW = [];
export const LESSON_PHONE_RAIL = LESSON_RAIL.filter((item) => item.label).map((item) => item.id);

export const LESSON_THICKNESS_MIN = 8;
export const LESSON_THICKNESS_MAX = 72;
export const LESSON_THICKNESS_STEP = 1;
export const LESSON_THICKNESS_DEFAULT = 16;
export const LESSON_STROKE_BASE = 4.5;

let lessonThickness = LESSON_THICKNESS_DEFAULT;
const thicknessListeners = new Set();

export function getLessonThickness() {
  return lessonThickness;
}

export function subscribeLessonThickness(listener) {
  thicknessListeners.add(listener);
  return () => thicknessListeners.delete(listener);
}

export function clampLessonThickness(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return LESSON_THICKNESS_DEFAULT;
  const snapped = Math.round(number / LESSON_THICKNESS_STEP) * LESSON_THICKNESS_STEP;
  return Math.min(LESSON_THICKNESS_MAX, Math.max(LESSON_THICKNESS_MIN, snapped));
}

export function setLessonThickness(value) {
  const next = clampLessonThickness(value);
  if (next === lessonThickness) return next;
  lessonThickness = next;
  thicknessListeners.forEach((listener) => listener());
  return next;
}

export function lessonThicknessLabel(value) {
  return clampLessonThickness(value).toFixed(2).replace(/\.?0+$/, "");
}

export function scaledLessonThickness(currentScale, previous, next) {
  const base = Number.isFinite(currentScale) && currentScale > 0 ? currentScale : 1;
  const from = Number.isFinite(previous) && previous > 0 ? previous : 1;
  return (base / from) * next;
}

export const LESSON_OPACITY_STEPS = [
  { id: 1, label: "100%" },
  { id: 0.75, label: "75%" },
  { id: 0.5, label: "50%" },
];

export const LESSON_FILL_STEPS = [
  { id: "none", label: "Без заливки", short: "Нет" },
  { id: "semi", label: "Полупрозрачная", short: "50%" },
  { id: "solid", label: "Сплошная", short: "Заливка" },
];

export const LESSON_FONT_STEPS = [
  { id: "sans", label: "Гротеск" },
  { id: "serif", label: "Антиква" },
  { id: "draw", label: "Рукописный" },
  { id: "mono", label: "Моно" },
];

export const LESSON_FONT_FAMILY = {
  sans: "var(--tl-font-sans)",
  serif: "var(--tl-font-serif)",
  draw: "var(--tl-font-draw)",
  mono: "var(--tl-font-mono)",
};

export function lessonFontFamily(id) {
  return LESSON_FONT_FAMILY[id] || LESSON_FONT_FAMILY.sans;
}

export const LESSON_ALIGN_STEPS = [
  { id: "start", label: "По левому краю" },
  { id: "middle", label: "По центру" },
  { id: "end", label: "По правому краю" },
];

const GRAPH_FNS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt,
  log: Math.log,
  ln: Math.log,
  abs: Math.abs,
};

export function lessonSelectionKind(types, lessonKind = "") {
  const list = types || [];
  if (list.length === 1 && lessonKind === "file") return "file";
  if (list.length > 1) return "multi";
  if (list.length !== 1) return null;
  const type = list[0];
  if (type === "image") return "image";
  if (type === "text" || type === "note") return "text";
  if (type === "geo") return "geo";
  if (type === "arrow") return "arrow";
  if (type === "draw" || type === "highlight" || type === "line") return "stroke";
  if (type === "formula" || type === "graph" || type === "task") return type;
  return null;
}

export function lessonToolActive(id, toolId) {
  if (id === "shapes") return toolId === "geo";
  if (id === "insert" || id === "more" || String(id).startsWith("divider")) return false;
  return toolId === id;
}

export function lessonContextBar(kind) {
  if (kind === "file") return ["file"];
  if (kind === "geo") return ["color", "fill", "border", "size", "lock", "more"];
  if (kind === "text") return ["font", "size", "color", "opacity", "align", "more"];
  if (kind === "image") return ["crop", "replace", "opacity", "lock", "more"];
  if (kind === "multi") return ["alignShapes", "distribute", "group", "duplicate", "lock", "more"];
  if (kind === "stroke") return ["color", "size", "opacity", "lock", "more"];
  if (kind === "arrow") return ["color", "size", "border", "arrowhead", "lock", "more"];
  if (kind === "formula") return ["edit", "duplicate", "delete", "more"];
  if (kind === "graph") return ["edit", "duplicate", "delete", "more"];
  if (kind === "task") return ["edit", "duplicate", "lock", "delete", "more"];
  return [];
}

export function lessonRailHeight(items, button = 40) {
  const gap = 2;
  const pad = 8;
  return items.reduce((height, item, index) => {
    const row = lessonRailButton(item) ? button : 9;
    return height + row + (index ? gap : 0);
  }, pad);
}

function collapseDividers(items) {
  const next = [];
  items.forEach((item) => {
    const divider = !lessonRailButton(item);
    const previous = next.at(-1);
    const previousDivider = previous && !lessonRailButton(previous);
    if (divider && (!previous || previousDivider)) return;
    next.push(item);
  });
  while (next.length && !lessonRailButton(next.at(-1))) next.pop();
  return next;
}

export function lessonAdaptiveRail(availableHeight, button = 40) {
  if (lessonRailHeight(LESSON_RAIL, button) <= availableHeight) {
    return { items: LESSON_RAIL, overflow: [] };
  }
  const hidden = new Set(LESSON_RAIL_OVERFLOW);
  return {
    items: collapseDividers(LESSON_RAIL.filter((item) => !hidden.has(item.id))),
    overflow: LESSON_RAIL.filter((item) => hidden.has(item.id)),
  };
}

export function lessonPhoneRail() {
  const keep = new Set(LESSON_PHONE_RAIL);
  const overflow = LESSON_RAIL.filter((item) => item.label && !keep.has(item.id) && item.id !== "more");
  return { items: LESSON_RAIL.filter((item) => keep.has(item.id)), overflow };
}

export function lessonContextPosition(bounds, viewport) {
  const width = 280;
  const bar = 44;
  const margin = 12;
  const left = Math.min(
    viewport.width - margin - width / 2,
    Math.max(margin + 64 + width / 2, bounds.x + bounds.width / 2),
  );
  const above = bounds.y - bar - 8 >= 64;
  let top = above ? bounds.y - bar - 8 : bounds.y + bounds.height + 8;
  if (top + bar > viewport.height - margin) top = Math.max(64, viewport.height - bar - margin);
  return { top, left, above };
}

export function lessonThicknessPx(value) {
  return clampLessonThickness(value);
}

export function lessonStrokeScale(zoomScale, thicknessPx) {
  const zoom = Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1;
  return zoom * (clampLessonThickness(thicknessPx) / LESSON_STROKE_BASE);
}

function compileLessonGraph(source) {
  const input = String(source || "").trim().replace(/^y\s*=\s*/i, "").replace(/\s+/g, "");
  if (!input || !/^[0-9xX+\-*/^().,a-z]+$/.test(input)) return null;
  let index = 0;
  const peek = () => input[index];
  const eat = (char) => {
    if (peek() !== char) return false;
    index += 1;
    return true;
  };
  function parseExpr() {
    return parseSum();
  }
  function parseSum() {
    let node = parseMul();
    if (!node) return null;
    while (peek() === "+" || peek() === "-") {
      const op = peek();
      index += 1;
      const right = parseMul();
      if (!right) return null;
      const left = node;
      node = (x) => (op === "+" ? left(x) + right(x) : left(x) - right(x));
    }
    return node;
  }
  function parseMul() {
    let node = parsePow();
    if (!node) return null;
    while (peek() === "*" || peek() === "/") {
      const op = peek();
      index += 1;
      const right = parsePow();
      if (!right) return null;
      const left = node;
      node = (x) => (op === "*" ? left(x) * right(x) : left(x) / right(x));
    }
    return node;
  }
  function parsePow() {
    const node = parseUnary();
    if (!node || !eat("^")) return node;
    const right = parsePow();
    if (!right) return null;
    return (x) => node(x) ** right(x);
  }
  function parseUnary() {
    if (eat("+")) return parseUnary();
    if (eat("-")) {
      const value = parseUnary();
      return value ? (x) => -value(x) : null;
    }
    return parsePrimary();
  }
  function parsePrimary() {
    if (eat("(")) {
      const value = parseExpr();
      if (!value || !eat(")")) return null;
      return value;
    }
    if (/[a-z]/i.test(peek() || "")) {
      let name = "";
      while (/[a-z]/i.test(peek() || "")) {
        name += peek().toLowerCase();
        index += 1;
      }
      if (name === "x") return (x) => x;
      const fn = GRAPH_FNS[name];
      if (!fn || !eat("(")) return null;
      const arg = parseExpr();
      if (!arg || !eat(")")) return null;
      return (x) => fn(arg(x));
    }
    let num = "";
    while (/[0-9.]/.test(peek() || "")) {
      num += peek();
      index += 1;
    }
    if (!num) return null;
    const value = Number(num);
    if (!Number.isFinite(value)) return null;
    return () => value;
  }
  const fn = parseExpr();
  if (!fn || index !== input.length) return null;
  return fn;
}

export function lessonCellValue(source) {
  const fn = compileLessonGraph(source);
  if (!fn) return null;
  const value = fn(0);
  return Number.isFinite(value) ? value : null;
}

export function lessonGraphPoints(source, min, max, steps = 40) {
  const fn = compileLessonGraph(source);
  const from = Number(min);
  const to = Number(max);
  if (!fn || !Number.isFinite(from) || !Number.isFinite(to) || to === from) return null;
  const count = Math.max(2, steps);
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const x = from + ((to - from) * i) / count;
    let y;
    try {
      y = fn(x);
    } catch {
      continue;
    }
    if (!Number.isFinite(y)) continue;
    points.push({ x, y: -y });
  }
  return points.length >= 2 ? points : null;
}

export function lessonDurationLabel(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${minutes}:${ss}`;
}

export function lessonClockText(startsAt, endsAt, now = Date.now(), elapsed = false) {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return "";
  const at = Number.isFinite(now) ? now : Date.now();
  const end = Date.parse(endsAt);
  if (elapsed || !Number.isFinite(end)) {
    return `идёт ${lessonDurationLabel(Math.max(0, at - start))}`;
  }
  const remaining = end - at;
  if (remaining <= 0) return "время вышло";
  return `осталось ${lessonDurationLabel(remaining)}`;
}

export function lessonZoomLabel(zoom) {
  const value = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return `${Math.round(value * 100)}%`;
}

export const LESSON_ZOOM_STEPS = Array.from({ length: 32 }, (_, index) => (index + 1) * 0.25);

export const LESSON_BOARD_PAGE_FALLBACK = "Доска урока";
export const LESSON_ROOM_CHROME_SOURCE = "itflux-lesson-room";
export const LESSON_BOARD_CHROME_SOURCE = "itflux-board";
export const LESSON_BOARD_TITLE_PARAM = "lesson";
export const LESSON_ROOM_DOCK_GAP = 8;

export function lessonBoardPageTitle(lessonTitle) {
  const text = String(lessonTitle || "").trim();
  return text || LESSON_BOARD_PAGE_FALLBACK;
}

export function readLessonBoardTitleParam(search) {
  const raw = String(search || "");
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw.replace(/^\?/, "");
  return String(new URLSearchParams(query).get(LESSON_BOARD_TITLE_PARAM) || "").trim();
}

export function withLessonBoardTitle(url, title) {
  const text = String(title || "").trim();
  const raw = String(url || "");
  if (!text || !raw) return raw;
  try {
    const abs = new URL(raw, raw.startsWith("http") ? undefined : "https://local.invalid");
    if (!/\/boards\//i.test(abs.pathname)) return raw;
    abs.searchParams.set(LESSON_BOARD_TITLE_PARAM, text);
    if (raw.startsWith("http")) return abs.toString();
    return `${abs.pathname}${abs.search}${abs.hash}`;
  } catch {
    return raw;
  }
}

const LESSON_BOARD_ACTIONS = new Set(["materials", "fullscreen", "finish", "collapse"]);

export function lessonRoomChromeMessage(data) {
  if (!data || data.source !== LESSON_ROOM_CHROME_SOURCE || data.type !== "board-chrome") return null;
  const reserve = Number(data.reserveRight);
  const materialsCount = Number(data.materialsCount);
  return {
    lessonTitle: String(data.lessonTitle || "").trim(),
    reserveRight: Number.isFinite(reserve) && reserve > 0 ? Math.round(reserve) : 0,
    inRoom: true,
    live: Boolean(data.live),
    whenLabel: String(data.whenLabel || "").trim(),
    startsAt: String(data.startsAt || "").trim(),
    endsAt: String(data.endsAt || "").trim(),
    materialsCount: Number.isFinite(materialsCount) && materialsCount > 0 ? Math.round(materialsCount) : 0,
    materialsOpen: Boolean(data.materialsOpen),
    fullscreen: Boolean(data.fullscreen),
    canFinish: Boolean(data.canFinish),
    finishing: Boolean(data.finishing),
  };
}

export function lessonBoardChromeAction(data) {
  if (!data || data.source !== LESSON_BOARD_CHROME_SOURCE || data.type !== "board-chrome-action") return "";
  return LESSON_BOARD_ACTIONS.has(data.action) ? data.action : "";
}
