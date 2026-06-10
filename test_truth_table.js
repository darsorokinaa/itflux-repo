import { JSDOM } from 'jsdom';
const dom = new JSDOM();
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;

const html = `<table>
<tbody><tr><td> <p>Миша заполнял таблицу истинности функции</p> <p>(¬<i><span>x</span></i>/\\¬<i><span>y</span></i>)\\/ (<i><span>y</span></i>≡<i>z</i>)\\/<span> <i>w</i></span>,</p> <p>но успел заполнить лишь фрагмент из трёх различных её строк, даже не указав, какому столбцу таблицы соответствует каждая из переменных <i>w</i>,<i> x</i>,<i> y</i>,<i> z</i>.</p> <table> <tbody><tr>     <td> <p><b>(¬</b><b><i><span>x</span></i></b><b>/\\</b><b>¬</b><b><i><span>y</span></i>)\\/ </b><b>(</b><b><i><span>y</span></i></b><b>≡<i>z</i>)</b><b>\\/</b><b><span> <i>w</i></span></b></p> </td> </tr> <tr>   <td> <p><span>1</span></p> </td>  <td> <p><b>0</b></p> </td> </tr> <tr> <td> <p>1</p> </td> <td> <p>0</p> </td>  <td> <p><span>1</span></p> </td> <td> <p><b>0</b></p> </td> </tr> <tr> <td> <p><span>0</span></p> </td> <td> <p><span>0</span></p> </td> <td> <p><span>1</span></p> </td> <td> <p><span>1</span></p> </td> <td> <p><b>0</b></p> </td> </tr> </tbody></table> <p>Определите, какому столбцу таблицы соответствует каждая из переменных <i>w</i>,<i> x</i>,<i> y</i>,<i> z</i>.</p> <p>В ответе напишите буквы <i>w</i>,<i> x</i>,<i> y</i>,<i> z</i> в том порядке, в котором идут соответствующие им столбцы (сначала буква, соответствующая первому столбцу; затем буква, соответствующая второму столбцу, и т.д.). Буквы в ответе пишите подряд, никаких разделителей между буквами ставить не нужно.</p> <p><i>Пример.</i> Функция задана выражением ¬<i><span>x</span></i>\\/<span> <i>y</i></span>, зависящим от двух переменных, а фрагмент таблицы имеет следующий вид.</p> <div class="task-html-block"><p><b>¬</b><b><i><span>x</span></i></b><b>\\/</b><b><span> <i>y</i></span></b></p></div><div class="task-html-block"><p>0</p></div><div class="task-html-block"><p>1</p></div><div class="task-html-block"><p><b>0</b></p></div> <p><span>В этом случае первому столбцу соответствует переменная <i>y</i>, а второму столбцу \\(–\\) переменная <i>x</i>. В ответе следует написать: <i>yx</i>.</span></p> </td></tr>
<tr><td>

</td></tr></tbody></table>`;

const doc = new DOMParser().parseFromString(html, "text/html");

function normalizeCellText(el) {
  return (el?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSparseTables(root) {
  if (!root) return;
  const MAX_TABLE_ROWS = 60;
  const MAX_TABLE_COLS = 40;
  const MAX_SPAN = 20;

  const directRows = (table) => {
    const body = table.querySelector(":scope > tbody") || table;
    return [...body.querySelectorAll(":scope > tr")];
  };

  const tryAlignTruthTableRight = (table) => {
    const rows = directRows(table);
    if (rows.length < 3 || rows.length > MAX_TABLE_ROWS) return false;

    const rowCells = rows.map((row) => [...row.querySelectorAll(":scope > td, :scope > th")]);
    const counts = rowCells.map(c => c.length);
    const maxCols = Math.max(...counts);
    if (maxCols < 3 || counts[0] !== 1) return false;

    let zeroOneCount = 0;
    let totalCells = 0;
    rowCells.forEach(cells => {
      cells.forEach(cell => {
        totalCells++;
        const text = normalizeCellText(cell);
        if (text === '0' || text === '1') zeroOneCount++;
      });
    });

    if (zeroOneCount / totalCells > 0.5) {
      rows.forEach((row, r) => {
        const cells = rowCells[r];
        const missing = maxCols - cells.length;
        for (let i = 0; i < missing; i++) {
          const td = table.ownerDocument.createElement(cells[0]?.tagName?.toLowerCase() === "th" ? "th" : "td");
          td.innerHTML = "&nbsp;";
          row.insertBefore(td, cells[0]);
        }
      });
      return true;
    }
    return false;
  };

  root.querySelectorAll("table").forEach((table) => {
    if (tryAlignTruthTableRight(table)) return;
    // ... rest of normalization
  });
}

normalizeSparseTables(doc.body);
console.log(doc.body.innerHTML);

