/**
 * FIPI / CKEditor 5: вложенные <table> с условием и вариантами «1) … 4) …»
 * → карточки на сайте.
 *
 * ВАЖНО для CKEditor:
 * - В БД хранится исходный HTML (таблицы из импорта или правок в админке).
 * - Эта функция вызывается только при показе (MathContent), в поле не записывается.
 * - Классы oge-math-choice-* в редактор не сохраняйте — после сохранения разметка снова таблицами.
 */

import { parseTaskHtmlFragment } from "./parseTaskHtmlFragment";

const CHOICE_NUM_RE = /^(\d+)(?:\\)?\)\s*$/;

const formatCache = new Map();
const FORMAT_CACHE_MAX = 48;

/** process_latex иногда превращает «2)» в «2\)» внутри <b> — без этого варианты не распознаются. */
function repairLatexEscapedChoiceLabels(html) {
  if (!html || typeof html !== "string") return html;
  return html.replace(
    /(<(?:b|strong)[^>]*>\s*)(\d+)\\\)(\s*<\/(?:b|strong)>)/gi,
    "$1$2)$3"
  );
}

function mightBeChoiceTaskHtml(html) {
  if (!/<table\b/i.test(html)) return false;
  const boldChoice = (n) =>
    new RegExp(`<(?:b|strong)[^>]*>\\s*${n}(?:\\\\)?\\)`, "i").test(html);
  if (boldChoice(1) && boldChoice(2)) return true;
  return (
    /<t[dh]\b[^>]*>[\s\S]*?\b1(?:\\)?\)/i.test(html) &&
    /<t[dh]\b[^>]*>[\s\S]*?\b2(?:\\)?\)/i.test(html)
  );
}

function cacheFormatResult(trimmed, result) {
  if (formatCache.size >= FORMAT_CACHE_MAX) formatCache.clear();
  formatCache.set(trimmed, result);
  return result;
}

function parseHtmlFragment(html) {
  return parseTaskHtmlFragment(html, "oge-math-choice-parse-root");
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
export function normalizeCkEditorMarkup(root) {
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
  const cells = [...tr.querySelectorAll(":scope > td, :scope > th")];
  for (const cell of cells) {
    const num = choiceNumFromElement(cell);
    if (num != null) return num;
  }
  return null;
}

/** FIPI: пустая ячейка | <b>1)</b> | тело варианта; CKEditor: одна ячейка «1) …». */
function findChoiceRowParts(tr) {
  const cells = [...tr.querySelectorAll(":scope > td, :scope > th")];
  let num = null;
  let labelIdx = -1;
  for (let i = 0; i < cells.length; i++) {
    const n = choiceNumFromElement(cells[i]);
    if (n != null) {
      num = n;
      labelIdx = i;
      break;
    }
  }
  if (num == null) return null;

  let bodyHtml = "";
  for (let i = labelIdx + 1; i < cells.length; i++) {
    const html = (cells[i]?.innerHTML || "").trim();
    if (html) {
      bodyHtml = html;
      break;
    }
  }

  if (!bodyHtml && cells.length === 1) {
    bodyHtml = (cells[0].innerHTML || "")
      .replace(/<(?:b|strong)[^>]*>\s*\d+(?:\\)?\)\s*<\/(?:b|strong)>/gi, "")
      .trim();
  }

  if (!bodyHtml) return null;
  return { num, bodyHtml };
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
    const parts = findChoiceRowParts(tr);
    if (!parts) continue;
    items.push(parts);
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
  m = raw.match(/^(\d+)(?:\\)?\)\s+/);
  if (m) return m[1];
  const inner = el.innerHTML || "";
  const bm = inner.match(/<(?:b|strong)[^>]*>\s*(\d+)(?:\\)?\)\s*<\/(?:b|strong)>/i);
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
        const label = normalizeCellText(tag);
        if (label === `${num})` || label === `${num}\\)`) tag.remove();
      });
      let bodyHtml = clone.innerHTML.trim();
      bodyHtml = bodyHtml.replace(new RegExp(`^\\s*${num}(?:\\\\)?\\)\\s*`), "").trim();
      if (bodyHtml) choices.push({ num, bodyHtml });
    } else if (hasVisibleContent(block)) {
      questionParts.push(block.innerHTML.trim());
    }
  }

  if (choices.length < 2) return null;
  const questionHtml = questionParts.join("");
  return buildChoiceMarkup(questionHtml, choices);
}

