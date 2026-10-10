/**
 * Бланк ФИПИ «заполните таблицу»: названия столбцов сверху, под ними пустые
 * клетки для цифр. Импорт часто разворачивает такую сетку в столбик
 * (одна ячейка в строке или отдельные абзацы). Собираем её обратно.
 */
import { parseTaskHtmlFragment } from "./parseTaskHtmlFragment";

const STUB_RE = /^(?:цифр[аы]|букв[аы]|символ[аы]?|код|номер(?:\s+\S+){1,3})\s*[:.]?$/i;
const MAX_LABEL = 42;
const MIN_HEADERS = 2;
const MAX_HEADERS = 8;

const SKIP_TABLE = new Set([
  "array-table",
  "cases-table",
  "ege-inf-1-road-table",
  "ege-inf-2-truth-table",
  "ege-inf-2-example-table",
  "ege-inf-22-process-table",
  "oge-math-matching-answer-table",
  "oge-rus-13-essay-table",
  "prog-task-sheet__table",
]);

function plainText(el) {
  return String(el?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function plainFromHtml(doc, html) {
  const tmp = doc.createElement("div");
  tmp.innerHTML = html;
  return plainText(tmp);
}

function isStubText(text) {
  return STUB_RE.test(String(text || "").trim());
}

function isShortLabelText(text) {
  const t = String(text || "").trim();
  if (!t || t.length > MAX_LABEL) return false;
  if (/[?!]/.test(t)) return false;
  if (t.includes(",") && !/\d,\d/.test(t)) return false;
  if (t.split(" ").filter(Boolean).length > 5) return false;
  return true;
}

function isSkipTable(table) {
  return [...table.classList].some((name) => SKIP_TABLE.has(name));
}

function isLabelElement(el, { ignoreTable = false } = {}) {
  if (!el || el.nodeType !== 1) return false;
  const blocked = ignoreTable
    ? ".oge-math-choice-option, .oge-math-matching-item, .task-answer-blank-wrap, .task-code-block"
    : "table, .oge-math-choice-option, .oge-math-matching-item, .task-answer-blank-wrap, .task-code-block";
  if (el.closest(blocked)) return false;
  const tag = el.tagName;
  if (tag !== "P" && tag !== "DIV") return false;
  if (tag === "DIV" && el.classList.length && !el.classList.contains("task-html-block")) return false;
  if (el.querySelector("table, img, svg, ol, ul, mjx-container, .math-inline, .math-display")) return false;
  return isShortLabelText(plainText(el));
}

function buildBlank(doc, headerHtml, stubHtml) {
  const wrap = doc.createElement("div");
  wrap.className = "task-answer-blank-wrap";
  const table = doc.createElement("table");
  table.className = "task-answer-blank";

  const head = doc.createElement("tr");
  for (const html of headerHtml) {
    const th = doc.createElement("th");
    th.innerHTML = html;
    head.appendChild(th);
  }

  const body = doc.createElement("tr");
  const stub = doc.createElement("td");
  stub.innerHTML = stubHtml;
  body.appendChild(stub);
  for (let i = 1; i < headerHtml.length; i += 1) {
    const td = doc.createElement("td");
    td.className = "task-answer-blank__digit";
    td.innerHTML = "&nbsp;";
    body.appendChild(td);
  }

  table.appendChild(head);
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

function takeAnswerRun(items) {
  if (!items || items.length < MIN_HEADERS + 1) return null;
  for (let end = Math.min(items.length, MAX_HEADERS + 1); end >= MIN_HEADERS + 1; end -= 1) {
    const run = items.slice(0, end);
    const texts = run.map((item) => item.text);
    if (!texts.every(isShortLabelText)) continue;
    if (!isStubText(texts[texts.length - 1])) continue;
    return run;
  }
  return null;
}

function replaceElementRun(doc, elements) {
  const headers = elements.slice(0, -1);
  const stub = elements[elements.length - 1];
  const wrap = buildBlank(
    doc,
    headers.map((el) => el.innerHTML),
    stub.innerHTML,
  );
  elements[0].replaceWith(wrap);
  for (const el of elements.slice(1)) el.remove();
}

function restoreSiblingRuns(root) {
  const parents = [root, ...root.querySelectorAll("div, section, article, li, blockquote")];
  for (const parent of parents) {
    if (parent !== root && !parent.parentNode) continue;
    if (parent.closest("table, .task-answer-blank-wrap, .oge-math-choice-option")) continue;
    let guard = 0;
    let changed = true;
    while (changed && guard < 6) {
      guard += 1;
      changed = false;
      const kids = [...parent.children];
      for (let i = 0; i < kids.length; i += 1) {
        if (!isLabelElement(kids[i])) continue;
        const run = [];
        for (let j = i; j < kids.length && run.length < MAX_HEADERS + 1; j += 1) {
          if (!isLabelElement(kids[j])) break;
          run.push(kids[j]);
        }
        const hit = takeAnswerRun(run.map((el) => ({ el, text: plainText(el) })));
        if (!hit) continue;
        replaceElementRun(parent.ownerDocument, hit.map((item) => item.el));
        changed = true;
        break;
      }
    }
  }
}

function restoreBrBlocks(root) {
  const blocks = [...root.querySelectorAll("p, div.task-html-block")];
  for (const el of blocks) {
    if (!el.parentNode) continue;
    if (el.closest("table, .task-answer-blank-wrap, .oge-math-choice-option, .task-code-block")) continue;
    if (el.querySelector("table, img, svg, p, div, ol, ul")) continue;
    if (!/<br\b/i.test(el.innerHTML)) continue;
    const parts = el.innerHTML
      .split(/<br\s*\/?>/i)
      .map((part) => part.trim())
      .filter((part) => part && !/^(?:&nbsp;|&#160;|\s)+$/i.test(part));
    const doc = el.ownerDocument;
    const items = parts.map((html) => ({ html, text: plainFromHtml(doc, html) }));
    const hit = takeAnswerRun(items);
    if (!hit || hit.length !== items.length) continue;
    el.replaceWith(buildBlank(doc, hit.slice(0, -1).map((item) => item.html), hit[hit.length - 1].html));
  }
}

function tagExistingAnswerTable(table) {
  const rows = [...table.rows];
  if (rows.length !== 2) return false;
  const head = [...rows[0].cells];
  const body = [...rows[1].cells];
  if (head.length < MIN_HEADERS || head.length > MAX_HEADERS) return false;
  if (head.some((cell) => cell.querySelector("img, table") || !isShortLabelText(plainText(cell)))) return false;
  if (!body.length || !isStubText(plainText(body[0]))) return false;
  if (body.slice(1).some((cell) => plainText(cell) || cell.querySelector("img, table"))) return false;

  const doc = table.ownerDocument;
  while (rows[1].cells.length < head.length) {
    const td = doc.createElement("td");
    td.className = "task-answer-blank__digit";
    td.innerHTML = "&nbsp;";
    rows[1].appendChild(td);
  }
  for (let i = 1; i < rows[1].cells.length; i += 1) {
    const cell = rows[1].cells[i];
    if (!plainText(cell)) cell.classList.add("task-answer-blank__digit");
  }
  table.classList.add("task-answer-blank");
  if (!table.parentElement?.classList.contains("task-answer-blank-wrap")) {
    const wrap = doc.createElement("div");
    wrap.className = "task-answer-blank-wrap";
    table.replaceWith(wrap);
    wrap.appendChild(table);
  }
  return true;
}

function stackedLabelsInCell(cell) {
  const kids = [...cell.children];
  const labels = [];
  for (let i = kids.length - 1; i >= 0; i -= 1) {
    if (!isLabelElement(kids[i], { ignoreTable: true })) break;
    labels.unshift(kids[i]);
  }
  if (labels.length >= MIN_HEADERS + 1) {
    const hit = takeAnswerRun(labels.map((el) => ({ el, text: plainText(el) })));
    if (hit && hit.length === labels.length) return { kind: "elements", items: labels };
  }
  if (cell.querySelector("table, img, svg, ol, ul")) return null;
  const html = (kids.length === 1 ? kids[0].innerHTML : cell.innerHTML) || "";
  if (!/<br\s*\/?>/i.test(html)) return null;
  const parts = html
    .split(/<br\s*\/?>/i)
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:&nbsp;|&#160;|\s)+$/i.test(part));
  const doc = cell.ownerDocument;
  const items = parts.map((part) => ({ html: part, text: plainFromHtml(doc, part) }));
  if (!takeAnswerRun(items) || takeAnswerRun(items).length !== items.length) return null;
  return { kind: "html", items };
}

function restoreCollapsedTables(root) {
  const tables = [...root.querySelectorAll("table")].reverse();
  for (const table of tables) {
    if (!table.parentNode || isSkipTable(table)) continue;
    if (table.classList.contains("task-answer-blank")) {
      tagExistingAnswerTable(table);
      continue;
    }
    if (tagExistingAnswerTable(table)) continue;

    const rows = [...table.rows];
    if (!rows.length) continue;

    const oneColumn = rows.length >= MIN_HEADERS + 1 && rows.every((row) => row.cells.length === 1);
    if (oneColumn) {
      const cells = rows.map((row) => row.cells[0]);
      const hit = takeAnswerRun(cells.map((cell) => ({ cell, text: plainText(cell) })));
      if (hit && hit.length === cells.length && cells.every((cell) => !cell.querySelector("img, table"))) {
        table.replaceWith(
          buildBlank(
            table.ownerDocument,
            hit.slice(0, -1).map((item) => item.cell.innerHTML),
            hit[hit.length - 1].cell.innerHTML,
          ),
        );
        continue;
      }
    }

    if (rows.length === 1 && rows[0].cells.length === 1) {
      const cell = rows[0].cells[0];
      const stacked = stackedLabelsInCell(cell);
      if (!stacked) continue;
      if (stacked.kind === "elements") {
        const hit = takeAnswerRun(stacked.items.map((el) => ({ el, text: plainText(el) })));
        if (!hit) continue;
        replaceElementRun(table.ownerDocument, hit.map((item) => item.el));
      } else {
        const host = cell.children.length === 1 ? cell.children[0] : null;
        const wrap = buildBlank(
          table.ownerDocument,
          stacked.items.slice(0, -1).map((item) => item.html),
          stacked.items[stacked.items.length - 1].html,
        );
        if (host) host.replaceWith(wrap);
        else {
          cell.replaceChildren(wrap);
        }
      }
      const frag = table.ownerDocument.createDocumentFragment();
      while (cell.firstChild) frag.appendChild(cell.firstChild);
      table.replaceWith(frag);
    }
  }
}

export function restoreAnswerBlankTablesHtml(html) {
  if (html == null || typeof html !== "string" || !html.trim()) return html;
  if (typeof document === "undefined") return html;
  if (!/цифр|букв|символ|код|номер/i.test(html)) return html;
  const root = parseTaskHtmlFragment(html);
  if (!root) return html;
  restoreCollapsedTables(root);
  restoreBrBlocks(root);
  restoreSiblingRuns(root);
  return root.innerHTML;
}
