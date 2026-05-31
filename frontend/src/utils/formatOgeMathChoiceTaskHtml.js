/**
 * FIPI / CKEditor 5: вложенные <table> с условием и вариантами «1) … 4) …»
 * → карточки на сайте.
 *
 * ВАЖНО для CKEditor:
 * - В БД хранится исходный HTML (таблицы из импорта или правок в админке).
 * - Эта функция вызывается только при показе (MathContent), в поле не записывается.
 * - Классы oge-math-choice-* в редактор не сохраняйте — после сохранения разметка снова таблицами.
 */

const CHOICE_NUM_RE = /^(\d+)\)\s*$/;

const formatCache = new Map();
const FORMAT_CACHE_MAX = 48;

function mightBeChoiceTaskHtml(html) {
  if (!/<table\b/i.test(html)) return false;
  const boldChoice = (n) =>
    new RegExp(`<(?:b|strong)[^>]*>\\s*${n}\\)`, "i").test(html);
  if (boldChoice(1) && boldChoice(2)) return true;
  return (
    /<t[dh]\b[^>]*>[\s\S]*?\b1\)/i.test(html) &&
    /<t[dh]\b[^>]*>[\s\S]*?\b2\)/i.test(html)
  );
}

function cacheFormatResult(trimmed, result) {
  if (formatCache.size >= FORMAT_CACHE_MAX) formatCache.clear();
  formatCache.set(trimmed, result);
  return result;
}

function parseHtmlFragment(html) {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(
    `<div class="oge-math-choice-parse-root">${html}</div>`,
    "text/html"
  );
  return doc.querySelector(".oge-math-choice-parse-root");
}

function normalizeCellText(el) {
  return (el?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasVisibleContent(el) {
  if (!el) return false;
  if (normalizeCellText(el)) return true;
  return !!el.querySelector(
    "img, svg, mjx-container, figure, .math-inline, .math-display, mjx-math, [class*='math-']"
  );
}

function htmlHasVisibleText(html) {
  if (!html || !String(html).trim()) return false;
  const stripped = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/[а-яёa-z0-9]/i.test(stripped)) return true;
  return /<(img|svg|mjx-container|math-inline|math-display)\b/i.test(html);
}

/** CKEditor 5: <figure class="table"> оборачивает таблицы; <b> → <strong> — textContent ок. */
function normalizeCkEditorMarkup(root) {
  root.querySelectorAll("figure").forEach((fig) => {
    const table = fig.querySelector(":scope > table");
    if (table) fig.replaceWith(table);
  });

  root.querySelectorAll("p").forEach((p) => {
    const html = (p.innerHTML || "").replace(/\s/g, "").toLowerCase();
    if (html === "<br>" || html === "<br/>" || html === "&nbsp;" || html === "") {
      const hasMedia = p.querySelector("img, svg, mjx-container, figure");
      if (!hasMedia) p.remove();
    }
  });

  stripTrailingEmptyTableRows(root);
  stripTrailingEmptyTaskBlocks(root);
}

/** Пустая последняя строка таблицы (типично у ФИПИ). */
function stripTrailingEmptyTableRows(root) {
  root.querySelectorAll("table").forEach((table) => {
    let rows = tableDirectRows(table);
    while (rows.length > 0 && !hasVisibleContent(rows[rows.length - 1])) {
      rows[rows.length - 1].remove();
      rows = tableDirectRows(table);
    }
  });
}

function stripTrailingEmptyTaskBlocks(root) {
  let blocks = [...root.querySelectorAll(":scope > .task-html-block")];
  while (blocks.length > 0 && !hasVisibleContent(blocks[blocks.length - 1])) {
    blocks[blocks.length - 1].remove();
    blocks = [...root.querySelectorAll(":scope > .task-html-block")];
  }
}

function tableDirectRows(table) {
  const body = table.querySelector(":scope > tbody") || table;
  return [...body.querySelectorAll(":scope > tr")];
}

function rowChoiceNumber(tr) {
  const first = tr.querySelector(":scope > td, :scope > th");
  if (!first) return null;
  const raw = normalizeCellText(first);
  let m = raw.match(CHOICE_NUM_RE);
  if (m) return m[1];
  m = raw.match(/^(\d+)\)\s+/);
  if (m) return m[1];
  const inner = first.innerHTML || "";
  const bm = inner.match(/<(?:b|strong)[^>]*>\s*(\d+)\)\s*<\/(?:b|strong)>/i);
  return bm ? bm[1] : null;
}

function isChoiceOptionsTable(table) {
  const rows = tableDirectRows(table);
  const numbered = rows.filter((tr) => rowChoiceNumber(tr) != null);
  return numbered.length >= 2;
}

