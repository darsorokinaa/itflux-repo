import { memo, useEffect, useRef } from "react";
import { formatOgeInformaticsTask13Html } from "../utils/formatOgeInf13TaskHtml";
import { decorateFipiTaskImages, formatOgeMathChoiceTaskHtml } from "../utils/formatOgeMathChoiceTaskHtml";
import { formatOgeMathMatchingTaskHtml } from "../utils/formatOgeMathMatchingTaskHtml";
import { formatEgeInf22ParallelProcessesHtml } from "../utils/formatEgeInf22TaskHtml";
import { formatEgeInf2TruthTableHtml } from "../utils/formatEgeInf2TaskHtml";
import { formatEgeInf1RoadGraphHtml } from "../utils/formatEgeInf1TaskHtml";
import { stripFipiAttachedFileMarkup } from "../utils/formatEgeInfAttachedFileHtml";
import { formatOgeInf6TaskHtml } from "../utils/formatOgeInf6TaskHtml";
import { formatTaskCodeBlocksHtml } from "../utils/formatTaskCodeBlocksHtml";
import { formatFipiUnicodeMathHtml } from "../utils/formatFipiUnicodeMathHtml";

/** Снять слои &lt;…&gt; если HTML целиком попал в БД как экранированный текст. */
function decodeHtmlEntityLayersIfStoredEscaped(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  let cur = raw;
  for (let i = 0; i < 8; i++) {
    const t = cur.trimStart();
    if (!t.startsWith("&lt;") && !t.startsWith("&amp;lt;")) break;
    const textarea = document.createElement("textarea");
    textarea.innerHTML = cur;
    const next = textarea.value;
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/**
 * В старых задачах встречаются лишние экранирующие "\" перед символами
 * вроде #, +, ^, & (например "\#" или "\\&" из LaTeX). Убираем только этот частный случай.
 */
/** Бэкенд (старая версия): формула рвётся — <span>\(10(𝑥-9\)</span>=7\). */
function repairSplitBackendMathInline(html) {
  if (typeof html !== "string" || !html.includes("math-inline")) return html;
  return html.replace(
    /<span class="math-inline">([\s\S]*?)<\/span>\s*([^<]+?)(?:&#92;&#41;|\\\))/gi,
    (match, body, tail) => {
      const tailTrim = tail.trim();
      if (!tailTrim || !/^[=0-9+\-*/.\s]/.test(tailTrim)) return match;
      let inner = body.trim();
      inner = inner.replace(/^&#92;\(/i, "").replace(/^\\\(/, "");
      inner = inner.replace(/&#92;&#41;$/i, "").replace(/\\\)$/, "");
      if (!inner.includes("(")) return match;
      return `<span class="math-inline">\\(${inner})${tailTrim}\\)</span>`;
    }
  );
}

function tryFixMalformedInlineMathParen(s, start) {
  let i = start + 2;
  let depth = 0;
  const innerStart = i;
  while (i < s.length) {
    if (s.startsWith("\\(", i)) {
      i += 2;
      continue;
    }
    if (s.startsWith("\\)", i)) {
      if (depth === 0) return null;
      i += 2;
      continue;
    }
    const ch = s[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth > 0) depth -= 1;
      else {
        const inner = s.slice(innerStart, i);
        if (!inner || inner.length > 120 || inner.includes("\\(")) return null;
        return { fixed: `\\(${inner}\\)`, next: i + 1 };
      }
    }
    i += 1;
  }
  return null;
}

function repairMalformedInlineMathParenSequence(s) {
  if (!s) return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("\\(", i)) {
      const fix = tryFixMalformedInlineMathParen(s, i);
      if (fix) {
        out += fix.fixed;
        i = fix.next;
        continue;
      }
    }
    out += s[i];
    i += 1;
  }
  return out;
}

/** HTML-сущности &#92;( … &#41; — тот же разбор с учётом вложенных «(…)». */
function repairMalformedInlineMathHtmlEntities(s) {
  if (!s || !/&#92;\(/i.test(s)) return s;
  let out = "";
  let i = 0;
  const open = "&#92;(";
  const closeEscaped = "&#92;&#41;";
  const closeBare = "&#41;";
  while (i < s.length) {
    if (s.startsWith(open, i)) {
      let j = i + open.length;
      let depth = 0;
      const innerStart = j;
      let fixed = false;
      while (j < s.length) {
        if (s.startsWith(open, j)) {
          j += open.length;
          continue;
        }
        if (s.startsWith(closeEscaped, j)) {
          if (depth === 0) break;
          j += closeEscaped.length;
          continue;
        }
        if (s[j] === "(") {
          depth += 1;
          j += 1;
          continue;
        }
        if (s.startsWith(closeBare, j)) {
          if (depth > 0) {
            depth -= 1;
            j += closeBare.length;
            continue;
          }
          const inner = s.slice(innerStart, j);
          if (inner && inner.length <= 120 && !inner.includes(open)) {
            out += `${open}${inner}${closeEscaped}`;
            j += closeBare.length;
            fixed = true;
          }
          break;
        }
        j += 1;
      }
      if (fixed) {
        i = j;
        continue;
      }
    }
    out += s[i];
    i += 1;
  }
  return out;
}

function repairMalformedInlineMathDelimiters(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  let s = repairSplitBackendMathInline(raw);
  s = repairMalformedInlineMathHtmlEntities(s);
  s = repairMalformedInlineMathParenSequence(s);
  return s;
}

/** cases/aligned и др. — блочная вёрстка, не inline (иначе рамка и вертикальный скролл). */
const INLINE_TO_DISPLAY_TEX_RE =
  /\\begin\{(cases|aligned|align\*?|gather\*?|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|array)\}/;

const MATH_ENV_BLOCK_RE =
  /\\begin\{(cases|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|aligned|align\*?|gather\*?)\}(\{[^}]*\})?([\s\S]*?)\\end\{\1\}/g;

function isBrokenBackendMathSpan(span) {
  if (!span) return false;
  if (span.querySelector(".cases-table")) return false;
  if (span.querySelector("mjx-container")) return false;
  const text = (span.textContent || "").trim();
  if (span.querySelector("table.array-table, table")) return true;
  if (/\bmatrix\b/i.test(text)) return true;
  if (span.querySelector("td, th") && text.includes("&")) return true;
  return false;
}

/** Бэкенд иногда сворачивает cases/array в HTML-таблицу с артефактами — восстанавливаем TeX из сырого текста. */
function reinjectMathEnvTexFromRaw(root, raw) {
  if (!root || !raw) return;
  const blocks = [...String(raw).matchAll(MATH_ENV_BLOCK_RE)];
  if (!blocks.length) return;

  const brokenSpans = [...root.querySelectorAll(".math-display, .math-inline")].filter(
    isBrokenBackendMathSpan
  );

  blocks.forEach((match, index) => {
    const span = brokenSpans[index];
    if (!span) return;
    const fullTex = match[0];
    const isDisplay =
      span.classList.contains("math-display") || INLINE_TO_DISPLAY_TEX_RE.test(fullTex);
    const wrapped = isDisplay ? `$$${fullTex}$$` : `$${fullTex}$`;
    span.replaceWith(root.ownerDocument.createTextNode(wrapped));
  });
}

/** Бэкенд отдаёт <span class="math-inline">&#92;(...&#92;&#41;</span> — MathJax их не всегда подхватывает. */
function unwrapBackendMathSpans(root) {
  if (!root) return;
  for (const span of [...root.querySelectorAll(".math-inline, .math-display")]) {
    // array/tabular уже свёрнуты бэкендом в HTML-таблицу — не заменять на textContent
    if (span.querySelector("table, pre, .frac, .cases-table")) continue;
    let tex = repairMalformedInlineMathDelimiters((span.textContent || "").trim());
    if (!tex) {
      span.remove();
      continue;
    }
    if (tex.startsWith("\\(") && tex.endsWith("\\)")) {
      tex = tex.slice(2, -2);
    } else if (tex.startsWith("\\[") && tex.endsWith("\\]")) {
      tex = tex.slice(2, -2);
    }
    const isDisplay =
      span.classList.contains("math-display") || INLINE_TO_DISPLAY_TEX_RE.test(tex);
    const wrapped = isDisplay ? `$$${tex}$$` : `$${tex}$`;
    span.replaceWith(root.ownerDocument.createTextNode(wrapped));
  }
}

function typesetMathInElement(el, { plainHtml = false } = {}) {
  const mj = window.MathJax;
  if (!mj?.typesetPromise) return Promise.resolve();
  const startup = mj.startup?.promise ?? Promise.resolve();
  mathJaxPromise = mathJaxPromise
    .then(() => startup)
    .then(() => {
      mj.typesetClear?.([el]);
      return mj.typesetPromise([el]);
    })
    .then(() => {
      if (plainHtml) polishBankTaskMathJaxTables(el);
    });
  return mathJaxPromise;
}

function normalizeEscapedTaskSymbols(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  return repairMalformedInlineMathDelimiters(raw)
    .replace(/\\([#+^])/g, "$1")
    // Только LaTeX \& → &; не трогать &#92; &#92; (перенос строки в array, иначе таблица кодов слипается)
    .replace(/&#92;\s*&(?:amp;|#38;)/gi, "&")
    .replace(/\\+&/g, "&")
    // Исправление для ОГЭ 4: когда перенос строки сливается с \end{array} (получается \\end{array})
    .replace(/\\\\end\{/g, "\\\\ \\end{")
    // Удаляем одиночный "\" перед пробелом, HTML-тегом или концом строки.
    // Используем negative lookbehind, чтобы не ломать двойные слеши (\\) переноса строк в LaTeX
    // и логические И (/\), где слеш предшествует обратному слешу.
    .replace(/(?<!\\|\/)\\(?=\s|<|$)/g, "");
}

/** span.logic-connective-ru иногда портится при сохранении (пробелы в тегах). */
function repairLogicConnectiveSpanMarkup(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  let s = raw;
  s = s.replace(/<\s*spanclass\b/gi, "<span class");
  s = s.replace(
    /<\s*span\s+class\s*=\s*['"]?\s*logic\s*-\s*connective\s*-\s*ru\s*['"]?\s*>/gi,
    '<span class="logic-connective-ru">'
  );
  s = s.replace(/<\/\s*sp\s*an\s*>/gi, "</span>");
  return s;
}

/** В math mode пробелы не видны — разрядка вокруг \\text{…} и скобок (как на бэкенде). */
function addThinSpaceAroundLogicText(texFragment) {
  if (typeof texFragment !== "string" || texFragment.indexOf("\\text{") === -1) {
    return texFragment;
  }
  return texFragment
    .replace(/\)\s*(?=\\text)/g, ")\\;")
    .replace(/(\\text\{[^}]+\})\s*(?=\\text)/g, "$1\\;")
    .replace(/(\\text\{[^}]+\})\s*(?=\()/g, "$1\\;");
}

/**
 * Внутри $...$ и $$...$$ MathJax воспринимает разметку как TeX: заменяем span на \text{…}.
 */
function convertLogicSpansInsideMathDelimitersToTex(html) {
  if (typeof html !== "string" || !html) return html;

  const spanToTex = (texFragment) =>
    addThinSpaceAroundLogicText(
      texFragment.replace(
        /<span\s+class=["']logic-connective-ru["']>\s*([^<]*?)\s*<\/span>/gi,
        (_, inner) => {
          const word = String(inner || "").trim();
          return word ? `\\text{${word}}` : "";
        }
      )
    );

  const out = [];
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("$$", i)) {
      const end = html.indexOf("$$", i + 2);
      if (end === -1) {
        out.push(html.slice(i));
        break;
      }
      out.push("$$");
      out.push(spanToTex(html.slice(i + 2, end)));
      out.push("$$");
      i = end + 2;
      continue;
    }
    const j = html.indexOf("$", i);
    if (j === -1) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, j));
    const k = html.indexOf("$", j + 1);
    if (k === -1) {
      out.push(html.slice(j));
      break;
    }
    out.push("$");
    out.push(spanToTex(html.slice(j + 1, k)));
    out.push("$");
    i = k + 1;
  }
  return out.join("");
}

/** Внутри $...$ / $$...$$: убрать HTML-теги и заменить сравнения на TeX-команды. */
function sanitizeTexInsideMathDelimiters(html) {
  if (typeof html !== "string" || !html) return html;

  const fixTex = (tex) => {
    let t = tex.replace(/<[^>]+>/g, "");
    t = t
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#92;/g, "\\")
      .replace(/&#123;/g, "{")
      .replace(/&#125;/g, "}");
    t = t
      .replace(/\s*<=\s*/g, " \\le ")
      .replace(/\s*>=\s*/g, " \\ge ")
      .replace(/(?<!\\)<(?!=)/g, " \\lt ")
      .replace(/(?<!\\)>(?!=)/g, " \\gt ");
    return addThinSpaceAroundLogicText(t);
  };

  const out = [];
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("$$", i)) {
      const end = html.indexOf("$$", i + 2);
      if (end === -1) {
        out.push(html.slice(i));
        break;
      }
      out.push("$$");
      out.push(fixTex(html.slice(i + 2, end)));
      out.push("$$");
      i = end + 2;
      continue;
    }
    const j = html.indexOf("$", i);
    if (j === -1) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, j));
    const k = html.indexOf("$", j + 1);
    if (k === -1) {
      out.push(html.slice(j));
      break;
    }
    out.push("$");
    out.push(fixTex(html.slice(j + 1, k)));
    out.push("$");
    i = k + 1;
  }
  return out.join("");
}

function pipeTaskHtmlFormatter(html, formatter) {
  try {
    const next = formatter(html);
    return next && String(next).trim() ? next : html;
  } catch (err) {
    console.error("TASK_HTML_FORMATTER_ERR:", err);
    return html;
  }
}

function preparePlainBankTaskHtml(raw) {
  const decoded = decodeHtmlEntityLayersIfStoredEscaped(raw);
  let s = stripEmbeddedStyleBlocks(decoded);
  s = normalizeEscapedTaskSymbols(s);
  s = repairLogicConnectiveSpanMarkup(s);
  s = formatFipiUnicodeMathHtml(s);
  s = convertLogicSpansInsideMathDelimitersToTex(s);
  s = sanitizeTexInsideMathDelimiters(s);
  s = formatTaskCodeBlocksHtml(s);
  s = pipeTaskHtmlFormatter(s, formatEgeInf2TruthTableHtml);
  s = pipeTaskHtmlFormatter(s, formatEgeInf22ParallelProcessesHtml);
  s = pipeTaskHtmlFormatter(s, formatEgeInf1RoadGraphHtml);
  s = pipeTaskHtmlFormatter(s, formatOgeInformaticsTask13Html);
  s = pipeTaskHtmlFormatter(s, formatOgeInf6TaskHtml);
  // Соответствие А/Б/В ↔ 1/2/3 (ОГЭ мат. №11) — до choice, иначе 1) 2) путаются с вариантами.
  const matched = formatOgeMathMatchingTaskHtml(s);
  const afterMatch = matched && matched.trim() ? matched : s;
  const choiceFormatted = formatOgeMathChoiceTaskHtml(afterMatch);
  s = choiceFormatted && choiceFormatted.trim() ? choiceFormatted : afterMatch;
  return s;
}

/**
 * Рендерит HTML с поддержкой LaTeX/MathJax. На любой странице MathJax
 * корректно отображает формулы.
 * @param {Function} onImageClick - опционально: (src) => {} при клике по картинке
 * @param {boolean} [ogeInf13Enhance] — ОГЭ информатика №13: разметка длинного ТЗ презентации
 */
/**
 * Inline-стили ФИПИ (цвета, рамки) — снимаем в DOM, иначе !important в HTML побеждает CSS.
 */
function _stripFipiDeclarationsFromStyleAttr(node) {
  const style = node.getAttribute("style");
  if (!style) return;
  const filtered = style
    .split(";")
    .map((s) => s.trim())
    .filter((decl) => {
      if (!decl) return false;
      const prop = decl.split(":", 1)[0]?.trim().toLowerCase() ?? "";
      return !(
        prop === "color" ||
        prop === "background" ||
        prop === "background-color" ||
        prop === "background-image" ||
        prop.startsWith("border") ||
        prop === "outline"
      );
    })
    .join("; ");
  if (filtered) node.setAttribute("style", filtered);
  else node.removeAttribute("style");
}

function stripFipiInlineLayoutStyles(root) {
  if (!root) return;
  const targets = [root, ...root.querySelectorAll("*")];
  for (const node of targets) {
    node.removeAttribute?.("border");
    node.removeAttribute?.("frame");
    node.removeAttribute?.("rules");
    node.removeAttribute?.("bgcolor");
    node.removeAttribute?.("color");
    if (node.tagName === "FONT") {
      const span = document.createElement("span");
      while (node.firstChild) span.appendChild(node.firstChild);
      node.replaceWith(span);
      continue;
    }
    _stripFipiDeclarationsFromStyleAttr(node);
  }
}

/**
 * Снимаем <style>...</style> из строки HTML — FIPI-контент иногда тащит свои
 * правила (оранжевые таблицы), а мы хотим единый брендовый стиль.
 */
function stripEmbeddedStyleBlocks(raw) {
  if (typeof raw !== "string" || !raw) return raw;
  return raw
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, "");
}

