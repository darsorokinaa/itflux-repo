/**
 * Проза условия задания: «P_x» / «|P_x|» → MathJax, «1. 2. 3.» → настоящий список.
 * Глобальный reset `* { padding: 0 }` иначе оставляет нумерацию без висячего отступа.
 */
import { parseTaskHtmlFragment } from "./parseTaskHtmlFragment";

const MATH_SKIP_SEL =
  "mjx-container, .math-inline, .math-display, code, pre, a, script, style, .task-code-block, .file-name, .file-attachment";

const LIST_SKIP_SEL =
  "ol, ul, li, table, thead, tbody, tfoot, tr, td, th, pre, figure, .oge-math-choice-task, .oge-math-choice-options, .oge-math-choice-option, .task-code-block";

const MATH_CHUNK_RE = /\$\$[\s\S]*?\$\$|\$[^$]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;
const FILE_EXT_RE = /^\.\w{2,4}(?:\b|$)/;
const LEADING_NUM_RE = /^(\d+)\.\s+\S/;

function wrapIdentsInPlain(text) {
  const absRe = /\|([A-Za-z])_([A-Za-z0-9]{1,3})\|/g;
  const identRe = /(?<![A-Za-z0-9$\\])([A-Za-z])_([A-Za-z0-9]{1,3})(?![A-Za-z0-9])/g;
  let out = String(text || "").replace(absRe, (_, letter, index) => `⟦ABS:${letter}:${index}⟧`);
  out = out.replace(identRe, (match, letter, index, offset, full) => {
    const after = full.slice(offset + match.length);
    if (FILE_EXT_RE.test(after)) return match;
    return `$${letter}_${index}$`;
  });
  return out.replace(/⟦ABS:([A-Za-z]):([A-Za-z0-9]{1,3})⟧/g, (_, letter, index) => `$|${letter}_${index}|$`);
}

function wrapPlainMathIdentifiers(text) {
  const s = String(text || "");
  if (!s.includes("_")) return s;
  const re = new RegExp(MATH_CHUNK_RE.source, "g");
  let out = "";
  let last = 0;
  let match;
  while ((match = re.exec(s))) {
    out += wrapIdentsInPlain(s.slice(last, match.index));
    out += match[0];
    last = match.index + match[0].length;
  }
  out += wrapIdentsInPlain(s.slice(last));
  return out;
}

function formatTextNodeIdentifiers(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(MATH_SKIP_SEL)) return NodeFilter.FILTER_REJECT;
      const value = node.nodeValue || "";
      if (!value.includes("_")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const next = wrapPlainMathIdentifiers(node.nodeValue || "");
    if (next !== node.nodeValue) node.nodeValue = next;
  }
}

export function formatPlainMathIdentifiersHtml(html) {
  if (html == null || typeof html !== "string" || !html.includes("_")) return html;
  if (typeof document === "undefined") return html;
  const root = parseTaskHtmlFragment(html);
  if (!root) return html;
  formatTextNodeIdentifiers(root);
  return root.innerHTML;
}

function normalizeBlockText(el) {
  return String(el?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmptyBlock(el) {
  return !normalizeBlockText(el);
}

function leadingItemNumber(el) {
  const text = normalizeBlockText(el);
  const match = LEADING_NUM_RE.exec(text);
  return match ? Number(match[1]) : null;
}

function isProseBlock(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (el.matches(LIST_SKIP_SEL)) return false;
  if (el.closest(LIST_SKIP_SEL)) return false;
  if (el.matches("p, div.task-html-block")) return true;
  if (el.tagName === "DIV" && !el.querySelector("p, div, table, ol, ul, pre, figure")) return true;
  return false;
}

function stripLeadingItemNumber(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!(node.nodeValue || "").trim()) continue;
    node.nodeValue = node.nodeValue.replace(/^\s*\d+\.\s+/, "");
    break;
  }
}

function wrapNumberedRun(run, start) {
  if (!run.length) return;
  const doc = run[0].ownerDocument;
  const ol = doc.createElement("ol");
  ol.className = "task-prose-list";
  if (start > 1) ol.setAttribute("start", String(start));
  for (const el of run) {
    const li = doc.createElement("li");
    li.innerHTML = el.innerHTML;
    stripLeadingItemNumber(li);
    ol.appendChild(li);
  }
  run[0].replaceWith(ol);
  for (const el of run.slice(1)) el.remove();
}

