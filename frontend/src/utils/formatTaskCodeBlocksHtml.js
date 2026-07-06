import { formatOgeInf6TaskHtml } from "./formatOgeInf6TaskHtml";

const CODE_LINE_RE =
  /^\s*(?:#|@)?\s*(?:if\b|elif\b|else\s*:|for\b|while\b|def\b|class\b|import\b|from\b|return\b|print\s*\(|input\s*\(|int\s*\(|float\s*\(|str\s*\(|bool\s*\(|[a-zA-Z_]\w*\s*=)/;

function stripCellText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+$/g, "");
}

function lineFromTableRow(cells) {
  if (!cells.length) return "";

  const parts = cells.map((cell) => stripCellText(cell.innerHTML));
  const nonEmpty = parts.filter((part) => part.length > 0);
  if (!nonEmpty.length) return "";

  if (parts.length >= 2) {
    const indentCol = parts[0];
    const codeCol = parts[parts.length - 1];
    if (/^\s*$/.test(indentCol) && indentCol.length > 0 && codeCol) {
      return indentCol + codeCol.replace(/^\s+/, "");
    }
    if (indentCol && codeCol && indentCol !== codeCol) {
      const indent = indentCol.match(/^\s*/)?.[0] || "";
      return indent + codeCol.replace(/^\s+/, "");
    }
  }

  return parts[0];
}

function directRows(table) {
  const body = table.querySelector(":scope > tbody") || table;
  return [...body.querySelectorAll(":scope > tr")];
}

function extractLinesFromTable(table) {
  const lines = [];
  for (const row of directRows(table)) {
    const cells = [...row.querySelectorAll(":scope > td, :scope > th")];
    const line = lineFromTableRow(cells);
    if (line) lines.push(line);
  }
  return lines;
}

function isCodeLikeLine(line) {
  return (
    CODE_LINE_RE.test(line) ||
    /^\s*\bprint\s*\(/.test(line) ||
    /^\s*\binput\s*\(\s*\)/.test(line) ||
    /^\s*[a-zA-Z_]\w*\s*=/.test(line)
  );
}

function tableLooksLikePythonCode(table) {
  if (table.classList?.contains("bank-task-table")) return false;
  if (table.closest("pre, .task-code-block")) return false;

  const lines = extractLinesFromTable(table);
  if (lines.length < 2 || lines.length > 100) return false;

  const colCounts = directRows(table).map(
    (row) => row.querySelectorAll(":scope > td, :scope > th").length
  );
  const maxCols = colCounts.length ? Math.max(...colCounts) : 0;
  if (maxCols > 3) return false;

  const codeLike = lines.filter((line) => isCodeLikeLine(line));

  return codeLike.length >= Math.max(2, Math.ceil(lines.length * 0.45));
}

function makeCodeBlock(doc, lines) {
  const pre = doc.createElement("pre");
  pre.className = "task-code-block";
  const code = doc.createElement("code");
  code.className = "language-python";
  code.textContent = lines.join("\n");
  pre.appendChild(code);
  return pre;
}

function upgradeExistingPreBlocks(root) {
  for (const pre of root.querySelectorAll("pre")) {
    if (pre.classList.contains("task-code-block")) continue;
    pre.classList.add("task-code-block");
    const code = pre.querySelector("code") || pre;
    if (code.tagName !== "CODE") {
      const wrapped = root.ownerDocument.createElement("code");
      wrapped.className = "language-python";
      wrapped.textContent = pre.textContent || "";
      pre.textContent = "";
      pre.appendChild(wrapped);
    } else if (!code.classList.contains("language-python")) {
      code.classList.add("language-python");
    }
  }
}

/**
 * LaTeX array и HTML-таблицы «по строке на ячейку» → <pre class="task-code-block">.
 */
export function formatTaskCodeBlocksHtml(html) {
  if (typeof html !== "string" || !html) return html;

  let out = formatOgeInf6TaskHtml(html);
  if (typeof document === "undefined" || !/<table\b/i.test(out)) {
    return out;
  }

  // createElement, не DOMParser: при висячих </div> полный HTML-документ обрезает хвост.
  const root = document.createElement("div");
  root.innerHTML = out;

  const tables = [...root.querySelectorAll("table")].sort(
    (a, b) => b.querySelectorAll("table").length - a.querySelectorAll("table").length
  );

  for (const table of tables) {
    if (!table.isConnected || !tableLooksLikePythonCode(table)) continue;
    const lines = extractLinesFromTable(table);
    if (lines.length < 2) continue;
    table.replaceWith(makeCodeBlock(root.ownerDocument, lines));
  }

  upgradeExistingPreBlocks(root);
  return root.innerHTML;
}
