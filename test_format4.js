import { formatEgeInf1RoadGraphHtml } from './frontend/src/utils/formatEgeInf1TaskHtml.js';

const html = `<table>
<tbody><tr><td> <p>На рисунке справа схема дорог Н-ского района изображена в виде графа, в таблице содержатся сведения о протяжённости каждой из этих дорог (в километрах).</p>
<table>
<tbody>
<tr>
<td>
<table>
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
<p>12</p></td><td> </td><td> </td><td> </td><td> </td></tr></tbody></table>
</td>
<td>
<p><img alt="" src="/media/task_files/xs3qstsrc2912DC64661F92C648815E587AE04980_1_1486124738_ce1ddfcc801c.png"/></p></td></tr></tbody></table>
<p>Так как таблицу и схему рисовали независимо друг от друга, то нумерация населённых пунктов в таблице никак не связана с буквенными обозначениями на графе. Определите, какова протяжённость дороги из пункта К в пункт Г. В ответе запишите целое число <!--?import namespace = m urn = "http://www.w3.org/1998/Math/MathML" implementation = "#MathPlayer" declareNamespace /-->\\(–\\) так, как оно указано <br/>в таблице.</p></td></tr>
<tr><td>
</td></tr></tbody></table>`;

// Need to mock DOMParser and document for node
import { JSDOM } from 'jsdom';
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;

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

const table = doc.querySelectorAll("table")[2];
const rows = tableDirectRows(table);
const directCells = (row) => [...row.querySelectorAll(":scope > td, :scope > th")];

const headerLabels = directCells(rows[0])
  .map((cell) => normalizeCellText(cell))
  .filter((text) => cellTextIsPointLabel(text));

console.log("headerLabels:", headerLabels);

const byLabel = new Map();
for (let i = 1; i < rows.length; i++) {
  const cells = directCells(rows[i]);
  if (!cells.length) continue;
  const rowLabel = normalizeCellText(cells[0]);
  if (!cellTextIsPointLabel(rowLabel)) continue;

  const values = [];
  for (let c = 1; c < cells.length; c++) {
    const t = normalizeCellText(cells[c]);
    if (!t) continue;
    if (cellTextIsPointLabel(t)) continue;
    values.push(t);
  }
  byLabel.set(rowLabel, values);
}

console.log("byLabel:", byLabel);

