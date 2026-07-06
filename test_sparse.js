const fs = require('fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.window = dom.window;
const html = fs.readFileSync("raw.html", "utf-8");

function rawHasSparseGridTables(html) {
  if (!html || typeof html !== "string" || !/<table\b/i.test(html)) return false;
  if (!/<tr\b/i.test(html) || !/<t[dh]\b/i.test(html) || html.length > 70000) {
    return false;
  }
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${html}</body></html>`,
    "text/html"
  );
  const root = doc.body;

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

    const allTexts = rowCells.flat().map((cell) => cell.textContent.trim());
    if (!allTexts.length) continue;
    const tokenRatio =
      allTexts.filter((t) => isTokenLike(t)).length / allTexts.length;
    if (tokenRatio >= 0.7) return true;
  }

  return false;
}

console.log(rawHasSparseGridTables(html));
