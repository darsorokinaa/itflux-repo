/**
 * ОГЭ математика: задания на соответствие (типично №11) — блоки «КОЭФФИЦИЕНТЫ» / «ГРАФИКИ»
 * или «ФУНКЦИИ» / «ГРАФИКИ». Рисунки 1) 2) 3) и варианты А) Б) В) — в одну строку.
 */

import { parseTaskHtmlFragment } from "./parseTaskHtmlFragment";

const SECTION_HEADERS = /^(КОЭФФИЦИЕНТЫ|ГРАФИКИ|ФУНКЦИИ|ФОРМУЛЫ)$/i;
const LETTER_LABEL_RE = /^([А-ЯA-Z])\)$/i;
const NUM_LABEL_RE = /^(\d+)\)$/;

const formatCache = new Map();
const FORMAT_CACHE_MAX = 48;

function parseHtmlFragment(html) {
  return parseTaskHtmlFragment(html, "oge-math-matching-parse-root");
}

function normalizeCellText(el) {
  return (el?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labelFromElement(el) {
  if (!el) return null;
  const raw = normalizeCellText(el);
  let m = raw.match(LETTER_LABEL_RE);
  if (m) return { kind: "letter", id: m[1] };
  m = raw.match(NUM_LABEL_RE);
  if (m) return { kind: "num", id: m[1] };
  const inner = el.innerHTML || "";
  const bm = inner.match(/<(?:b|strong)[^>]*>\s*([А-ЯA-Z])\)\s*<\/(?:b|strong)>/i);
  if (bm) return { kind: "letter", id: bm[1] };
  const nm = inner.match(/<(?:b|strong)[^>]*>\s*(\d+)\)\s*<\/(?:b|strong)>/i);
  if (nm) return { kind: "num", id: nm[1] };
  return null;
}

function isSectionHeader(el) {
  const t = normalizeCellText(el);
  return SECTION_HEADERS.test(t);
}

function blockHasVisibleContent(el) {
  if (!el) return false;
  const t = normalizeCellText(el);
  if (t && !SECTION_HEADERS.test(t)) return true;
  return !!el.querySelector("img, svg, mjx-container, p, span");
}

function collectFlatBlocks(root) {
  // Только «листовые» .task-html-block — без вложенных .task-html-block.
  // Иначе попадает одна внешняя обёртка и парсер ничего не видит.
  const all = [...root.querySelectorAll(".task-html-block")];
  const leaves = all.filter((el) => !el.querySelector(".task-html-block"));
  if (leaves.length >= 2) return leaves;
  return all.length ? all : [...root.children];
}

function parseMatchingBlocks(blocks) {
  const intro = [];
  const items = [];
  let section = null;
  let pendingLabel = null;

  for (const block of blocks) {
    const blockText = normalizeCellText(block);
    if (SECTION_HEADERS.test(blockText)) {
      section = blockText.toUpperCase();
      pendingLabel = null;
      continue;
    }

    const headerEl = block.querySelector("b, strong");
    if (headerEl && isSectionHeader(headerEl) && blockText.length < 24) {
      section = normalizeCellText(headerEl).toUpperCase();
      pendingLabel = null;
      continue;
    }

    const labelEl = block.querySelector(":scope > b, :scope > strong");
    let label = labelFromElement(labelEl);
    if (!label && blockText.length <= 4) {
      label = labelFromElement(block);
    }

    if (label) {
      pendingLabel = { ...label, section };
      continue;
    }

    if (pendingLabel && blockHasVisibleContent(block)) {
      const clone = block.cloneNode(true);
      clone.querySelectorAll("b, strong").forEach((tag) => {
        if (labelFromElement(tag)) tag.remove();
      });
      let body = clone.innerHTML.trim();
      body = body.replace(new RegExp(`^\\s*${pendingLabel.id}\\)\\s*`, "i"), "").trim();
      if (body) {
        items.push({
          ...pendingLabel,
          bodyHtml: body,
        });
      }
      pendingLabel = null;
      continue;
    }

    if (!section && blockHasVisibleContent(block)) {
      intro.push(block.innerHTML.trim());
    }
  }

  return { intro, items };
}

/** Строка с рисунком координатной плоскости — «график», иначе формула/функция. */
function itemIsGraph(bodyHtml) {
  return /<img\b/i.test(bodyHtml || "");
}

function sortMatchingItems(items) {
  return [...items].sort((a, b) => {
    const aNum = a.kind === "num" ? Number(a.id) : 0;
    const bNum = b.kind === "num" ? Number(b.id) : 0;
    if (a.kind === "num" && b.kind === "num") return aNum - bNum;
    if (a.kind === "letter" && b.kind === "letter") {
      return String(a.id).localeCompare(String(b.id), "ru");
    }
    return a.kind === "letter" ? -1 : 1;
  });
}

function formulaRowTitle(introHtml, items) {
  // Заголовок берём только из заголовков секций (не из вводного текста:
  // «графики функций вида y=kx+b» не означает строку «Функции»).
  const sections = items
    .filter((it) => !itemIsGraph(it.bodyHtml))
    .map((it) => it.section || "")
    .join(" ");
  if (/ФОРМУЛ/i.test(sections)) return "Формулы";
  if (/ФУНКЦ/i.test(sections)) return "Функции";
  if (/КОЭФФИЦИЕНТ/i.test(sections)) return "Коэффициенты";
  return /знак\S*\s+коэффициент/i.test(introHtml || "") ? "Коэффициенты" : "Формулы";
}