/** Таблица с вариантами: предпочитаем самую вложенную; при «плоской» CKEditor-таблице — ту же. */
function findChoiceOptionsTable(root) {
  const tables = [...root.querySelectorAll("table")];
  let best = null;
  let bestDepth = -1;

  for (const table of tables) {
    if (!isChoiceOptionsTable(table)) continue;
    let depth = 0;
    let p = table.parentElement;
    while (p && p !== root) {
      depth += 1;
      p = p.parentElement;
    }
    if (depth > bestDepth) {
      bestDepth = depth;
      best = table;
    }
  }
  return best;
}

/** Удаляем только строки 1) 2) … — условие в той же таблице (после CKEditor) не теряется. */
function extractAndRemoveChoiceRows(table) {
  const items = [];
  for (const tr of [...tableDirectRows(table)]) {
    const num = rowChoiceNumber(tr);
    if (num == null) continue;

    const cells = [...tr.querySelectorAll(":scope > td, :scope > th")];
    let bodyCell = cells[1] || cells[0];
    let bodyHtml = (bodyCell?.innerHTML || "").trim();

    if (cells.length === 1 && bodyHtml) {
      bodyHtml = bodyHtml
        .replace(/<(?:b|strong)[^>]*>\s*\d+\)\s*<\/(?:b|strong)>/gi, "")
        .trim();
    }

    if (!bodyHtml) continue;
    items.push({ num, bodyHtml });
    tr.remove();
  }
  return items;
}

function removeEmptyTableElement(table) {
  if (!hasVisibleContent(table)) table.remove();
}

function pruneEmptyNodes(root) {
  let changed = true;
  while (changed) {
    changed = false;

    root.querySelectorAll("table").forEach((t) => {
      if (!hasVisibleContent(t)) {
        t.remove();
        changed = true;
      }
    });

    root.querySelectorAll("div").forEach((d) => {
      if (d === root || d.classList.contains("oge-math-choice-parse-root")) return;
      if (!hasVisibleContent(d) && d.children.length === 0) {
        d.remove();
        changed = true;
      }
    });

    root.querySelectorAll("p").forEach((p) => {
      if (!hasVisibleContent(p)) {
        p.remove();
        changed = true;
      }
    });

    root.querySelectorAll("tr").forEach((tr) => {
      if (!hasVisibleContent(tr)) {
        tr.remove();
        changed = true;
      }
    });
  }
}

function unwrapRedundantSingleCellTables(root) {
  let changed = true;
  while (changed) {
    changed = false;
    root.querySelectorAll("table").forEach((table) => {
      const rows = tableDirectRows(table);
      if (rows.length !== 1) return;
      const cells = rows[0].querySelectorAll(":scope > td, :scope > th");
      if (cells.length !== 1) return;
      const cell = cells[0];
      const frag = document.createDocumentFragment();
      while (cell.firstChild) frag.appendChild(cell.firstChild);
      table.replaceWith(frag);
      changed = true;
    });
  }
}

function choiceNumFromElement(el) {
  if (!el) return null;
  const raw = normalizeCellText(el);
  let m = raw.match(CHOICE_NUM_RE);
  if (m) return m[1];
  m = raw.match(/^(\d+)\)\s+/);
  if (m) return m[1];
  const inner = el.innerHTML || "";
  const bm = inner.match(/<(?:b|strong)[^>]*>\s*(\d+)\)\s*<\/(?:b|strong)>/i);
  return bm ? bm[1] : null;
}

function extractChoicesFromRoot(root) {
  const choiceTable = findChoiceOptionsTable(root);
  if (!choiceTable) return null;
  const choices = extractAndRemoveChoiceRows(choiceTable);
  if (choices.length < 2) return null;
  removeEmptyTableElement(choiceTable);
  stripTrailingEmptyTableRows(root);
  pruneEmptyNodes(root);
  unwrapRedundantSingleCellTables(root);
  pruneEmptyNodes(root);
  stripTrailingEmptyTableRows(root);
  stripTrailingEmptyTaskBlocks(root);
  return {
    choices,
    questionHtml: root.innerHTML.trim(),
  };
}

