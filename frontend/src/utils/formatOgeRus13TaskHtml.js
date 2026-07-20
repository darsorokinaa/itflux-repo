/**
 * ОГЭ русский №13: три темы сочинения-рассуждения — таблица 2 колонки (номер | текст),
 * как на бланке ФИПИ. Работает поверх HTML из CKEditor / импорта (.task-html-block, <ol>, <tr> без <table>).
 */

const ESSAY_MARKER_RE = /сочинение-рассуждение/i;
const VOLUME_MARKER_RE = /Объём сочинения должен составлять не менее 70 слов/i;
const ESSAY_SPLIT_RE = /(?=Напишите\s+сочинение-рассуждение)/i;

export function isOgeRusEssayTask13Html(html) {
  if (html == null || typeof html !== "string") return false;
  const s = html;
  if (!ESSAY_MARKER_RE.test(s)) return false;
  return VOLUME_MARKER_RE.test(s);
}

function parseHtmlRoot(html, rootId) {
  if (typeof document === "undefined") return null;
  const root = document.createElement("div");
  root.id = rootId || "oge-rus-13-parse-root";
  root.innerHTML = String(html || "");
  return root;
}

function unwrapFigureTables(root) {
  root.querySelectorAll("figure").forEach((fig) => {
    const table = fig.querySelector(":scope > table, table");
    if (table) fig.replaceWith(table);
  });
}

function repairOrphanTableRows(html) {
  let s = String(html || "").trim();
  if (!s || /<table\b/i.test(s)) return s;
  if (!/^<(td|tr)\b/i.test(s)) return s;
  if (!s.startsWith("<tr")) s = `<tr>${s}`;
  if (!/<\/tr>\s*$/i.test(s)) s = `${s}</tr>`;
  return `<table class="oge-rus-13-essay-table"><tbody>${s}</tbody></table>`;
}

function normalizeLabelNum(raw, fallback) {
  const t = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = t.match(/^(\d+)\s*[.)]/);
  if (m) return Number(m[1]);
  return fallback;
}

function stripLeadingItemNumber(html) {
  return String(html || "")
    .replace(/^(\s*<p[^>]*>\s*)?(\d+)[.)]\s*/i, "$1")
    .replace(/^(\s*<li[^>]*>\s*)?(\d+)[.)]\s*/i, "$1")
    .trim();
}

function unwrapSingleItemList(html) {
  const m = String(html || "").match(/^\s*<ol[^>]*>\s*<li[^>]*>([\s\S]*)<\/li>\s*<\/ol>/i);
  if (!m) return html;
  const inner = m[1].trim();
  const rest = String(html).slice(m[0].length).trim();
  return rest ? `${inner}${rest}` : inner;
}

function collectEssaySectionsFromTable(root) {
  const sections = [];
  for (const table of root.querySelectorAll("table")) {
    for (const row of table.querySelectorAll("tr")) {
      const cells = [...row.children].filter((el) => /^(TD|TH)$/i.test(el.tagName));
      if (cells.length < 2) continue;
      const bodyHtml = cells[1].innerHTML.trim();
      if (!ESSAY_MARKER_RE.test(bodyHtml)) continue;
      sections.push({
        num: normalizeLabelNum(cells[0].textContent, sections.length + 1),
        bodyHtml,
      });
    }
    if (sections.length > 0) return sections;
  }
  return null;
}

function collectEssaySectionsFromBlocks(root) {
  const allBlocks = [...root.querySelectorAll(".task-html-block")];
  const leaves = allBlocks.filter((b) => !b.querySelector(".task-html-block"));
  const blocks = leaves.length ? leaves : allBlocks;
  const essayBlocks = blocks.filter((b) => ESSAY_MARKER_RE.test(b.textContent || ""));
  if (essayBlocks.length < 1) return null;
  return essayBlocks.map((block, idx) => ({
    num: normalizeLabelNum(block.textContent, idx + 1),
    bodyHtml: block.innerHTML.trim(),
  }));
}

function collectEssaySectionsFromPlainSplit(html) {
  const parts = String(html)
    .split(ESSAY_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => ESSAY_MARKER_RE.test(p));
  if (parts.length < 1) return null;
  return parts.map((part, idx) => ({
    num: normalizeLabelNum(part, idx + 1),
    bodyHtml: stripLeadingItemNumber(unwrapSingleItemList(part)),
  }));
}

function buildEssayTable(sections) {
  const rows = sections
    .map((sec, idx) => {
      const num = Number.isFinite(sec.num) && sec.num > 0 ? sec.num : idx + 1;
      const body = stripLeadingItemNumber(unwrapSingleItemList(sec.bodyHtml));
      return `<tr><td><strong>${num})</strong>&nbsp;</td><td>${body}</td></tr>`;
    })
    .join("");
  return `<table class="oge-rus-13-essay-table"><tbody>${rows}</tbody></table>`;
}

function finalizeEssayTable(root) {
  const table = root.querySelector("table.oge-rus-13-essay-table, table");
  if (!table) return null;
  table.classList.add("oge-rus-13-essay-table");
  for (const row of table.querySelectorAll("tr")) {
    const cells = [...row.children].filter((el) => /^(TD|TH)$/i.test(el.tagName));
    if (cells.length < 2) continue;
    if (!ESSAY_MARKER_RE.test(cells[1].textContent || "")) continue;
    const num = normalizeLabelNum(cells[0].textContent, 0);
    if (num > 0) cells[0].innerHTML = `<strong>${num})</strong>&nbsp;`;
  }
  return table.outerHTML;
}

export function formatOgeRus13TaskHtml(html) {
  if (!isOgeRusEssayTask13Html(html)) return html;

  let s = repairOrphanTableRows(html);
  const root = parseHtmlRoot(s);
  if (!root) return html;
  unwrapFigureTables(root);

  const existing = collectEssaySectionsFromTable(root);
  if (existing && existing.length > 0) {
    const onlyTable = finalizeEssayTable(root);
    if (onlyTable) return onlyTable;
  }

  const fromBlocks = collectEssaySectionsFromBlocks(root);
  if (fromBlocks && fromBlocks.length > 0) {
    return buildEssayTable(fromBlocks);
  }

  const fromSplit = collectEssaySectionsFromPlainSplit(root.innerHTML);
  if (fromSplit && fromSplit.length > 0) {
    return buildEssayTable(fromSplit);
  }

  const finalized = finalizeEssayTable(root);
  return finalized || html;
}
