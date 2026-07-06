const { JSDOM } = require('jsdom');
const dom = new JSDOM();
const document = dom.window.document;

const html = `<div><table><tbody><tr><td><table><tbody><tr><td><strong>1)</strong>&nbsp;</td><td><p>Напишите сочинение-рассуждение</p></td></tr></tbody></table></td></tr></tbody></table></div>`;

const el = document.createElement("div");
el.innerHTML = html;

function isFipiLayoutWrapperTable(table) {
  if (table.closest(".oge-math-choice-task, .oge-math-matching-task, .oge-math-matching-answer-grid, .wb-answer-key-table")) {
    return false;
  }
  if (table.closest("table") && table.closest("table") !== table) return false;
  if (!table.querySelector(":scope table")) return false;

  const directCells = [
    ...table.querySelectorAll(":scope > tbody > tr > th, :scope > tbody > tr > td"),
    ...table.querySelectorAll(":scope > tr > th, :scope > tr > td"),
  ];
  return directCells.some((cell) => cell.querySelector(":scope table"));
}

function applyLayoutTableChrome(table) {
  table.classList.add("wb-layout-table");
  table.removeAttribute("border");
  table.removeAttribute("cellspacing");
  table.removeAttribute("cellpadding");
  for (const prop of ["overflow", "overflow-x", "overflow-y", "max-height", "max-width", "height", "width", "border"]) {
    table.style.removeProperty(prop);
  }
  table.style.setProperty("border", "none", "important");
  table.style.setProperty("border-collapse", "collapse", "important");
  table.style.setProperty("width", "100%", "important");
  table.style.setProperty("max-width", "100%", "important");
  for (const cell of table.querySelectorAll("th, td")) {
    for (const prop of ["border", "border-left", "border-right", "border-top", "border-bottom", "padding", "width", "height"]) {
      cell.style.removeProperty(prop);
    }
    cell.style.setProperty("border", "none", "important");
    cell.style.setProperty("padding", "0", "important");
    cell.style.setProperty("vertical-align", "top", "important");
    cell.style.setProperty("background", "transparent", "important");
  }
}

const BANK_TASK_TABLE_BORDER = "1px solid #cbd5e1";

function polishBankTaskTables(root) {
  for (const table of root.querySelectorAll("table")) {
    if (isFipiLayoutWrapperTable(table)) {
      applyLayoutTableChrome(table);
      continue;
    }

    table.classList.add("bank-task-table");
    table.style.setProperty("border-collapse", "collapse", "important");
    table.style.setProperty("border", "1px solid #cbd5e1", "important");
    table.style.setProperty("width", "100%", "important");

    for (const cell of table.querySelectorAll("th, td")) {
      cell.style.setProperty("border", BANK_TASK_TABLE_BORDER, "important");
      cell.style.setProperty("padding", "6px 10px", "important");
    }
  }
}

polishBankTaskTables(el);
console.log(el.innerHTML);