/** После flatten_fipi_layout_markup: варианты в .task-html-block, не в <table>. */
function formatFromTaskHtmlBlocks(root) {
  const blocks = [
    ...root.querySelectorAll(":scope > .task-html-block"),
    ...root.querySelectorAll(":scope > div.task-html-block"),
  ];
  if (blocks.length < 2) return null;

  const nested = extractChoicesFromRoot(root);
  if (nested) {
    return buildChoiceMarkup(nested.questionHtml, nested.choices);
  }

  const questionParts = [];
  const choices = [];

  while (blocks.length > 0 && !hasVisibleContent(blocks[blocks.length - 1])) {
    blocks.pop();
  }

  for (const block of blocks) {
    const innerTable = block.querySelector("table");
    if (innerTable && isChoiceOptionsTable(innerTable)) {
      const innerChoices = extractAndRemoveChoiceRows(innerTable);
      if (innerChoices.length >= 2) {
        choices.push(...innerChoices);
        const rest = block.cloneNode(true);
        innerTable.remove();
        if (hasVisibleContent(rest)) {
          questionParts.push(rest.innerHTML.trim());
        }
        continue;
      }
    }

    const num = choiceNumFromElement(block);
    if (num != null) {
      const clone = block.cloneNode(true);
      clone.querySelectorAll("b, strong").forEach((tag) => {
        if (normalizeCellText(tag) === `${num})`) tag.remove();
      });
      let bodyHtml = clone.innerHTML.trim();
      bodyHtml = bodyHtml.replace(new RegExp(`^\\s*${num}\\)\\s*`), "").trim();
      if (bodyHtml) choices.push({ num, bodyHtml });
    } else if (hasVisibleContent(block)) {
      questionParts.push(block.innerHTML.trim());
    }
  }

  if (choices.length < 2) return null;
  const questionHtml = questionParts.join("");
  return buildChoiceMarkup(questionHtml, choices);
}

/** Крошечные gif с ФИПИ (innerimg0…) — не растягивать по ширине карточки. */
function decorateFipiBitmapImages(root, mode) {
  if (!root) return;
  root.querySelectorAll("img").forEach((img) => {
    const src = (img.getAttribute("src") || "").toLowerCase();
    if (!src.endsWith(".gif")) return;
    img.classList.add("oge-math-fipi-bitmap");
    img.removeAttribute("width");
    img.removeAttribute("height");
    if (mode !== "question" || img.closest(".oge-math-fipi-formula")) return;
    const box = document.createElement("span");
    box.className = "oge-math-fipi-formula";
    img.parentNode?.insertBefore(box, img);
    box.appendChild(img);
  });
}

function buildChoiceMarkup(questionHtml, choices) {
  const wrap = document.createElement("div");
  wrap.className = "oge-math-choice-task";

  const qHtml = (questionHtml || "").trim();
  if (qHtml && htmlHasVisibleText(qHtml)) {
    const q = document.createElement("div");
    q.className = "oge-math-choice-question";
    q.innerHTML = qHtml;
    decorateFipiBitmapImages(q, "question");
    wrap.appendChild(q);
  }

  const list = document.createElement("ol");
  list.className = "oge-math-choice-options";
  list.setAttribute("role", "list");

  for (const { num, bodyHtml } of choices) {
    const li = document.createElement("li");
    li.className = "oge-math-choice-option";

    const numEl = document.createElement("span");
    numEl.className = "oge-math-choice-option__num";
    numEl.setAttribute("aria-hidden", "true");
    numEl.textContent = num;

    const body = document.createElement("span");
    body.className = "oge-math-choice-option__body";
    body.innerHTML = bodyHtml;
    decorateFipiBitmapImages(body, "option");

    li.appendChild(numEl);
    li.appendChild(body);
    list.appendChild(li);
  }

  wrap.appendChild(list);
  return wrap.outerHTML;
}

/**
 * @param {string} html — как в task_template из БД (CKEditor / импорт ФИПИ)
 * @returns {string} — только для отображения, не для сохранения в CKEditor
 */
export function formatOgeMathChoiceTaskHtml(html) {
  if (html == null || typeof html !== "string") return html;
  const trimmed = html.trim();
  if (!trimmed) return html;

  if (formatCache.has(trimmed)) return formatCache.get(trimmed);

  if (/\boge-math-choice-task\b/i.test(trimmed)) {
    return cacheFormatResult(trimmed, html);
  }

  const root = parseHtmlFragment(trimmed);
  if (!root) return cacheFormatResult(trimmed, html);

  normalizeCkEditorMarkup(root);

  if (/task-html-block/i.test(trimmed)) {
    const fromBlocks = formatFromTaskHtmlBlocks(root);
    if (fromBlocks && htmlHasVisibleText(fromBlocks)) {
      return cacheFormatResult(trimmed, fromBlocks);
    }
  }

  if (!mightBeChoiceTaskHtml(trimmed)) {
    return cacheFormatResult(trimmed, html);
  }

  const choiceTable = findChoiceOptionsTable(root);
  if (!choiceTable) {
    const fromBlocks = formatFromTaskHtmlBlocks(root);
    if (fromBlocks && htmlHasVisibleText(fromBlocks)) {
      return cacheFormatResult(trimmed, fromBlocks);
    }
    return cacheFormatResult(trimmed, html);
  }

  const extracted = extractChoicesFromRoot(root);
  if (!extracted) return cacheFormatResult(trimmed, html);

  const { choices, questionHtml } = extracted;
  const built = buildChoiceMarkup(questionHtml, choices);
  if (!htmlHasVisibleText(built)) return cacheFormatResult(trimmed, html);
  return cacheFormatResult(trimmed, built);
}
