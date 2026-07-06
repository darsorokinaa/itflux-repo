/**
 * ФИПИ в Excel/БД: формулы как Unicode (𝑥2⁢ ≤0), без MathJax.
 * При показе превращаем в $…$ для typeset.
 */

import { parseTaskHtmlFragment } from "./parseTaskHtmlFragment";

const FIPI_MATH_MARK_RE = /[\u2062\u2212\u2264\u2265\u00d7\u00f7\u{1D465}]/u;

const CYRILLIC_WORD_RE = /[а-яё]{3,}/gi;

const UNICODE_FIXUPS = [
  [/\u2062/g, ""], // invisible times
  [/\u2063/g, ""],
  [/\u2064/g, ""],
  [/\u2009/g, " "], // thin space
  [/\u00a0/g, " "],
  [/\u2212/g, "-"], // minus
  [/\u2264/g, "≤"],
  [/\u2265/g, "≥"],
  [/\u00d7/g, "×"],
  [/\u00f7/g, "÷"],
  [/\u00b7/g, "·"],
];

const HTML_ENTITY_FIXUPS = [
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&le;/gi, "≤"],
  [/&ge;/gi, "≥"],
  [/&nbsp;/gi, " "],
  [/&amp;/g, "&"],
];

function decodeHtmlEntities(text) {
  let s = String(text || "");
  for (const [re, rep] of HTML_ENTITY_FIXUPS) s = s.replace(re, rep);
  return s;
}

function normalizeFipiUnicode(text) {
  let s = decodeHtmlEntities(text);
  for (const [re, rep] of UNICODE_FIXUPS) s = s.replace(re, rep);
  return s.replace(/\s+/g, " ").trim();
}

function countCyrillicWords(text) {
  return (String(text).match(CYRILLIC_WORD_RE) || []).length;
}