const BANK_TASK_TABLE_BORDER = "1px solid #94a3b8";

function cellTextForLayoutCheck(el) {
  return (el?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** FIPI-таблица только для раскладки рисунков (Рис. 1 | Рис. 2) — без сетки. */
function isFipiImageLayoutTable(table) {
  if (
    table.closest(
      ".oge-math-choice-task, .oge-math-matching-task, .oge-math-matching-answer-grid, .wb-answer-key-table"
    )
  ) {
    return false;
  }
  if (table.closest("table") && table.closest("table") !== table) return false;

  const cells = [
    ...table.querySelectorAll(":scope > tbody > tr > th, :scope > tbody > tr > td"),
    ...table.querySelectorAll(":scope > tr > th, :scope > tr > td"),
    ...table.querySelectorAll(":scope > thead > tr > th, :scope > thead > tr > td"),
  ];
  if (cells.length < 2) return false;

  const imgCells = cells.filter((cell) => cell.querySelector("img, figure.image, figure.table"));
  if (imgCells.length < 2) return false;

  return imgCells.every((cell) => {
    const text = cellTextForLayoutCheck(cell);
    return (
      !text ||
      text.length <= 32 ||
      /^рис\.?\s*\d*/i.test(text) ||
      /^fig\.?\s*\d*/i.test(text)
    );
  });
}

/** FIPI-обёртка вокруг вложенной таблицы (ЕГЭ инф №4: коды Фано) — без внешней рамки. */
function isFipiLayoutWrapperTable(table) {
  if (
    table.closest(
      ".oge-math-choice-task, .oge-math-matching-task, .oge-math-matching-answer-grid, .wb-answer-key-table"
    )
  ) {
    return false;
  }
  if (table.closest("table") && table.closest("table") !== table) return false;
  if (!table.querySelector(":scope table")) return false;

  const directCells = [
    ...table.querySelectorAll(":scope > tbody > tr > th, :scope > tbody > tr > td"),
    ...table.querySelectorAll(":scope > tr > th, :scope > tr > td"),
  ];
  return directCells.some((cell) => cell.querySelector(":scope table"));
}

function applyLayoutTableChrome(table) {
  table.classList.add("wb-layout-table");
  table.removeAttribute("border");
  table.removeAttribute("cellspacing");
  table.removeAttribute("cellpadding");
  for (const prop of ["overflow", "overflow-x", "overflow-y", "max-height", "max-width", "height", "width", "border"]) {
    table.style.removeProperty(prop);
  }
  table.style.setProperty("border", "none", "important");
  table.style.setProperty("border-collapse", "collapse", "important");
  table.style.setProperty("width", "100%", "important");
  table.style.setProperty("max-width", "100%", "important");
  for (const cell of table.querySelectorAll("th, td")) {
    for (const prop of ["border", "border-left", "border-right", "border-top", "border-bottom", "padding", "width", "height"]) {
      cell.style.removeProperty(prop);
    }
    cell.style.setProperty("border", "none", "important");
    cell.style.setProperty("padding", "0", "important");
    cell.style.setProperty("vertical-align", "top", "important");
    cell.style.setProperty("background", "transparent", "important");
  }
}

/** Банк задач (plainHtml): снять FIPI-прокрутку и выровнять рамки таблиц. */
function polishBankTaskTables(root) {
  if (!root) return;

  root.querySelectorAll("style").forEach((node) => node.remove());
  root.querySelectorAll('link[rel="stylesheet"]').forEach((node) => node.remove());
  root.querySelectorAll("table, thead, tbody, tfoot, tr, th, td").forEach((node) => {
    node.style.removeProperty("display");
  });

  for (const table of root.querySelectorAll("table")) {
    if (table.closest(".oge-math-choice-task")) continue;
    if (table.closest(".oge-math-matching-answer-table")) continue;
    if (table.closest(".math-inline, .math-display, .math-env")) continue;

    if (table.classList.contains("cases-table")) {
      table.style.setProperty("border", "none", "important");
      table.style.setProperty("border-collapse", "collapse", "important");
      for (const cell of table.querySelectorAll("th, td")) {
        for (const prop of [
          "border",
          "border-left",
          "border-right",
          "border-top",
          "border-bottom",
        ]) {
          cell.style.removeProperty(prop);
        }
        cell.style.setProperty("border", "none", "important");
      }
      continue;
    }

    if (table.classList.contains("array-table")) continue;
    if (
      table.classList.contains("ege-inf-2-truth-table") ||
      table.classList.contains("ege-inf-2-example-table") ||
      table.classList.contains("ege-inf-1-road-table") ||
      table.classList.contains("ege-inf-22-process-table")
    ) {
      continue;
    }

    if (isFipiImageLayoutTable(table)) {
      applyLayoutTableChrome(table);
      continue;
    }

    if (isFipiLayoutWrapperTable(table)) {
      applyLayoutTableChrome(table);
      continue;
    }

    table.classList.add("bank-task-table");
    table.removeAttribute("border");
    table.removeAttribute("cellspacing");
    table.removeAttribute("cellpadding");

    for (const prop of ["overflow", "overflow-x", "overflow-y", "max-height", "max-width", "height", "width"]) {
      table.style.removeProperty(prop);
    }

    let parent = table.parentElement;
    while (parent && parent !== root) {
      const tag = parent.tagName;
      if (tag === "FIGURE" || tag === "P" || tag === "DIV" || tag === "TD" || tag === "TH") {
        for (const prop of ["overflow", "overflow-x", "overflow-y", "max-height"]) {
          parent.style.removeProperty(prop);
        }
        parent.style.setProperty("overflow", "visible", "important");
        parent.style.setProperty("max-height", "none", "important");
      }
      if (tag === "FIGURE") break;
      parent = parent.parentElement;
    }

    table.style.setProperty("border-collapse", "collapse", "important");
    table.style.setProperty("border", BANK_TASK_TABLE_BORDER, "important");
    table.style.setProperty("overflow", "visible", "important");

    for (const cell of table.querySelectorAll("th, td")) {
      cell.removeAttribute("border");
      for (const prop of [
        "border",
        "border-left",
        "border-right",
        "border-top",
        "border-bottom",
        "border-width",
        "border-style",
        "border-color",
      ]) {
        cell.style.removeProperty(prop);
      }
      cell.style.setProperty("border", BANK_TASK_TABLE_BORDER, "important");
    }
  }
}

/** MathJax array/tabular: полная сетка границ (после typesetPromise). */
function polishBankTaskMathJaxTables(root) {
  if (!root) return;

  for (const mtable of root.querySelectorAll("mjx-mtable")) {
    if (mtable.closest("mjx-cases")) continue;
    mtable.style.setProperty("border-collapse", "collapse", "important");
    mtable.style.setProperty("border-spacing", "0", "important");
    mtable.style.setProperty("overflow", "visible", "important");
    mtable.classList.add("bank-task-mjx-table");
  }

  for (const table of root.querySelectorAll("mjx-mtable > mjx-table")) {
    if (table.closest("mjx-cases")) continue;
    table.style.setProperty("border-collapse", "collapse", "important");
    table.style.setProperty("border-spacing", "0", "important");
    table.style.setProperty("overflow", "visible", "important");
  }

  for (const cell of root.querySelectorAll("mjx-mtd")) {
    if (cell.closest("mjx-cases")) continue;
    for (const prop of [
      "border",
      "border-left",
      "border-right",
      "border-top",
      "border-bottom",
      "border-width",
      "border-style",
      "border-color",
    ]) {
      cell.style.removeProperty(prop);
    }
    cell.style.setProperty("border", BANK_TASK_TABLE_BORDER, "important");
    cell.style.setProperty("box-sizing", "content-box", "important");
  }

  for (const container of root.querySelectorAll("mjx-container")) {
    container.style.setProperty("overflow", "visible", "important");
    container.style.setProperty("overflow-x", "visible", "important");
    container.style.setProperty("overflow-y", "visible", "important");
    if (container.querySelector("mjx-cases")) {
      container.style.setProperty("display", "block", "important");
      container.style.setProperty("line-height", "normal", "important");
      container.style.setProperty("margin", "0.65em auto", "important");
      container.style.setProperty("text-align", "center", "important");
      container.style.setProperty("max-height", "none", "important");
    }
  }
}

function parseHtmlFragmentForTables(html) {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><body>${html}</body></html>`,
      "text/html"
    );
    return doc.body;
  }
  if (typeof document !== "undefined") {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
  }
  return null;
}

function rawHasSparseGridTables(html) {
  if (!html || typeof html !== "string" || !/<table\b/i.test(html)) return false;
  // Дешёвые отсекающие проверки: без строк/ячеек и для слишком больших HTML скан не нужен.
  if (!/<tr\b/i.test(html) || !/<t[dh]\b/i.test(html) || html.length > 70000) {
    return false;
  }
  const root = parseHtmlFragmentForTables(html);
  if (!root) return false;

  const isTokenLike = (text) => {
    const t = String(text || "").trim();
    if (!t) return true;
    return (
      /^[*]$/.test(t) ||
      /^[A-ZА-ЯЁ]$/.test(t) ||
      /^[ПпPp]\s*[1-9]\d*$/.test(t) ||
      /^[1-9]\d*$/.test(t)
    );
  };

  const parseSpan = (cell, attr) => {
    const n = Number.parseInt(cell.getAttribute(attr) || "1", 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };

  const directRows = (table) => {
    const body =
      (table.tBodies && table.tBodies.length ? table.tBodies[0] : null) || table;
    const rows = [];
    for (const child of [...body.children]) {
      if (child.tagName === "TR") rows.push(child);
    }
    return rows;
  };

  for (const table of root.querySelectorAll("table")) {
    const rows = directRows(table);
    if (rows.length < 3 || rows.length > 40) continue;

    const rowCells = rows.map((row) => [...row.querySelectorAll(":scope > td, :scope > th")]);
    if (rowCells.some((cells) => cells.length < 2)) continue;

    const hasSpans = rowCells.some((cells) =>
      cells.some(
        (cell) =>
          parseSpan(cell, "rowspan") > 1 || parseSpan(cell, "colspan") > 1
      )
    );
    if (hasSpans) continue;

    const counts = rowCells.map((cells) => cells.length);
    const minCols = Math.min(...counts);
    const maxCols = Math.max(...counts);
    if (maxCols < 3 || maxCols - minCols < 2) continue;

    const allTexts = rowCells.flat().map((cell) => normalizeCellText(cell));
    if (!allTexts.length) continue;
    const tokenRatio =
      allTexts.filter((t) => isTokenLike(t)).length / allTexts.length;
    if (tokenRatio >= 0.7) return true;
  }

  return false;
}

function normalizeSparseTables(root) {
  if (!root) return;
  const MAX_TABLE_ROWS = 60;
  const MAX_TABLE_COLS = 40;
  const MAX_SPAN = 20;

  const isPointLabel = (text) => {
    const t = String(text || "").trim();
    if (!t) return false;
    return (
      /^[A-ZА-ЯЁ]$/.test(t) ||
      /^[ПпPp]\s*[1-9]\d*$/.test(t) ||
      /^[1-9]\d*$/.test(t)
    );
  };

  const parseSpan = (cell, attr) => {
    const n = Number.parseInt(cell.getAttribute(attr) || "1", 10);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.min(n, MAX_SPAN);
  };

  const directRows = (table) => {
    const body = table.querySelector(":scope > tbody") || table;
    return [...body.querySelectorAll(":scope > tr")];
  };

  const tryAlignTruthTableRight = (table) => {
    const rows = directRows(table);
    if (rows.length < 3 || rows.length > MAX_TABLE_ROWS) return false;

    const rowCells = rows.map((row) => [...row.querySelectorAll(":scope > td, :scope > th")]);
    const counts = rowCells.map(c => c.length);
    const maxCols = Math.max(...counts);
    if (maxCols < 3 || counts[0] !== 1) return false;

    let zeroOneCount = 0;
    let totalCells = 0;
    rowCells.forEach(cells => {
      cells.forEach(cell => {
        totalCells++;
        const text = normalizeCellText(cell);
        if (text === '0' || text === '1') zeroOneCount++;
      });
    });

    if (zeroOneCount / totalCells > 0.5) {
      rows.forEach((row, r) => {
        const cells = rowCells[r];
        const missing = maxCols - cells.length;
        for (let i = 0; i < missing; i++) {
          const td = table.ownerDocument.createElement(cells[0]?.tagName?.toLowerCase() === "th" ? "th" : "td");
          td.innerHTML = "&nbsp;";
          row.insertBefore(td, cells[0]);
        }
      });
      return true;
    }
    return false;
  };

  const tryInsertMissingCornerCell = (table) => {
    const rows = directRows(table);
    if (rows.length < 3 || rows.length > MAX_TABLE_ROWS) return;

    const rowCells = rows.map((row) => [...row.querySelectorAll(":scope > td, :scope > th")]);
    if (rowCells.some((cells) => cells.length < 2)) return;
    if (rowCells[0].length > MAX_TABLE_COLS) return;

    // Это только для простых матриц без span-разметки.
    const hasSpans = rowCells.some((cells) =>
      cells.some(
        (cell) =>
          parseSpan(cell, "rowspan") > 1 || parseSpan(cell, "colspan") > 1
      )
    );
    if (hasSpans) return;

    const head = rowCells[0].map((c) => normalizeCellText(c));
    const firstHeadCell = head[0] || "";
    if (!firstHeadCell || !isPointLabel(firstHeadCell)) return;
    if (!head.every(isPointLabel)) return;

    const firstCol = rowCells.slice(1).map((cells) => normalizeCellText(cells[0]));
    if (firstCol.some((t) => !isPointLabel(t))) return;

    const overlap = firstCol.filter((t) => head.includes(t)).length;
    if (overlap < Math.max(2, Math.floor(firstCol.length * 0.6))) return;

    const rowLabelsMatchHead = firstCol.every((t, idx) => idx >= head.length || t === head[idx]);
    if (!rowLabelsMatchHead) return;

    // Вставляем пустой левый верхний угол и сдвигаем содержимое строк вправо,
    // чтобы колонка заголовков строк отделилась от матрицы.
    const headTag = rowCells[0][0]?.tagName?.toLowerCase() === "th" ? "th" : "td";
    const headCorner = table.ownerDocument.createElement(headTag);
    headCorner.innerHTML = "&nbsp;";
    rows[0].insertBefore(headCorner, rows[0].firstChild);

    for (let i = 1; i < rows.length; i++) {
      const first = rowCells[i][0];
      if (!first) continue;
      const tag = first.tagName.toLowerCase() === "th" ? "th" : "td";
      const filler = table.ownerDocument.createElement(tag);
      filler.innerHTML = "&nbsp;";
      rows[i].insertBefore(filler, first.nextElementSibling);
    }
  };

  root.querySelectorAll("table").forEach((table) => {
    // Спец-таблицы уже форматируются профильными форматтерами.
    if (
      table.classList.contains("ege-inf-1-road-table") ||
      table.classList.contains("ege-inf-22-process-table") ||
      table.closest(".ege-inf-1-task")
    ) {
      return;
    }

    try {
      if (tryAlignTruthTableRight(table)) return;
      tryInsertMissingCornerCell(table);

      const rows = directRows(table);
      if (rows.length < 2 || rows.length > MAX_TABLE_ROWS) return;

      // Считываем фактическую сетку с учетом colspan/rowspan.
      const occupancy = [];
      const rowCells = [];
      let maxCols = 0;
      let shouldSkip = false;

      rows.forEach((row, r) => {
        if (shouldSkip) return;
        if (!occupancy[r]) occupancy[r] = [];
        const cells = [...row.querySelectorAll(":scope > td, :scope > th")];
        const placed = [];
        let c = 0;

        cells.forEach((cell) => {
          if (shouldSkip) return;
          while (occupancy[r][c]) c++;
          const rs = parseSpan(cell, "rowspan");
          const cs = parseSpan(cell, "colspan");
          if (c + cs > MAX_TABLE_COLS) {
            shouldSkip = true;
            return;
          }

          placed.push({ cell, start: c, end: c + cs - 1 });

          for (let rr = r; rr < r + rs; rr++) {
            if (!occupancy[rr]) occupancy[rr] = [];
            for (let cc = c; cc < c + cs; cc++) {
              occupancy[rr][cc] = true;
            }
          }
          c += cs;
        });

        rowCells[r] = placed;
        if (occupancy[r].length > maxCols) maxCols = occupancy[r].length;
      });

      if (shouldSkip || maxCols < 2 || maxCols > MAX_TABLE_COLS) return;

      rows.forEach((row, r) => {
        const placed = [...(rowCells[r] || [])].sort((a, b) => a.start - b.start);
        let cursor = 0;
        let entryIdx = 0;
        const useTh = row.querySelectorAll(":scope > th").length > 0 && row.querySelectorAll(":scope > td").length === 0;

        while (cursor < maxCols) {
          const current = placed[entryIdx];
          if (current && cursor >= current.start && cursor <= current.end) {
            cursor = current.end + 1;
            entryIdx += 1;
            continue;
          }

          const next = placed.find((it) => it.start > cursor);
          const filler = row.ownerDocument.createElement(useTh ? "th" : "td");
          filler.innerHTML = "&nbsp;";
          if (next) row.insertBefore(filler, next.cell);
          else row.appendChild(filler);
          cursor += 1;
        }
      });
    } catch (err) {
      console.error("TABLE_SHAPE_ERR:", err);
    }
  });
}

function removeDuplicateRoadGraphImages(root, isEgeInf1) {
  if (!root) return;
  
  // Если включен режим задания №1 (egeInf1Enhance), обрабатываем весь корень.
  // Иначе ищем только блоки, которые форматтер смог распознать и обернуть.
  const taskRoots = isEgeInf1 ? [root] : root.querySelectorAll(".ege-inf-1-task");
  if (!taskRoots.length) return;

  taskRoots.forEach((taskRoot) => {
    // В задании 1 всегда только одна картинка графа.
    // Оставляем только первую не-математическую картинку.
    const imgs = [...taskRoot.querySelectorAll("img")].filter(img => {
      const src = img.getAttribute("src") || "";
      return !src.includes("math") && !src.includes("mjx");
    });
    
    if (imgs.length <= 1) return;
    
    imgs.slice(1).forEach(img => {
      const host = img.closest(".ege-inf-1-graph, p, figure, div.task-html-block");
      if (host && host.querySelectorAll("img").length <= 1) {
        host.remove();
      } else {
        img.remove();
      }
    });
  });
}

let mathJaxPromise = Promise.resolve();

function MathContentInner({ html, className, onImageClick, plainHtml = false, ogeInf13Enhance = false, ogeInf6Enhance = false, egeInfFileEnhance = false, egeInf22Enhance = false, egeInf1Enhance = false, egeInf2Enhance = false }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const s = (html != null ? String(html) : "") || "";
    const decoded = decodeHtmlEntityLayersIfStoredEscaped(s);

    // Весь конвейер форматтеров обёрнут в try/catch: одна ошибка форматирования
    // не должна обрушивать рендер всей страницы варианта (React без error boundary
    // размонтирует всё дерево при выбросе из эффекта → пустой экран).
    try {
      if (plainHtml) {
        el.innerHTML = prepareBankTaskDisplayHtml(decoded);
      } else {
      const normalized = normalizeEscapedTaskSymbols(decoded);
      const repaired = repairLogicConnectiveSpanMarkup(normalized);
      const afterFipiMath = formatFipiUnicodeMathHtml(repaired);
      const afterFile = egeInfFileEnhance
        ? stripFipiAttachedFileMarkup(afterFipiMath)
        : afterFipiMath;
      const pipedFile = afterFile && afterFile.trim() ? afterFile : afterFipiMath;
      const inf2 = egeInf2Enhance ? formatEgeInf2TruthTableHtml(pipedFile) : pipedFile;
      const afterInf2 = inf2 && inf2.trim() ? inf2 : pipedFile;
      const inf22 = egeInf22Enhance ? formatEgeInf22ParallelProcessesHtml(afterInf2) : afterInf2;
      const afterInf22 = inf22 && inf22.trim() ? inf22 : afterInf2;
      let shouldNormalizeTables = false;
      try {
        shouldNormalizeTables = rawHasSparseGridTables(afterInf22);
      } catch (err) {
        console.error("RAW_TABLE_SCAN_ERR:", err);
        shouldNormalizeTables = false;
      }
      let afterInf1 = afterInf22;
      try {
        // Запускаем всегда: форматтер сам отфильтрует нерелевантные задания.
        // Это покрывает кейсы, когда road-task ошибочно попал не под №1.
        const inf1 = formatEgeInf1RoadGraphHtml(afterInf22);
        if (inf1 && inf1.trim()) afterInf1 = inf1;
      } catch (err) {
        console.error("FORMATTER ERR:", err);
        afterInf1 = afterInf22;
      }
      const inf13 = ogeInf13Enhance ? formatOgeInformaticsTask13Html(afterInf1) : afterInf1;
      const afterInf13 = inf13 && inf13.trim() ? inf13 : afterInf1;
      const inf6 = ogeInf6Enhance ? formatOgeInf6TaskHtml(afterInf13) : afterInf13;
      const afterInf6 = inf6 && inf6.trim() ? inf6 : afterInf13;
      // Соответствие А/Б/В ↔ 1/2/3 (ОГЭ мат. №11) — до choice, иначе 1) 2) путаются с вариантами.
      const matched = formatOgeMathMatchingTaskHtml(afterInf6);
      const afterMatch = matched && matched.trim() ? matched : afterInf6;
      // Только отображение: в CKEditor в БД остаются исходные <table>, не oge-math-choice-*.
      const formatted = formatOgeMathChoiceTaskHtml(afterMatch);
      const piped = formatted && formatted.trim() ? formatted : afterMatch;
      el.innerHTML = convertLogicSpansInsideMathDelimitersToTex(piped);
      reinjectMathEnvTexFromRaw(el, decoded);
      if (shouldNormalizeTables) {
        try {
          normalizeSparseTables(el);
        } catch (err) {
          console.error("TABLE_NORMALIZE_ERR:", err);
        }
      }
      removeDuplicateRoadGraphImages(el, egeInf1Enhance);

      // ДОПОЛНИТЕЛЬНАЯ ЗАЧИСТКА: если это 1-е задание, принудительно удаляем
      // все картинки с одинаковым src (кроме первой), даже если они не попали
      // в .ege-inf-1-task (на всякий случай).
      if (egeInf1Enhance) {
        const allImgs = [...el.querySelectorAll("img")].filter(img => {
          const src = img.getAttribute("src") || "";
          return !src.includes("math") && !src.includes("mjx");
        });
        if (allImgs.length > 1) {
          allImgs.slice(1).forEach(img => {
            const host = img.closest("p, figure, div.task-html-block");
            if (host && host.querySelectorAll("img").length <= 1) {
              host.remove();
            } else {
              img.remove();
            }
          });
        }
      }
      // stripFipiInlineLayoutStyles(el); - убрано по просьбе
      }
      unwrapBackendMathSpans(el);
      decorateFipiTaskImages(el);
      } catch (err) {
      // Любой сбой форматирования → показываем исходный (декодированный) HTML,
      // а не пустую страницу.
      console.error("MATH_CONTENT_RENDER_ERR:", err);
      try {
        el.innerHTML = decoded || s;
        unwrapBackendMathSpans(el);
      } catch {
        el.textContent = s;
      }
    }

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      if (window.MathJax?.typesetPromise) {
        if (!cancelled) {
          typesetMathInElement(el, { plainHtml }).catch((err) => {
            console.error("MATHJAX_TYPESET_ERR:", err);
          });
        }
      } else {
        setTimeout(run, 100);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [html, plainHtml, ogeInf13Enhance, ogeInf6Enhance, egeInfFileEnhance, egeInf22Enhance, egeInf1Enhance, egeInf2Enhance]);

  useEffect(() => {
    if (!onImageClick || !ref.current) return;
    const el = ref.current;
    const imgs = el.querySelectorAll("img");
    const handlers = [];
    imgs.forEach((img) => {
      if (img.closest(".task-img-zoomable")) return;
      const wrap = document.createElement("span");
      wrap.className = "task-img-zoomable";
      img.parentNode?.insertBefore(wrap, img);
      wrap.appendChild(img);
      const hint = document.createElement("span");
      hint.className = "task-img-zoom-hint";
      hint.setAttribute("aria-hidden", "true");
      hint.setAttribute("role", "button");
      hint.setAttribute("title", "Увеличить");
      hint.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`;
      wrap.appendChild(hint);
      const openLightbox = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetImg = wrap.querySelector("img");
        if (targetImg) onImageClick(targetImg.src || targetImg.getAttribute("src"));
      };
      wrap.addEventListener("click", openLightbox);
      hint.addEventListener("click", openLightbox);
      handlers.push({ wrap, hint, handler: openLightbox });
    });
    return () =>
      handlers.forEach(({ wrap, hint, handler }) => {
        wrap.removeEventListener("click", handler);
        hint.removeEventListener("click", handler);
      });
  }, [html, onImageClick, ogeInf13Enhance, egeInf22Enhance]);

  return <div ref={ref} className={className} />;
}

/** Банк задач / тетрадь: тот же HTML, что в MathContent plainHtml (без typeset). */
export function prepareBankTaskDisplayHtml(raw) {
  if (raw == null || raw === "") return "";
  try {
    const decoded = decodeHtmlEntityLayersIfStoredEscaped(String(raw));
    const html = preparePlainBankTaskHtml(decoded);
    if (typeof document === "undefined") return html;
    const el = document.createElement("div");
    el.innerHTML = html;
    reinjectMathEnvTexFromRaw(el, decoded);
    unwrapBackendMathSpans(el);
    if (rawHasSparseGridTables(html)) {
      try {
        normalizeSparseTables(el);
      } catch (err) {
        console.error("TABLE_NORMALIZE_ERR:", err);
      }
    }
    polishBankTaskTables(el);
    decorateFipiTaskImages(el);
    return el.innerHTML;
  } catch {
    return String(raw);
  }
}

export const MathContent = memo(MathContentInner);
export default MathContent;
export { preparePlainBankTaskHtml, polishBankTaskMathJaxTables };
