import { JSDOM } from 'jsdom';
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;

const html = `<table>
<tbody>
<tr><td> </td><td>
<p>П1</p></td><td>
<p>П2</p></td><td>
<p>П3</p></td><td>
<p>П4</p></td><td>
<p>П5</p></td><td>
<p>П6</p></td><td>
<p>П7</p></td></tr>
<tr><td>
<p>П1</p></td><td> </td><td>
<p>6</p></td><td>
<p>7</p></td><td>
<p>5</p></td><td> </td><td> </td><td>
<p>3</p></td></tr>
<tr><td>
<p>П2</p></td><td>
<p>6</p></td><td> </td><td> </td><td> </td><td> </td><td> </td><td> </td></tr>
<tr><td>
<p>П3</p></td><td>
<p>7</p></td><td> </td><td> </td><td>
<p>11</p></td><td> </td><td> </td><td>
<p>12</p></td></tr>
<tr><td>
<p>П4</p></td><td>
<p>5</p></td><td> </td><td>
<p>11</p></td><td> </td><td>
<p>2</p></td><td>
<p>4</p></td><td> </td></tr>
<tr><td>
<p>П5</p></td><td> </td><td> </td><td> </td><td>
<p>2</p></td><td> </td><td> </td><td> </td></tr>
<tr><td>
<p>П6</p></td><td> </td><td> </td><td> </td><td>
<p>4</p></td><td> </td><td> </td><td> </td></tr>
<tr><td>
<p>П7</p></td><td>
<p>3</p></td><td> </td><td>
<p>12</p></td><td> </td><td> </td><td> </td><td> </td></tr></tbody></table>`;

const doc = new DOMParser().parseFromString(html, "text/html");

function tableDirectRows(table) {
  const body = table.querySelector(":scope > tbody") || table;
  return [...body.querySelectorAll(":scope > tr")];
}

function normalizeCellText(el) {
  return (el?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellTextIsPointLabel(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 4) return false;
  if (/^[*–—-]$/.test(t)) return false;
  return (
    /^[ПпPp]\s*[1-9]\d*$/.test(t) ||
    /^[A-ZА-ЯЁ]$/.test(t) ||
    /^[1-9]\d*$/.test(t)
  );
}

const table = doc.querySelector("table");
const rows = tableDirectRows(table);
const directCells = (row) => [...row.querySelectorAll(":scope > td, :scope > th")];

const headerLabels = directCells(rows[0])
  .map((cell) => normalizeCellText(cell))
  .filter((text) => cellTextIsPointLabel(text));

const byLabel = new Map();
for (let i = 1; i < rows.length; i++) {
  const cells = directCells(rows[i]);
  if (!cells.length) continue;
  const rowLabel = normalizeCellText(cells[0]);
  if (!cellTextIsPointLabel(rowLabel)) continue;

  const values = [];
  for (let c = 1; c < cells.length; c++) {
    const t = normalizeCellText(cells[c]);
    // Метки пунктов внутри строки матрицы не считаем весами рёбер.
    if (cellTextIsPointLabel(t)) continue;
    values.push(t || null);
  }
  byLabel.set(rowLabel, values);
}

const lists = headerLabels.map((label) => byLabel.get(label) || []);
const N = headerLabels.length;

// Let's check if lists already have N elements. If they do, they are not sparse!
console.log("Lists:");
lists.forEach((l, i) => console.log(headerLabels[i], l, l.length));

