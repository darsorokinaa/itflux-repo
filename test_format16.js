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

const matrix = Array.from({ length: N }, () => Array(N).fill(null));
const solve = (r, c, idx) => {
  if (r === N) return true;
  if (c === N) {
    return idx === lists[r].length ? solve(r + 1, 0, 0) : false;
  }
  
  if (idx < lists[r].length) {
    const val = lists[r][idx];
    
    // The value in the list MUST match the matrix constraint
    if (c === r) {
      if (val === null) return solve(r, c + 1, idx + 1);
      return false;
    }
    
    if (matrix[r][c] !== null) {
      if (val === matrix[r][c]) return solve(r, c + 1, idx + 1);
      return false;
    }
    
    // matrix[r][c] is null, and we are assigning val to it
    if (val !== null) {
      matrix[r][c] = val;
      matrix[c][r] = val;
      if (solve(r, c + 1, idx + 1)) return true;
      matrix[r][c] = null;
      matrix[c][r] = null;
    } else {
      if (solve(r, c + 1, idx + 1)) return true;
    }
  }
  return false;
};

console.log("solve:", solve(0, 0, 0));
console.log("matrix:", matrix);