function convertSiblingRuns(parent) {
  let guard = 0;
  while (guard < 32) {
    guard += 1;
    const kids = [...parent.children];
    let wrapped = false;
    for (let i = 0; i < kids.length; i += 1) {
      const first = kids[i];
      if (!isProseBlock(first) || isEmptyBlock(first)) continue;
      const start = leadingItemNumber(first);
      if (start == null) continue;
      const run = [first];
      let expect = start + 1;
      for (let j = i + 1; j < kids.length; j += 1) {
        const el = kids[j];
        if (!isProseBlock(el)) break;
        if (isEmptyBlock(el)) continue;
        const n = leadingItemNumber(el);
        if (n !== expect) break;
        run.push(el);
        expect += 1;
      }
      if (run.length >= 2) {
        wrapNumberedRun(run, start);
        wrapped = true;
        break;
      }
    }
    if (!wrapped) break;
  }
}

function numberedLineMeta(html) {
  const text = String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = LEADING_NUM_RE.exec(text);
  return match ? { n: Number(match[1]), html } : { n: null, html };
}

function stripLeadingNumberFromHtml(html) {
  const root = document.createElement("div");
  root.innerHTML = html;
  stripLeadingItemNumber(root);
  return root.innerHTML;
}

function promoteNumberedBrLines(el) {
  if (!el || el.querySelector("p, div, ol, ul, table, li")) return;
  if (!/<br\s*\/?>/i.test(el.innerHTML)) return;
  if (el.closest(LIST_SKIP_SEL)) return;
  const parts = el.innerHTML
    .split(/<br\s*\/?>/i)
    .map((part) => part.trim())
    .filter((part) => part && !/^&nbsp;$/i.test(part));
  if (parts.length < 2) return;

  const metas = parts.map(numberedLineMeta);
  let best = null;
  for (let i = 0; i < metas.length; i += 1) {
    if (metas[i].n == null) continue;
    const run = [i];
    let expect = metas[i].n + 1;
    for (let j = i + 1; j < metas.length; j += 1) {
      if (metas[j].n !== expect) break;
      run.push(j);
      expect += 1;
    }
    if (run.length >= 2 && (!best || run.length > best.length)) {
      best = { startIndex: i, indexes: run, start: metas[i].n };
    }
  }
  if (!best) return;

  const before = parts.slice(0, best.startIndex).join("<br>");
  const after = parts.slice(best.indexes[best.indexes.length - 1] + 1).join("<br>");
  const doc = el.ownerDocument;
  const frag = doc.createDocumentFragment();
  if (before) {
    const head = el.cloneNode(false);
    head.innerHTML = before;
    frag.appendChild(head);
  }
  const wrap = doc.createElement("div");
  const startAttr = best.start > 1 ? ` start="${best.start}"` : "";
  const items = best.indexes
    .map((idx) => `<li>${stripLeadingNumberFromHtml(parts[idx])}</li>`)
    .join("");
  wrap.innerHTML = `<ol class="task-prose-list"${startAttr}>${items}</ol>`;
  while (wrap.firstChild) frag.appendChild(wrap.firstChild);
  if (after) {
    const tail = el.cloneNode(false);
    tail.innerHTML = after;
    frag.appendChild(tail);
  }
  el.replaceWith(frag);
}

export function formatNumberedTaskBlocksHtml(html) {
  if (html == null || typeof html !== "string") return html;
  if (!/(?:^|>)\s*\d+\.\s+\S/m.test(html) && !/\d+\.\s+\S/.test(html)) return html;
  if (typeof document === "undefined") return html;
  const root = parseTaskHtmlFragment(html);
  if (!root) return html;

  if (!root.querySelector("p, div")) promoteNumberedBrLines(root);
  for (const el of [...root.querySelectorAll("p, div")]) {
    promoteNumberedBrLines(el);
  }

  const parents = [...root.querySelectorAll("div, p, li, td, th")];
  parents.push(root);
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    convertSiblingRuns(parents[i]);
  }
  return root.innerHTML;
}

export function formatTaskProseHtml(html) {
  let out = formatPlainMathIdentifiersHtml(html);
  out = formatNumberedTaskBlocksHtml(out);
  return out;
}
