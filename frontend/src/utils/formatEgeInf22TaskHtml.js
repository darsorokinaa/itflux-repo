/**
 * ЕГЭ информатика №22 — параллельные и последовательные процессы.
 * Разворачивает FIPI-обёртки, чистит пример таблицы, убирает дубли картинок.
 */

function parseHtmlFragment(html) {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><body>${html}</body>`,
    "text/html"
  );
  return doc.body;
}

function normalizeCellText(el) {
  return (el?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mightBeEgeInf22Task(html) {
  if (!html || typeof html !== "string") return false;
  if (/\bege-inf-22-task\b/i.test(html)) return false;
  return (
    /вычислительных\s+процессов/i.test(html) &&
    (/типовой\s+пример\s+организации\s+данных/i.test(html) ||
      /пример\s+организации\s+данных/i.test(html))
  );
}

function repairDashMathSpans(root) {
  root.querySelectorAll(".math-inline").forEach((span) => {
    const t = (span.textContent || "")
      .replace(/\\\(|\\\)/g, "")
      .replace(/\s+/g, "")
      .trim();
    if (/\\?\([–—−-]\\?\)/.test(t)) {
      span.replaceWith(root.ownerDocument.createTextNode(" – "));
    }
  });
}

function cellHasContentBesidesTable(cell, nestedTable) {
  if (!cell) return false;
  return [...cell.childNodes].some((node) => {
    if (node === nestedTable) return false;
    if (node.nodeType === 3) return (node.textContent || "").trim().length > 0;
    if (node.nodeType !== 1) return false;
    if (node.tagName === "BR") return false;
    return (
      normalizeCellText(node).length > 0 ||
      !!node.querySelector("img, table, p, div, ul, ol")
    );
  });
}

function unwrapSingleCellOuterTable(root) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const table of [...root.querySelectorAll("table")]) {
      const directRows = [
        ...table.querySelectorAll(":scope > tbody > tr, :scope > tr"),
      ];
      const nestedTables = directRows
        .map((row) =>
          row.querySelector(":scope > td > table, :scope > th > table")
        )
        .filter(Boolean);
      if (nestedTables.length !== 1) continue;

      const inner = nestedTables[0];
      const wrapperCell = inner.closest("td, th");
      if (cellHasContentBesidesTable(wrapperCell, inner)) continue;

      const wrapperRows = directRows.every((row) => {
        const cell = row.querySelector(":scope > td, :scope > th");
        if (cell?.querySelector(":scope > a[href^='javascript']")) return false;
        const cellTable = row.querySelector(
          ":scope > td > table, :scope > th > table"
        );
        if (cellTable === inner) return true;
        return !normalizeCellText(row) && !row.querySelector("img, a");
      });
      if (!wrapperRows) continue;

      table.replaceWith(inner);
      changed = true;
      break;
    }
  }
}

function removeEmptyTableRows(root) {
  root.querySelectorAll("tr").forEach((row) => {
    const cells = [...row.querySelectorAll(":scope > td, :scope > th")];
    if (!cells.length) {
      row.remove();
      return;
    }
    if (cells.every((c) => !normalizeCellText(c) && !c.querySelector("img, table"))) {
      row.remove();
    }
  });
  root.querySelectorAll("table").forEach((table) => {
    if (!table.querySelector("tr")) table.remove();
  });
}

function rowIsFipiFileAttachment(row) {
  const cell = row.querySelector(":scope > td, :scope > th");
  if (!cell) return false;
  // Строка-обёртка с вложенной таблицей условия — не строка файла.
  if (cell.querySelector(":scope > table")) return false;

  const html = cell.innerHTML || "";
  if (
    !/javascript:\s*var\s+wnd\s*=\s*window\.open/i.test(html) &&
    !cell.querySelector(":scope > a[href^='javascript']")
  ) {
    const imgs = cell.querySelectorAll(":scope img");
    if (!imgs.length || normalizeCellText(cell).trim()) return false;
    if (imgs.length === 1 && normalizeCellText(cell).length < 4) return true;
    return imgs.length > 0 && !normalizeCellText(cell).trim();
  }

  const text = normalizeCellText(cell);
  return !text || text.length < 24 || /^открыть\s+файл/i.test(text);
}

function removeFipiFileAttachmentRows(root) {
  root.querySelectorAll("tr").forEach((row) => {
    if (rowIsFipiFileAttachment(row)) row.remove();
  });
}

function isDecorativeFipiImage(img) {
  if (!img) return false;
  const src = (img.getAttribute("src") || "").toLowerCase();
  const cls = img.getAttribute("class") || "";
  return (
    cls.includes("fipi-inline-formula") ||
    img.getAttribute("alt") === "undefined" ||
    /xs3qstsrc/i.test(src) ||
    /_simg1_/i.test(src) ||
    /_simg2_/i.test(src)
  );
}

function removeTrailingDuplicateImages(root) {
  root.querySelectorAll("p, div.task-html-block").forEach((p) => {
    const imgs = [...p.querySelectorAll("img")];
    if (!imgs.length) return;
    const text = normalizeCellText(p);
    const decorativeOnly =
      imgs.every(isDecorativeFipiImage) &&
      (!text || /^открыть\s+файл/i.test(text));
    const imgOnly =
      decorativeOnly ||
      (!text && imgs.length > 0) ||
      imgs.some(
        (img) =>
          text === normalizeCellText(img) ||
          text === (img.getAttribute("alt") || "").trim()
      );
    if (imgOnly) p.remove();
  });
  root.querySelectorAll("img").forEach((img) => {
    if (isDecorativeFipiImage(img)) img.remove();
  });
}

function simplifyInlineSpans(text) {
  return String(text || "")
    .replace(/<span>\s*ID\s*<\/span>\s*процесса/gi, "ID процесса")
    .replace(/<span>\s*ID\s*<\/span>\s*(?=процесса)/gi, "ID ")
    .replace(/(<\/span>)([А-Яа-яA-Za-z])/g, "$1 $2");
}

function tableLooksLikeProcessExample(table) {
  const rows = [...table.querySelectorAll(":scope > tbody > tr, :scope > tr")];
  if (rows.length < 2 || rows.length > 8) return false;
  const firstRow = rows[0];
  const cells = [...firstRow.querySelectorAll(":scope > td, :scope > th")];
  if (cells.length < 3 || cells.length > 5) return false;
  const hdr = normalizeCellText(firstRow);
  if (hdr.length > 180) return false;
  if (/вычислительных\s+процессов|типовой\s+пример/i.test(hdr)) return false;
  return (
    /ID/i.test(hdr) &&
    /процесс/i.test(hdr) &&
    /время/i.test(hdr) &&
    /мс/i.test(hdr)
  );
}

function enhanceProcessExampleTable(table) {
  if (!tableLooksLikeProcessExample(table)) return false;

  table.classList.add("ege-inf-22-process-table");
  const doc = table.ownerDocument;
  const rows = [...table.querySelectorAll(":scope > tbody > tr, :scope > tr")];
  if (!rows.length) return false;

  const thead = doc.createElement("thead");
  const headTr = doc.createElement("tr");
  const headerCells = [...rows[0].querySelectorAll(":scope > td, :scope > th")];
  headerCells.forEach((cell) => {
    const th = doc.createElement("th");
    const headerHtml = simplifyInlineSpans(cell.innerHTML)
      .replace(/<\/?p[^>]*>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    th.innerHTML = headerHtml;
    headTr.appendChild(th);
  });
  thead.appendChild(headTr);

  const tbody = doc.createElement("tbody");
  rows.slice(1).forEach((row) => {
    const tr = doc.createElement("tr");
    [...row.querySelectorAll(":scope > td, :scope > th")].forEach((cell) => {
      const td = doc.createElement("td");
      td.textContent = normalizeCellText(cell);
      tr.appendChild(td);
    });
    if (tr.children.length) tbody.appendChild(tr);
  });

  table.innerHTML = "";
  table.appendChild(thead);
  table.appendChild(tbody);
  return true;
}

function styleFileNotice(root) {
  root.querySelectorAll(".task-html-block").forEach((block) => {
    const text = normalizeCellText(block);
    if (!/прилагаем/i.test(text) || !/файл/i.test(text)) return;
    block.querySelectorAll("img.fipi-inline-formula, img[alt='undefined']").forEach((img) => {
      img.remove();
    });
    block.classList.add("ege-inf-file-notice", "ege-inf-22-file-notice");
  });
}

function unwrapContentWrapperTable(root) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const table of [...root.querySelectorAll("table")]) {
      if (table.classList.contains("ege-inf-22-process-table")) continue;
      const rows = [
        ...table.querySelectorAll(":scope > tbody > tr, :scope > tr"),
      ];
      if (rows.length !== 1) continue;
      const cell = rows[0].querySelector(":scope > td, :scope > th");
      if (!cell) continue;
      if (cell.querySelector(":scope > table table")) continue;
      const frag = root.ownerDocument.createDocumentFragment();
      while (cell.firstChild) frag.appendChild(cell.firstChild);
      table.replaceWith(frag);
      changed = true;
      break;
    }
  }
}

/**
 * @param {string} html
 * @returns {string}
 */
export function formatEgeInf22ParallelProcessesHtml(html) {
  if (html == null || typeof html !== "string") return html;
  const trimmed = html.trim();
  if (!trimmed || !mightBeEgeInf22Task(trimmed)) return html;

  const root = parseHtmlFragment(trimmed);
  if (!root) return html;

  repairDashMathSpans(root);
  removeFipiFileAttachmentRows(root);
  removeEmptyTableRows(root);
  unwrapSingleCellOuterTable(root);
  unwrapContentWrapperTable(root);
  styleFileNotice(root);

  root.querySelectorAll("table").forEach((table) => {
    enhanceProcessExampleTable(table);
  });
  removeTrailingDuplicateImages(root);

  const wrap = root.ownerDocument.createElement("div");
  wrap.className = "ege-inf-22-task";
  wrap.innerHTML = root.innerHTML;
  return wrap.outerHTML;
}
