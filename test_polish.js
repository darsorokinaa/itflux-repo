const { JSDOM } = require('jsdom');
const dom = new JSDOM();
const document = dom.window.document;

const html = `<div><table><tbody><tr><td><table><tbody><tr><td><strong>1)</strong>&nbsp;</td><td><p>Напишите сочинение-рассуждение</p></td></tr></tbody></table></td></tr></tbody></table></div>`;

const el = document.createElement("div");
el.innerHTML = html;

const BANK_TASK_TABLE_BORDER = "1px solid #cbd5e1";

function polishBankTaskTables(root) {
  if (!root) return;

  root.querySelectorAll("style").forEach((node) => node.remove());
  root.querySelectorAll('link[rel="stylesheet"]').forEach((node) => node.remove());
  root.querySelectorAll("table, thead, tbody, tfoot, tr, th, td").forEach((node) => {
    node.style.removeProperty("display");
  });

  for (const table of root.querySelectorAll("table")) {
    if (table.closest(".oge-math-choice-task")) continue;
    if (table.closest(".oge-math-matching-answer-table")) continue;
    if (table.closest(".math-inline, .math-display, .math-env")) continue;

    if (table.classList.contains("cases-table")) {
      continue;
    }

    if (table.classList.contains("array-table")) continue;

    table.classList.add("bank-task-table");
    table.removeAttribute("border");
    table.removeAttribute("cellspacing");
    table.removeAttribute("cellpadding");

    for (const prop of ["overflow", "overflow-x", "overflow-y", "max-height", "max-width", "height", "width"]) {
      table.style.removeProperty(prop);
    }

    let parent = table.parentElement;
    while (parent && parent !== root) {
      const tag = parent.tagName;
      if (tag === "FIGURE" || tag === "P" || tag === "DIV" || tag === "TD" || tag === "TH") {
        for (const prop of ["overflow", "overflow-x", "overflow-y", "max-height"]) {
          parent.style.removeProperty(prop);
        }
        parent.style.setProperty("overflow", "visible", "important");
        parent.style.setProperty("max-height", "none", "important");
      }
      if (tag === "FIGURE") break;
      parent = parent.parentElement;
    }

    table.style.setProperty("border-collapse", "collapse", "important");
    table.style.setProperty("border", "1px solid #cbd5e1", "important");
    table.style.setProperty("overflow", "visible", "important");
    table.style.setProperty("margin", "0.5rem 0", "important");
    table.style.setProperty("width", "100%", "important");

    for (const cell of table.querySelectorAll("th, td")) {
      cell.removeAttribute("border");
      for (const prop of [
        "border",
        "border-left",
        "border-right",
        "border-top",
        "border-bottom",
        "border-width",
        "border-style",
        "border-color",
      ]) {
        cell.style.removeProperty(prop);
      }
      cell.style.setProperty("border", BANK_TASK_TABLE_BORDER, "important");
      cell.style.setProperty("padding", "6px 10px", "important");
    }
  }
}

polishBankTaskTables(el);
console.log(el.innerHTML);
