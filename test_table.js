import { JSDOM } from 'jsdom';
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;

const html = `<table> <tbody><tr>     <td> <p><b>(¬</b><b><i><span>x</span></i></b><b>/\\</b><b>¬</b><b><i><span>y</span></i>)\\/ </b><b>(</b><b><i><span>y</span></i></b><b>≡<i>z</i>)</b><b>\\/</b><b><span> <i>w</i></span></b></p> </td> </tr> <tr>   <td> <p><span>1</span></p> </td>  <td> <p><b>0</b></p> </td> </tr> <tr> <td> <p>1</p> </td> <td> <p>0</p> </td>  <td> <p><span>1</span></p> </td> <td> <p><b>0</b></p> </td> </tr> <tr> <td> <p><span>0</span></p> </td> <td> <p><span>0</span></p> </td> <td> <p><span>1</span></p> </td> <td> <p><span>1</span></p> </td> <td> <p><b>0</b></p> </td> </tr> </tbody></table>`;

const doc = new DOMParser().parseFromString(html, "text/html");
const table = doc.querySelector("table");

function tableDirectRows(table) {
  const body = table.querySelector(":scope > tbody") || table;
  return [...body.querySelectorAll(":scope > tr")];
}

const rows = tableDirectRows(table);
const rowCells = rows.map(r => [...r.querySelectorAll("td, th")]);
const counts = rowCells.map(c => c.length);
console.log("Counts:", counts);

const maxCols = Math.max(...counts);

// Detect if it's a right-aligned truth table (EGE Inf 2)
// Characteristics:
// 1. Cells mostly contain 0 or 1.
// 2. The first row has 1 cell (the function expression).
// 3. The last column is always present.
let isTruthTable = false;
let zeroOneCount = 0;
let totalCells = 0;
rowCells.forEach(cells => {
  cells.forEach(cell => {
    totalCells++;
    const text = cell.textContent.trim();
    if (text === '0' || text === '1') zeroOneCount++;
  });
});

if (zeroOneCount / totalCells > 0.5 && counts[0] === 1) {
  isTruthTable = true;
}

console.log("isTruthTable:", isTruthTable);

if (isTruthTable) {
  // Right-align cells
  rows.forEach((row, r) => {
    const cells = rowCells[r];
    const missing = maxCols - cells.length;
    for (let i = 0; i < missing; i++) {
      const td = doc.createElement("td");
      td.innerHTML = "&nbsp;";
      row.insertBefore(td, cells[0]);
    }
  });
}

console.log(table.outerHTML);