function appendMatchingRow(wrap, rowClass, titleText, rowItems, itemClass) {
  if (rowItems.length < 2) return;
  const row = document.createElement("div");
  row.className = `oge-math-matching-row ${rowClass}`;

  const title = document.createElement("div");
  title.className = "oge-math-matching-row__title";
  title.textContent = titleText;
  row.appendChild(title);

  const strip = document.createElement("div");
  strip.className = `oge-math-matching-strip${itemClass === "graph" ? " oge-math-matching-strip--graphs" : ""}`;

  for (const { id, kind, bodyHtml } of sortMatchingItems(rowItems)) {
    const card = document.createElement("div");
    card.className = `oge-math-matching-item oge-math-matching-item--${itemClass}`;

    const numEl = document.createElement("span");
    numEl.className = "oge-math-matching-item__label";
    numEl.textContent = kind === "letter" ? `${id})` : String(id);

    const body = document.createElement("div");
    body.className = "oge-math-matching-item__body";
    body.innerHTML = bodyHtml;

    card.appendChild(numEl);
    card.appendChild(body);
    strip.appendChild(card);
  }
  row.appendChild(strip);
  wrap.appendChild(row);
}

/** Таблица ответа ОГЭ №11: строка А Б В и пустая строка для номеров графиков. */
function appendAnswerGrid(wrap, formulaItems) {
  const letters = sortMatchingItems(
    formulaItems.filter((it) => it.kind === "letter")
  ).map((it) => it.id);
  if (letters.length < 2) return;

  const grid = document.createElement("div");
  grid.className = "oge-math-matching-answer-grid";

  const table = document.createElement("table");
  table.className = "oge-math-matching-answer-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const letter of letters) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = letter;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const bodyRow = document.createElement("tr");
  for (const _letter of letters) {
    const td = document.createElement("td");
    const cell = document.createElement("span");
    cell.className = "oge-math-matching-answer-cell";
    cell.setAttribute("aria-hidden", "true");
    td.appendChild(cell);
    bodyRow.appendChild(td);
  }
  tbody.appendChild(bodyRow);
  table.appendChild(tbody);

  grid.appendChild(table);
  wrap.appendChild(grid);
}

function mightBeMatchingTaskHtml(html) {
  if (!html || typeof html !== "string") return false;
  const s = html;
  if (!/КОЭФФИЦИЕНТ|ГРАФИК|ФОРМУЛ/i.test(s) && !/ФУНКЦИ/i.test(s)) return false;
  if (!LETTER_LABEL_RE.test(s.replace(/<[^>]+>/g, " ")) && !/[А-Я]\)/.test(s)) return false;
  const hasLetter = /<(?:b|strong)[^>]*>\s*[А-ЯA-Z]\)/i.test(s);
  const hasNum = /<(?:b|strong)[^>]*>\s*\d+\)/i.test(s);
  const hasImg = /<img\b/i.test(s);
  return hasLetter && hasNum && hasImg;
}

function buildMatchingMarkup(introHtml, items, footerHtml) {
  const wrap = document.createElement("div");
  wrap.className = "oge-math-matching-task";

  if (introHtml?.trim()) {
    const q = document.createElement("div");
    q.className = "oge-math-matching-question";
    q.innerHTML = introHtml.trim();
    wrap.appendChild(q);
  }

  const graphItems = items.filter((it) => itemIsGraph(it.bodyHtml));
  const formulaItems = items.filter((it) => !itemIsGraph(it.bodyHtml));

  appendMatchingRow(
    wrap,
    "oge-math-matching-row--graphs",
    "Графики",
    graphItems,
    "graph"
  );
  appendMatchingRow(
    wrap,
    "oge-math-matching-row--formulas",
    formulaRowTitle(introHtml, items),
    formulaItems,
    "formula"
  );

  if (footerHtml?.trim()) {
    const foot = document.createElement("p");
    foot.className = "oge-math-matching-footer";
    foot.innerHTML = footerHtml.trim();
    wrap.appendChild(foot);
  }

  // Буквы А) Б) В) могут стоять и у графиков (ГРАФИКИ А–В / ФОРМУЛЫ 1–3).
  appendAnswerGrid(wrap, items);

  return wrap.outerHTML;
}

/**
 * @param {string} html
 * @returns {string}
 */
export function formatOgeMathMatchingTaskHtml(html) {
  if (html == null || typeof html !== "string") return html;
  const trimmed = html.trim();
  if (!trimmed) return html;

  if (formatCache.has(trimmed)) return formatCache.get(trimmed);
  if (/\boge-math-matching-task\b/i.test(trimmed)) {
    formatCache.set(trimmed, html);
    return html;
  }

  if (!mightBeMatchingTaskHtml(trimmed)) {
    formatCache.set(trimmed, html);
    return html;
  }

  const root = parseHtmlFragment(trimmed);
  if (!root) {
    formatCache.set(trimmed, html);
    return html;
  }

  let footerHtml = "";
  const footerMatch = trimmed.match(
    /(<\/div>\s*)+(В\s+таблице[\s\S]*?)\s*$/i
  );
  if (footerMatch) {
    footerHtml = footerMatch[2];
  }

  const blocks = collectFlatBlocks(root);
  const { intro, items } = parseMatchingBlocks(blocks);

  const graphCount = items.filter((it) => itemIsGraph(it.bodyHtml)).length;
  const formulaCount = items.length - graphCount;
  if (graphCount < 2 || formulaCount < 2) {
    formatCache.set(trimmed, html);
    return html;
  }

  const built = buildMatchingMarkup(intro.join(""), items, footerHtml);
  formatCache.set(trimmed, built);
  return built;
}