function isOptionPointLetterImg(img) {
  const host = img.closest(".oge-math-choice-option__body, p, td, li");
  if (!host) return false;
  const text = normalizeCellText(host).replace(/\s+/g, " ").trim();
  return /^точка(\s+[a-d])?$/i.test(text);
}

/** Рисунок/схема — единственная картинка в абзаце без текста (дерево вероятностей и т.п.). */
function isFipiDiagramImage(img) {
  const p = img?.closest?.("p");
  if (!p) return false;
  const imgs = [...p.querySelectorAll("img")];
  if (imgs.length !== 1 || imgs[0] !== img) return false;
  return normalizeCellText(p).length === 0;
}

/** Крошечные gif/PNG ФИПИ — дроби в строке условия vs числовая прямая. */
function decorateFipiBitmapImages(root, mode) {
  if (!root) return;
  root.querySelectorAll("img").forEach((img) => {
    if (img.classList.contains("ege-inf-1-graph-img")) return;
    const src = (img.getAttribute("src") || "").toLowerCase();
    const parent = img.parentElement;
    const inlineFrac =
      mode === "question" &&
      src.includes("xs3qstsrc") &&
      parent?.tagName === "SPAN" &&
      (parent.closest("p")?.querySelectorAll('img[src*="xs3qstsrc"]').length ?? 0) > 1;
    if (inlineFrac) {
      img.classList.add("oge-math-fipi-inline-frac");
      img.removeAttribute("width");
      img.removeAttribute("height");
      return;
    }
    const inlineLetter =
      src.includes("innerimg") &&
      parent?.tagName === "SPAN" &&
      (parent.closest("p")?.querySelectorAll('img[src*="innerimg"]').length ?? 0) > 1;
    if (inlineLetter) {
      img.classList.add("oge-math-fipi-inline-letter");
      img.removeAttribute("width");
      img.removeAttribute("height");
      return;
    }
    const soloInnerimgFrac =
      mode === "question" &&
      src.includes("innerimg") &&
      parent?.tagName === "SPAN" &&
      (parent.closest("p")?.querySelectorAll('img[src*="innerimg"]').length ?? 0) === 1;
    if (soloInnerimgFrac) {
      img.classList.add("oge-math-fipi-inline-frac");
      img.removeAttribute("width");
      img.removeAttribute("height");
      return;
    }
    if (mode === "option" && src.includes("innerimg")) {
      const cls = isOptionPointLetterImg(img)
        ? "oge-math-fipi-inline-letter"
        : "oge-math-fipi-inline-frac";
      img.classList.add(cls);
      img.removeAttribute("width");
      img.removeAttribute("height");
    }
    if (mode === "option" && src.includes("xs3qstsrc")) {
      img.classList.add("oge-math-fipi-inline-frac");
      img.removeAttribute("width");
      img.removeAttribute("height");
    }
    if (!src.endsWith(".gif")) return;
    if (mode === "question" && isFipiDiagramImage(img)) {
      img.classList.add("oge-math-fipi-bitmap", "oge-math-fipi-diagram");
      img.removeAttribute("width");
      img.removeAttribute("height");
      return;
    }
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

/** Разметка FIPI-картинок в обычных заданиях (не только с вариантами ответа). */
export function decorateFipiTaskImages(root) {
  decorateFipiBitmapImages(root, "question");
}

function normalizeImageSrc(rawSrc) {
  const s = String(rawSrc || "").trim();
  if (!s) return "";
  return s.replace(/[?#].*$/, "");
}

function collectChoiceImageSrcSet(choices) {
  const srcSet = new Set();
  for (const { bodyHtml } of choices || []) {
    const frag = parseHtmlFragment(bodyHtml || "");
    if (!frag) continue;
    frag.querySelectorAll("img").forEach((img) => {
      const src = normalizeImageSrc(img.getAttribute("src"));
      if (src) srcSet.add(src);
    });
  }
  return srcSet;
}

function isImageOnlyNodeForChoice(node, choiceSrcSet) {
  if (!node || !choiceSrcSet || choiceSrcSet.size === 0) return false;
  const imgs = [...node.querySelectorAll("img")];
  if (!imgs.length) return false;
  const srcs = imgs.map((img) => normalizeImageSrc(img.getAttribute("src"))).filter(Boolean);
  if (!srcs.length) return false;
  const matched = srcs.filter((src) => choiceSrcSet.has(src)).length;
  if (matched !== srcs.length) return false;
  const text = normalizeCellText(node).replace(/\b\d+\)?\b/g, "").trim();
  return text.length === 0;
}

function repairBareFipiInnerimgSrc(html, folderId) {
  if (!html || !folderId) return html;
  const fid = String(folderId).toUpperCase();
  return String(html).replace(
    /((?:src|href)\s*=\s*["'])([^"']*task_files\/)innerimg([0-4])\.gif(["'])/gi,
    (match, prefix, path, num, quote) => {
      const target = `${path}${fid}_innerimg${num}.gif`;
      if (match.includes(`${fid}_innerimg`)) return match;
      return `${prefix}${target}${quote}`;
    }
  );
}

function extractFipiFolderFromHtml(html) {
  const folders = new Set();
  const re = /([A-F0-9]{32})_innerimg[0-4]\.gif/gi;
  let m;
  const s = String(html || "");
  while ((m = re.exec(s)) !== null) folders.add(m[1].toUpperCase());
  const qm = s.match(/questions\/([A-F0-9]{32})\/innerimg/gi) || [];
  for (const hit of qm) {
    const id = hit.match(/([A-F0-9]{32})/i)?.[1];
    if (id) folders.add(id.toUpperCase());
  }
  return folders.size === 1 ? [...folders][0] : null;
}

const CHOICE_INSTRUCTION_RE = /^выберите\s+правильн/i;

function scrubChoiceQuestionDebris(root) {
  if (!root) return;
  root.querySelectorAll("p, div").forEach((el) => {
    const t = normalizeCellText(el);
    if (t === "." || t === "·" || t === ",") {
      el.remove();
      return;
    }
    if (CHOICE_INSTRUCTION_RE.test(t) && !el.querySelector("img, table, mjx-container")) {
      el.remove();
    }
  });
  stripTrailingEmptyTableRows(root);
  unwrapRedundantSingleCellTables(root);
  pruneEmptyNodes(root);
}

function stripChoiceImagesFromQuestionRoot(root, choiceSrcSet) {
  if (!root || !choiceSrcSet || choiceSrcSet.size === 0) return;

  let changed = true;
  while (changed) {
    changed = false;

    for (const img of [...root.querySelectorAll("img")]) {
      const src = normalizeImageSrc(img.getAttribute("src"));
      if (!src || !choiceSrcSet.has(src)) continue;
      const host = img.closest("p, td, th, figure, div, span") || img;
      if (host === root) {
        img.remove();
      } else if (host.querySelectorAll("img").length <= 1 && normalizeCellText(host).length === 0) {
        host.remove();
      } else {
        img.remove();
      }
      changed = true;
    }

    for (const table of [...root.querySelectorAll("table")]) {
      const rows = tableDirectRows(table);
      const mediaRows = rows.filter((tr) => isImageOnlyNodeForChoice(tr, choiceSrcSet));
      if (rows.length >= 2 && mediaRows.length >= 2 && mediaRows.length === rows.length) {
        table.remove();
        changed = true;
        continue;
      }
      if (rows.length === 1 && isImageOnlyNodeForChoice(rows[0], choiceSrcSet)) {
        table.remove();
        changed = true;
      }
    }

    for (const child of [...root.children]) {
      if (isImageOnlyNodeForChoice(child, choiceSrcSet)) {
        child.remove();
        changed = true;
      }
    }
  }
}

function stripDuplicateChoiceMediaFromQuestion(questionHtml, choices) {
  const qHtml = String(questionHtml || "").trim();
  if (!qHtml) return qHtml;
  const choiceSrcSet = collectChoiceImageSrcSet(choices);
  if (choiceSrcSet.size === 0) return qHtml;

  const root = parseHtmlFragment(qHtml);
  if (!root) return qHtml;

  // Удаляем «галереи» вариантов и любые картинки из 1) 2) 3) 4) в условии.
  stripChoiceImagesFromQuestionRoot(root, choiceSrcSet);

  stripTrailingEmptyTableRows(root);
  stripTrailingEmptyTaskBlocks(root);
  pruneEmptyNodes(root);
  return root.innerHTML.trim();
}

const CHOICE_FOOTER_TEXT_RE = /^В\s+ответ/i;
const CHOICE_PROMPT_TEXT_RE = /^Как(?:ое это\s+число|ая это\s+точка)\??$/i;
const CHOICE_PROMPT_INLINE_RE = /(Какая это\s+точка\??|Какое это\s+число\??)\s*$/i;

const MATH_POINT_LETTERS = [
  ["\u{1D434}", "A"],
  ["\u{1D435}", "B"],
  ["\u{1D436}", "C"],
  ["\u{1D437}", "D"],
];

function isChoiceFooterElement(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag !== "P" && tag !== "DIV") return false;
  if (el.querySelector("img, table, ol, ul, mjx-container")) return false;
  const t = normalizeCellText(el);
  return CHOICE_FOOTER_TEXT_RE.test(t);
}

function extractChoiceFooter(root) {
  let footerHtml = "";

  function walk(el) {
    for (const node of [...el.childNodes]) {
      if (node.nodeType === 3) {
        const t = normalizeCellText(node);
        if (t && CHOICE_FOOTER_TEXT_RE.test(t)) {
          if (!footerHtml) footerHtml = t;
          node.remove();
        }
        continue;
      }
      if (node.nodeType !== 1) continue;
      if (isChoiceFooterElement(node)) {
        if (!footerHtml) footerHtml = normalizeCellText(node);
        node.remove();
        continue;
      }
      walk(node);
    }
  }

  walk(root);
  return footerHtml;
}

function extractChoiceQuestionPrompt(root) {
  let prompt = "";
  for (const p of [...root.querySelectorAll("p")]) {
    const t = normalizeCellText(p);
    if (!CHOICE_PROMPT_TEXT_RE.test(t)) continue;
    if (!prompt) prompt = t.endsWith("?") ? t : `${t}?`;
    p.remove();
  }
  return prompt;
}

function extractInlineChoicePrompt(root) {
  let prompt = "";
  for (const p of [...root.querySelectorAll("p")]) {
    if (p.querySelector("img")) continue;
    const t = normalizeCellText(p);
    const m = t.match(new RegExp(`^(.*?)[.\\s]+${CHOICE_PROMPT_INLINE_RE.source}$`, "i"));
    if (!m || m[1].trim().length < 12) continue;
    const promptText = m[2].endsWith("?") ? m[2] : `${m[2]}?`;
    if (!prompt) prompt = promptText;
    stripTrailingTextFromElement(p, m[2]);
    pruneEmptyNodes(p);
  }
  return prompt;
}

function collectTextNodes(el, out = []) {
  if (!el) return out;
  for (const node of el.childNodes) {
    if (node.nodeType === 3) out.push(node);
    else if (node.nodeType === 1) collectTextNodes(node, out);
  }
  return out;
}

function stripTrailingTextFromElement(el, suffix) {
  const target = String(suffix || "").replace(/\?+$/, "").trim();
  if (!target || !el) return;
  const re = new RegExp(`[\\s.]*${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\??\\s*$`, "i");
  const nodes = collectTextNodes(el);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const text = node.textContent || "";
    const match = text.match(re);
    if (!match) continue;
    node.textContent = text.slice(0, match.index).replace(/\s*\.\s*$/, "").trimEnd();
    for (let j = i + 1; j < nodes.length; j++) nodes[j].remove();
    break;
  }
}

function mathDelimiterPointLetter(inner) {
  const bare = String(inner || "")
    .replace(/<\/?i>/gi, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .trim();
  if (!bare) return null;
  for (const [ch, lat] of MATH_POINT_LETTERS) {
    if (bare === ch || bare === lat) return lat;
  }
  if (/^[A-D]$/i.test(bare)) return bare.toUpperCase();
  return null;
}

function normalizeMathPointLetters(root) {
  if (!root) return;
  let html = root.innerHTML;

  // «-0, 205» в LaTeX → «-0,205»
  html = html.replace(/(-?\d+),\s+(\d)/g, "$1,$2");

  html = html.replace(/\\\(([\s\S]*?)\\\)/g, (match, inner) => {
    const letter = mathDelimiterPointLetter(inner);
    return letter ? `<i>${letter}</i>` : match;
  });

  html = html.replace(
    /<span class="math-inline">\\\(([A-D])\\\)<\/span>/gi,
    "<i>$1</i>"
  );
  html = html.replace(
    /<mjx-container[^>]*>\s*<mjx-math[^>]*>\s*<mjx-mi[^>]*>([A-D])<\/mjx-mi>[\s\S]*?<\/mjx-container>/gi,
    "<i>$1</i>"
  );

  html = html.replace(/\s+и\s+/gi, " и ");
  html = html.replace(/\s+\./g, ".");
  html = html.replace(/\.{2,}/g, ".");
  root.innerHTML = html;
}

function cellTextValue(el) {
  if (el == null) return "";
  if (typeof el === "string") {
    return el.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
  return normalizeCellText(el);
}

function isSlashlessFracDigits(text) {
  return /^\d{4,5}$/.test(cellTextValue(text));
}

function detectSlashlessFracDenominator(texts) {
  const counts = new Map();
  for (const raw of texts) {
    const t = cellTextValue(raw);
    if (t.length !== 4) continue;
    const den = t.slice(-2);
    if (Number(den) >= 2 && Number(den) <= 99) {
      counts.set(den, (counts.get(den) || 0) + 1);
    }
  }
  let best = null;
  let bestCount = 0;
  for (const [den, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = den;
    }
  }
  return best;
}

function parseSlashlessFracDigits(text, preferredDen) {
  const t = cellTextValue(text);
  if (!isSlashlessFracDigits(t)) return null;

  if (preferredDen != null) {
    const denStr = String(preferredDen);
    if (t.endsWith(denStr)) {
      const num = t.slice(0, t.length - denStr.length);
      if (num.length >= 1 && Number(num) > 0) {
        return { num, den: denStr };
      }
    }
  }

  if (t.length === 4) {
    const den = t.slice(-2);
    const num = t.slice(0, 2);
    if (Number(den) >= 2 && Number(den) <= 99) {
      return { num, den };
    }
  }

  if (t.length === 5) {
    const den = t.slice(-2);
    const num = t.slice(0, 3);
    if (Number(den) >= 2 && Number(den) <= 99) {
      return { num, den };
    }
  }

  return null;
}

function slashlessFracToLatex(parts) {
  return `$\\frac{${parts.num}}{${parts.den}}$`;
}

function repairFipiSlashlessFracSpans(root) {
  const nodes = root.querySelectorAll(
    "p, span, div.task-html-block, li, .oge-math-choice-option__body"
  );
  for (const el of nodes) {
    if (el.querySelector("img, mjx-container, .math-inline, .math-display")) continue;

    const spans = [...el.querySelectorAll(":scope > span")];
    const fracSpans = spans.filter((span) => isSlashlessFracDigits(span));
    if (fracSpans.length >= 2) {
      const preferredDen = detectSlashlessFracDenominator(
        fracSpans.map((span) => cellTextValue(span))
      );
      for (const span of fracSpans) {
        const parts = parseSlashlessFracDigits(span, preferredDen);
        if (!parts) continue;
        span.outerHTML = slashlessFracToLatex(parts);
      }
      continue;
    }

    const text = cellTextValue(el);
    if (!isSlashlessFracDigits(text)) continue;
    const parts = parseSlashlessFracDigits(text, null);
    if (!parts) continue;
    el.innerHTML = slashlessFracToLatex(parts);
  }
}

function repairFipiSlashlessFracHtml(html) {
  const root = parseHtmlFragment(html);
  if (!root) return html || "";
  repairFipiSlashlessFracSpans(root);
  return root.innerHTML.trim();
}

function extractQuestionLatexFractions(questionHtml) {
  const fracs = [];
  const re = /\$\\frac\{(\d+)\}\{(\d+)\}\$/g;
  let m;
  const s = String(questionHtml || "");
  while ((m = re.exec(s)) !== null) {
    fracs.push(`$\\frac{${m[1]}}{${m[2]}}$`);
  }
  return fracs;
}

function isImageOnlyFracOptionBody(bodyHtml) {
  const root = parseHtmlFragment(bodyHtml);
  if (!root) return false;
  const imgs = root.querySelectorAll("img");
  if (imgs.length !== 1) return false;
  const src = (imgs[0].getAttribute("src") || "").toLowerCase();
  if (!src.includes("innerimg") && !src.includes("xs3qstsrc")) return false;
  const text = normalizeCellText(root).replace(/\s+/g, " ").trim();
  if (/^точка(\s+[a-d])?$/i.test(text)) return false;
  return text.length === 0;
}

/** PNG-дроби в вариантах → LaTeX из условия (58/13, 69/13, …). */
function repairChoiceOptionFracImagesFromQuestion(questionHtml, choices) {
  const fracs = extractQuestionLatexFractions(questionHtml);
  if (fracs.length < 2 || fracs.length !== choices.length) return choices;
  if (!choices.every((c) => isImageOnlyFracOptionBody(c.bodyHtml))) return choices;
  return choices.map((c, i) => ({ ...c, bodyHtml: fracs[i] }));
}

function isMathDelimiterHtml(html) {
  const t = String(html || "").trim();
  return /^\\\([\s\S]*\\\)$/.test(t) || /^\$[\s\S]*\$$/.test(t);
}

function flattenChoiceOptionBodyHtml(bodyHtml) {
  const root = parseHtmlFragment(bodyHtml);
  if (!root) return bodyHtml || "";
  root.querySelectorAll("p").forEach((p) => {
    const inner = (p.innerHTML || "").trim();
    if (isMathDelimiterHtml(inner)) {
      const span = document.createElement("span");
      span.innerHTML = inner;
      p.replaceWith(span);
      return;
    }
    const imgs = [...p.querySelectorAll("img")];
    if (imgs.length !== 1) return;
    if (normalizeCellText(p)) return;
    if (p.querySelector("mjx-container, .math-inline, .math-display")) return;
    p.replaceWith(imgs[0]);
  });
  root.querySelectorAll("span").forEach((span) => {
    if (span.attributes.length > 0) return;
    const imgs = [...span.querySelectorAll(":scope > img")];
    if (imgs.length !== 1 || span.childNodes.length !== 1) return;
    span.replaceWith(imgs[0]);
  });
  pruneEmptyNodes(root);
  return root.innerHTML.trim();
}

function unwrapLayoutTablesInQuestion(root) {
  let changed = true;
  while (changed) {
    changed = false;
    stripTrailingEmptyTableRows(root);
    for (const table of [...root.querySelectorAll("table")]) {
      const rows = tableDirectRows(table).filter((tr) => hasVisibleContent(tr));
      if (rows.length !== 1) continue;
      const cells = rows[0].querySelectorAll(":scope > td, :scope > th");
      if (cells.length !== 1) continue;
      const cell = cells[0];
      const frag = document.createDocumentFragment();
      while (cell.firstChild) frag.appendChild(cell.firstChild);
      table.replaceWith(frag);
      changed = true;
    }
  }
}

function prepareChoiceQuestionHtml(questionHtml) {
  const root = parseHtmlFragment(questionHtml);
  if (!root) return { questionHtml: questionHtml || "", footerHtml: "", promptText: "" };

  const footerHtml = extractChoiceFooter(root);
  let promptText = extractChoiceQuestionPrompt(root);
  if (!promptText) promptText = extractInlineChoicePrompt(root);
  scrubChoiceQuestionDebris(root);
  stripTrailingEmptyTableRows(root);
  unwrapRedundantSingleCellTables(root);
  unwrapLayoutTablesInQuestion(root);
  pruneEmptyNodes(root);
  stripTrailingEmptyTableRows(root);
  pruneEmptyNodes(root);
  repairFipiSlashlessFracSpans(root);
  normalizeMathPointLetters(root);

  return {
    questionHtml: root.innerHTML.trim(),
    footerHtml,
    promptText,
  };
}

function buildChoiceMarkup(questionHtml, choices) {
  const wrap = document.createElement("div");
  wrap.className = "oge-math-choice-task";

  const folderId = extractFipiFolderFromHtml(
    `${questionHtml || ""}${choices.map((c) => c.bodyHtml || "").join("")}`
  );
  let qHtml = stripDuplicateChoiceMediaFromQuestion(questionHtml, choices);
  if (folderId) {
    qHtml = repairBareFipiInnerimgSrc(qHtml, folderId);
    choices = choices.map(({ num, bodyHtml }) => ({
      num,
      bodyHtml: repairBareFipiInnerimgSrc(bodyHtml, folderId),
    }));
  }
  const prepared = prepareChoiceQuestionHtml(qHtml);
  qHtml = prepared.questionHtml;
  const footerHtml = prepared.footerHtml;
  const promptText = prepared.promptText;
  choices = repairChoiceOptionFracImagesFromQuestion(qHtml, choices);

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
    body.innerHTML = flattenChoiceOptionBodyHtml(repairFipiSlashlessFracHtml(bodyHtml));
    normalizeMathPointLetters(body);
    decorateFipiBitmapImages(body, "option");

    li.appendChild(numEl);
    li.appendChild(body);
    list.appendChild(li);
  }

  wrap.appendChild(list);

  if (promptText) {
    const prompt = document.createElement("p");
    prompt.className = "oge-math-choice-footer oge-math-choice-prompt";
    prompt.textContent = promptText;
    wrap.insertBefore(prompt, list);
  }

  if (footerHtml && htmlHasVisibleText(footerHtml)) {
    const foot = document.createElement("p");
    foot.className = "oge-math-choice-footer";
    foot.innerHTML = footerHtml;
    wrap.appendChild(foot);
  }

  return wrap.outerHTML;
}

/**
 * @param {string} html — как в task_template из БД (CKEditor / импорт ФИПИ)
 * @returns {string} — только для отображения, не для сохранения в CKEditor
 */
export function formatOgeMathChoiceTaskHtml(html) {
  if (html == null || typeof html !== "string") return html;
  const trimmed = repairLatexEscapedChoiceLabels(html.trim());
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
