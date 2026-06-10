export function mightBeEgeInf2TruthTableTask(html) {
  if (html == null || typeof html !== "string") return false;
  if (/\bege-inf-2-task\b/i.test(html)) return false;

  const s = html.toLowerCase();
  return /таблиц[а-я]*\s+истинности/i.test(s) && /<table\b/i.test(html);
}

function normalizeCellText(el) {
  return (el?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reconstructFlattenedExampleTable(root) {
  // Ищем только верхнеуровневые блоки-соседи, чтобы не захватить вложенные <p>
  const blocks = [...root.querySelectorAll(".task-html-block, p")].filter(el => 
    !el.parentElement.closest(".task-html-block, p")
  );

  for (let i = 0; i <= blocks.length - 4; i++) {
    const b1 = blocks[i];
    const b2 = blocks[i+1];
    const b3 = blocks[i+2];
    const b4 = blocks[i+3];

    // Проверяем, что элементы находятся на одном уровне и следуют друг за другом
    if (b1.nextElementSibling !== b2 || b2.nextElementSibling !== b3 || b3.nextElementSibling !== b4) continue;

    const t1 = normalizeCellText(b1);
    const t2 = normalizeCellText(b2);
    const t3 = normalizeCellText(b3);
    const t4 = normalizeCellText(b4);

    if (t1.length > 2 && /^[01]$/.test(t2) && /^[01]$/.test(t3) && /^[01]$/.test(t4)) {
      // Похоже на расплющенный пример из задания: Формула, 0, 1, 0.
      const doc = root.ownerDocument;
      const table = doc.createElement("table");
      table.className = "ege-inf-2-truth-table ege-inf-2-example-table";
      table.setAttribute("border", "1");
      const tbody = doc.createElement("tbody");

      const tr1 = doc.createElement("tr");
      const td1 = doc.createElement("td");
      while (b1.firstChild) td1.appendChild(b1.firstChild);
      tr1.appendChild(td1);
      tbody.appendChild(tr1);

      const tr2 = doc.createElement("tr");
      const td2 = doc.createElement("td");
      while (b2.firstChild) td2.appendChild(b2.firstChild);
      tr2.appendChild(td2);
      tbody.appendChild(tr2);

      const tr3 = doc.createElement("tr");
      const td3 = doc.createElement("td");
      while (b3.firstChild) td3.appendChild(b3.firstChild);
      tr3.appendChild(td3);
      
      const td4 = doc.createElement("td");
      while (b4.firstChild) td4.appendChild(b4.firstChild);
      tr3.appendChild(td4);
      tbody.appendChild(tr3);

      table.appendChild(tbody);
      
      b1.parentNode.insertBefore(table, b1);
      b1.remove();
      b2.remove();
      b3.remove();
      b4.remove();
      
      i += 3;
    }
  }
}

function normalizeSparseTruthTables(root) {
  const MAX_TABLE_ROWS = 60;

  const directRows = (table) => {
    const body = table.querySelector(":scope > tbody") || table;
    return [...body.querySelectorAll(":scope > tr")];
  };

  const tryNormalizeTruthTable = (table) => {
    const rows = directRows(table);
    if (rows.length < 3 || rows.length > MAX_TABLE_ROWS) return false;

    const rowCells = rows.map((row) => [...row.querySelectorAll(":scope > td, :scope > th")]);
    const counts = rowCells.map(c => c.length);
    const maxCols = Math.max(...counts);
    // Для задачи 2: первая строка (заголовок) может содержать только 1 ячейку, 
    // вторая строка - 2, третья - 4, четвертая - 5 и т.д.
    if (maxCols < 2) return false;
    
    // Проверим, похожа ли таблица на таблицу истинности.
    let zeroOneCount = 0;
    let totalCells = 0;
    rowCells.forEach((cells, r) => {
      // Игнорируем первую строку (там формула)
      if (r === 0) return;
      cells.forEach(cell => {
        totalCells++;
        const text = normalizeCellText(cell);
        if (text === '0' || text === '1') zeroOneCount++;
      });
    });

    if (totalCells === 0 || zeroOneCount / totalCells < 0.5) return false;

    const hasSpans = rowCells.some((cells) =>
      cells.some((cell) => {
        const cs = parseInt(cell.getAttribute("colspan") || "1", 10);
        const rs = parseInt(cell.getAttribute("rowspan") || "1", 10);
        return cs > 1 || rs > 1;
      })
    );

    const isStaircase = !hasSpans && counts[0] === 1 && maxCols > 1;

    // Выравниваем вправо (формула должна быть в последнем столбце) ТОЛЬКО для лесенки
    if (isStaircase) {
      rows.forEach((row, r) => {
        const cells = rowCells[r];
        const missing = maxCols - cells.length;
        for (let i = 0; i < missing; i++) {
          const td = table.ownerDocument.createElement(cells[0]?.tagName?.toLowerCase() === "th" ? "th" : "td");
          td.innerHTML = "&nbsp;";
          row.insertBefore(td, cells[0]);
        }
      });
    }

    table.classList.add("ege-inf-2-truth-table");
    table.setAttribute("border", "1");
    // Если на таблице уже есть классы, сохраняем, иначе можно добавить базовый
    
    return true;
  };

  root.querySelectorAll("table").forEach((table) => {
    tryNormalizeTruthTable(table);
  });
}

export function formatEgeInf2TruthTableHtml(html) {
  if (html == null || typeof html !== "string") return html;
  const trimmed = html.trim();
  if (!trimmed || !mightBeEgeInf2TruthTableTask(trimmed)) return html;

  try {
    let doc;
    if (typeof DOMParser !== "undefined") {
      doc = new DOMParser().parseFromString(
        `<!DOCTYPE html><html><body>${trimmed}</body></html>`,
        "text/html"
      ).body;
    } else if (typeof document !== "undefined") {
      doc = document.createElement("div");
      doc.innerHTML = trimmed;
    } else {
      return html;
    }

    reconstructFlattenedExampleTable(doc);
    normalizeSparseTruthTables(doc);

    const wrap = doc.ownerDocument.createElement("div");
    wrap.className = "ege-inf-2-task";
    while (doc.firstChild) wrap.appendChild(doc.firstChild);
    doc.appendChild(wrap);

    return doc.innerHTML;
  } catch (err) {
    console.error("FORMAT_ERROR:", err);
    return html;
  }
}