function looksLikeFipiUnicodeMath(text) {
  if (!text || typeof text !== "string") return false;
  const t = decodeHtmlEntities(text).trim();
  if (!t) return false;
  if (/[$\\]|math-inline|mjx-container/i.test(t)) return false;

  const hasMathItalicX = /\u{1D465}/u.test(t);
  const hasInvisibleTimes = /\u2062/.test(t);
  const hasMathMinus = /\u2212/.test(t);
  const hasInequality = /[≤≥]/.test(t) || /(?:^|[\s{(])(?:<|>)(?!=)/.test(t);
  const cyrillicWords = countCyrillicWords(t);

  // Текстовые задачи (фрукты, рабочие, велосипедисты) — не трогаем.
  if (cyrillicWords >= 2) return false;

  if (looksLikeFipiPiecewise(t)) return true;

  if (hasMathItalicX || hasInvisibleTimes) return true;

  if (t.startsWith("{") && hasInequality) return true;

  if (hasInequality && cyrillicWords === 0 && t.length < 120) {
    if (hasMathMinus || /[\u{1D465}xх0-9]/iu.test(t)) return true;
  }

  if (hasInequality && cyrillicWords <= 1 && t.length < 80 && /(?:^|[\s{(+−-])([хx])(?=[0-9+\-−<=>≤≥])/iu.test(t)) {
    return true;
  }

  return false;
}

/** Десятичная запятая в числах: 0,9 → 0{,}9 */
function texifyDecimalCommas(tex) {
  return tex.replace(/(\d),(\d)/g, "$1{,}$2");
}

function texifyComparisons(tex) {
  return tex
    .replace(/\s*≤\s*/g, " \\le ")
    .replace(/\s*≥\s*/g, " \\ge ")
    .replace(/\s*≠\s*/g, " \\ne ")
    .replace(/\s*<\s*/g, " \\lt ")
    .replace(/\s*>\s*/g, " \\gt ")
    .replace(/\s*=\s*/g, " = ");
}

/** 𝑥2 → x^{2}; 𝑦 → y; кириллическую «х» — только как переменную. */
function texifyVariablesAndPowers(tex) {
  let s = tex.replace(/([\u{1D465}x])(\d+)/giu, "x^{$2}");
  s = s.replace(/(?<![а-яёА-ЯЁa-zA-Z])([х])(\d+)/giu, "x^{$2}");
  s = s.replace(/\u{1D465}/gu, "x");
  s = s.replace(/\u{1D466}/gu, "y");
  s = s.replace(/(?<![а-яёА-ЯЁ])([х])(?![а-яёА-ЯЁ])/gu, "x");
  return s;
}

function isSystemSeparatorComma(inner, commaIdx) {
  const after = inner.slice(commaIdx + 1).trimStart();
  if (!after) return false;
  if (/^[𝑥xх\-−]/.test(after)) return true;
  // >0,9−4𝑥 — новое неравенство начинается с «цифра + минус»
  if (/^\d+[−-]/.test(after)) return true;
  return false;
}

function splitFipiSystemInner(inner) {
  const parts = [];
  let buf = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "," && isSystemSeparatorComma(inner, i)) {
      parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/** Кусочно-заданная функция ФИПИ: 𝑦={𝑥2−6𝑥+10𝑥+2припри𝑥≥1,𝑥<1 */
const FIPI_PIECEWISE_BRACE_RE = /(?:⎧\s*\{\s*\{\s*⎨\s*\{\s*\{\s*⎩|\{)\s*/iu;
const FIPI_PIECEWISE_PRI_RE = /при\s*при(?:\s*при)?/iu;

function looksLikeFipiPiecewise(text) {
  const t = normalizeFipiUnicode(text);
  return FIPI_PIECEWISE_PRI_RE.test(t) && /[{⎧]/.test(t) && /[𝑥xх\u{1D465}]/iu.test(t);
}

function parseFipiPiecewise(expr) {
  const s = normalizeFipiUnicode(expr);
  const priMatch = s.match(FIPI_PIECEWISE_PRI_RE);
  if (!priMatch || priMatch.index == null) return null;

  const beforePri = s.slice(0, priMatch.index).trim();
  const condBlock = s
    .slice(priMatch.index + priMatch[0].length)
    .replace(/[.·…]\s*$/, "")
    .trim();
  const conds = splitFipiSystemInner(condBlock);
  if (conds.length < 2) return null;

  const braceMatch = beforePri.match(FIPI_PIECEWISE_BRACE_RE);
  if (!braceMatch || braceMatch.index == null) return null;

  const prefix = beforePri.slice(0, braceMatch.index).trim();
  const exprBlock = beforePri.slice(braceMatch.index + braceMatch[0].length).trim();

  let exprs = null;
  if (conds.length === 2) {
    exprs = splitPiecewiseExprPair(exprBlock);
  } else if (conds.length === 3) {
    exprs = splitPiecewiseExprTriple(exprBlock);
  }
  if (!exprs || exprs.length !== conds.length) return null;

  const cases = buildPiecewiseCasesLatex(exprs, conds);
  const prefixLatex = prefix ? `${texifyExprFragment(prefix.replace(/=\s*$/, ""))} = ` : "";
  return `${prefixLatex}${cases}`;
}

function texifyExprFragment(expr) {
  let s = normalizeFipiUnicode(expr).replace(/[.·…]\s*$/, "").trim();
  if (!s) return "";
  s = texifyVariablesAndPowers(s);
  s = texifyComparisons(s);
  s = texifyDecimalCommas(s);
  s = s.replace(/\s*\+\s*/g, " + ");
  s = s.replace(/\s*-\s*/g, " - ");
  return s.replace(/\s{2,}/g, " ").trim();
}

/** Две ветви: квадратичная + линейная, слипшиеся без разделителя. */
function splitPiecewiseExprPair(exprBlock) {
  const t = texifyVariablesAndPowers(normalizeFipiUnicode(exprBlock));
  if (!/x\^\{2\}/.test(t)) return null;
  for (let i = t.length - 1; i >= 0; i--) {
    if (!/\d/.test(t[i])) continue;
    const rest = t.slice(i + 1);
    if (/^\s*(?:[+\-]\s*)?x(?:\s*[+\-]|$)/.test(rest)) {
      return [t.slice(0, i + 1).trim(), rest.trim()];
    }
  }
  return null;
}

/** Три ветви: разбиваем справа (последняя — линейная/простая). */
function splitPiecewiseExprTriple(exprBlock) {
  const t = texifyVariablesAndPowers(normalizeFipiUnicode(exprBlock));
  const tail = t.match(/(?:[+\-]\s*)?x(?:\s*[+\-]\s*\d+(?:\{,\}\d+)?)?$/);
  if (!tail) return null;
  const expr3 = tail[0].trim();
  let rest = t.slice(0, t.length - tail[0].length).trim();
  const mid = rest.match(/(?:[+\-]\s*)?\d+(?:\{,\}\d+)?\s*x(?:\s*[+\-][^+\-]+)?$/);
  if (!mid) return null;
  const expr2 = mid[0].trim();
  const expr1 = rest.slice(0, rest.length - mid[0].length).trim();
  if (!expr1 || !expr2 || !expr3) return null;
  return [expr1, expr2, expr3];
}

function buildPiecewiseCasesLatex(exprs, conds) {
  const rows = exprs.map((expr, i) => {
    const exprLatex = texifyExprFragment(expr);
    const condLatex = texifyExprFragment(conds[i] || "");
    return `${exprLatex}, & \\text{при } ${condLatex}`;
  });
  return `\\begin{cases}${rows.join(" \\\\ ")}\\end{cases}`;
}

function fipiUnicodeExprToLatex(expr) {
  let s = normalizeFipiUnicode(expr);
  if (!s) return "";

  if (looksLikeFipiPiecewise(s)) {
    const piecewise = parseFipiPiecewise(s);
    if (piecewise) return piecewise;
  }

  if (s.startsWith("{")) {
    const inner = s.slice(1).replace(/[.·…]\s*$/, "").trim();
    const cases = splitFipiSystemInner(inner);
    if (cases.length >= 2) {
      const body = cases.map((c) => fipiUnicodeExprToLatex(c)).join(" \\\\ ");
      return `\\begin{cases}${body}\\end{cases}`;
    }
    s = inner;
  }

  s = s.replace(/[.·…]\s*$/, "").trim();
  s = texifyVariablesAndPowers(s);
  s = texifyComparisons(s);
  s = texifyDecimalCommas(s);
  s = s.replace(/\s*\+\s*/g, " + ");
  s = s.replace(/\s*-\s*/g, " - ");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

function wrapLatex(latex) {
  const t = String(latex || "").trim();
  if (!t) return "";
  const display = /\\begin\{(cases|matrix|array|aligned)/.test(t);
  return display ? `$$${t}$$` : `$${t}$`;
}

function convertTextNode(text) {
  const raw = String(text || "");
  if (!looksLikeFipiUnicodeMath(raw)) return raw;
  const latex = fipiUnicodeExprToLatex(raw);
  if (!latex) return raw;
  return wrapLatex(latex);
}

function shouldSkipElement(el) {
  if (!el || el.nodeType !== 1) return true;
  const tag = el.tagName;
  if (tag === "IMG" || tag === "SVG" || tag === "TABLE" || tag === "OL" || tag === "UL") {
    return true;
  }
  if (el.closest?.(".oge-math-choice-options, .oge-math-choice-option__body")) return true;
  if (el.querySelector?.("img, svg, mjx-container, .math-inline, .math-display")) return true;
  return false;
}

function convertElementText(el) {
  if (shouldSkipElement(el)) return;
  const full = (el.textContent || "").trim();
  if (!looksLikeFipiUnicodeMath(full)) return;
  const latex = fipiUnicodeExprToLatex(full);
  if (!latex) return;
  el.textContent = "";
  el.appendChild(document.createTextNode(wrapLatex(latex)));
}

/**
 * @param {string} html
 * @returns {string}
 */
export function formatFipiUnicodeMathHtml(html) {
  if (html == null || typeof html !== "string") return html;
  if (!FIPI_MATH_MARK_RE.test(html)) return html;
  if (typeof document === "undefined") return html;

  const root = parseTaskHtmlFragment(html, "fipi-unicode-math-root");
  if (!root) return html;

  for (const el of root.querySelectorAll("p, .oge-math-choice-question, td, th, div")) {
    if (el === root) continue;
    if (el.closest(".oge-math-choice-options, .oge-math-choice-option")) continue;
    if (el.querySelector("p, table, img, mjx-container")) continue;
    convertElementText(el);
  }

  return root.innerHTML;
}

export { fipiUnicodeExprToLatex, looksLikeFipiUnicodeMath };
