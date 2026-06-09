/**
 * ЕГЭ информатика №1 — схема дорог + таблица (звёздочки / расстояния).
 * Чистит хвост ФИПИ, превращает ShowPictureQ в <img>, выравнивает порядок блоков.
 */

const DOC_POS_FOLLOWING = 4;

function parseHtmlFragment(html) {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(
      `<!DOCTYPE html><html><body>${html}</body></html>`,
      "text/html"
    );
    const body = doc.body;
    if (body?.innerHTML?.trim() || body?.querySelector("img, table, p")) {
      return body;
    }
  }
  if (typeof document !== "undefined") {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
  }
  return null;
}

function htmlHasVisibleContent(html) {
  if (!html || !String(html).trim()) return false;
  if (/<img\b/i.test(html)) return true;
  const stripped = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 0;
}

function normalizeCellText(el) {
  return (el?.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RE_POINT_LABEL = /(?:[ПпPp]\s*[1-9]|(?:^|[^A-Za-zА-Яа-яЁё])[A-ZА-ЯЁ](?![A-Za-zА-Яа-яЁё])|\b[1-9]\b)/;

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

function showPictureToMediaSrc(raw) {
  const m = String(raw || "").match(/ShowPictureQ\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
  if (!m) return null;
  const path = m[1];
  const xs = path.match(/(xs3qstsrc[\w.-]+)/i);
  if (xs) return `/media/task_files/${xs[1]}`;
  const base = path.split("/").pop()?.split("?")[0];
  return base ? `/media/task_files/${base}` : null;
}

export function mightBeEgeInf1RoadTask(html) {
  if (html == null || typeof html !== "string") return false;
  if (/\bege-inf-1-task\b/i.test(html)) return false;

  const s = html.toLowerCase();
  const roadContext =
    /схем[аеу]?\s+дорог/.test(s) ||
    /дорог\s+[a-zа-яё]-?ского\s+района/.test(s) ||
    /протяж[ёe]нност/.test(s) ||
    /стоимость\s+перевозок/.test(s);

  if (!roadContext && !/номер\s+пункта/.test(s)) return false;

  if (
    /стоимость\s+перевозок|соответствующую\s+таблиц/i.test(s) &&
    /<(?:b|strong)[^>]*>\s*1\)\s*<\/(?:b|strong)>/i.test(html) &&
    /<(?:b|strong)[^>]*>\s*2\)\s*<\/(?:b|strong)>/i.test(html)
  ) {
    return false;
  }

  return (
    /зв[ёe]здочк/i.test(s) ||
    /номер\s+пункта/i.test(s) ||
    /ShowPictureQ/i.test(html) ||
    (/протяж[ёe]нност/i.test(s) && /<table\b/i.test(html)) ||
    (/[ПпPp]\s*[1-7]/.test(html) && /<table\b/i.test(html))
  );
}

function repairLeadingParagraph(html) {
  const s = String(html || "").trimStart();
  if (!s || /^<[a-z]/i.test(s)) return html;
  const end = s.indexOf("</p>");
  if (end === -1) return `<p>${s}</p>`;
  return `<p>${s.slice(0, end)}${s.slice(end)}`;
}

function stripFipiTailGarbage(root) {
  root.querySelectorAll("form, input[type='hidden']").forEach((el) => el.remove());
  root.querySelectorAll("script:not([type='math/tex'])").forEach((el) => {
    if (/ShowPictureQ/i.test(el.textContent || el.innerHTML || "")) return;
    el.remove();
  });
}

function convertShowPictureScripts(root) {
  root.querySelectorAll("script").forEach((script) => {
    const src = showPictureToMediaSrc(script.textContent || script.innerHTML || "");
    if (!src) {
      script.remove();
      return;
    }
    const img = root.ownerDocument.createElement("img");
    img.src = src;
    img.alt = "";
    img.className = "ege-inf-1-graph-img";
    const host = script.closest("p, div.task-html-block, td, span") || script.parentElement;
    if (host && (host.tagName === "P" || host.classList.contains("task-html-block"))) {
      host.innerHTML = "";
      host.appendChild(img);
      host.classList.add("ege-inf-1-graph");
    } else {
      script.replaceWith(img);
    }
  });
}

function tableDirectRows(table) {
  const body = table.querySelector(":scope > tbody") || table;
  return [...body.querySelectorAll(":scope > tr")];
}

function rowPointLabels(row) {
  return [...row.querySelectorAll(":scope > td, :scope > th")].map((cell) =>
    normalizeCellText(cell)
  );
}

function tableIsRoadMatrix(table) {
  if (!table) return false;
  const text = normalizeCellText(table);
  if (text.length < 8) return false;
  const rows = tableDirectRows(table);
  if (rows.length < 4) return false;

  if (/<(?:b|strong)[^>]*>\s*[1234]\)/i.test(table.innerHTML) || /\b[12]\)\s/i.test(text)) {
    return false;
  }

  const hasPointHeader = /номер\s+пункта/i.test(text);
  const hasPointLabels =
    hasPointHeader ||
    /[ПпPp]\s*[1-9]/.test(text) ||
    RE_POINT_LABEL.test(text);
  const hasStars = /\*/.test(text);
  const hasDistances = /\b\d{1,3}\b/.test(text) && hasPointLabels;

  if (!hasPointLabels) return false;
  return hasPointHeader || hasStars || hasDistances;
}

function reconstructFlattenedFipiMatrix(root) {
  let blocks = [...root.querySelectorAll(".task-html-block")];
  if (blocks.length < 10) {
    blocks = [...root.querySelectorAll("p")].filter(p => !p.closest("table") && !p.closest(".ege-inf-1-road-table"));
  }
  if (blocks.length < 10) return false;

  const texts = blocks.map((b) => normalizeCellText(b));
  let headerStart = -1;
  let headerEnd = -1;

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i].replace(/\s+/g, " ").trim().toLowerCase();
    if (t === "номер пункта" || t === "пункт") {
      if (headerStart === -1) {
        headerStart = i;
      } else {
        headerEnd = i;
        break;
      }
    }
  }

  if (headerStart === -1) return false;

  function inferSingleHeaderLabelsAndTokenStart() {
    const inferred = [];
    for (let i = headerStart + 1; i < texts.length; i++) {
      const t = texts[i];
      if (!t || blocks[i].querySelector("img")) continue;
      if (!cellTextIsPointLabel(t)) {
        if (inferred.length >= 3) return { labels: inferred, tokenStart: i };
        return null;
      }
      // Частый случай: после списка 1..N сразу снова идёт "1" как начало строк матрицы.
      if (inferred.length >= 3 && t === inferred[0]) {
        return { labels: inferred, tokenStart: i };
      }
      if (inferred.includes(t)) return null;
      inferred.push(t);
      if (inferred.length > 15) return null;
    }
    return null;
  }

  let labels = [];
  let tokenStart = -1;

  if (headerEnd !== -1) {
    for (let i = headerStart + 1; i < headerEnd; i++) {
      const t = texts[i];
      if (t && cellTextIsPointLabel(t) && !blocks[i].querySelector("img")) {
        labels.push(t);
      }
    }
    tokenStart = headerEnd + 1;
  }

  if (labels.length < 3 || labels.length > 15 || tokenStart === -1) {
    const inferred = inferSingleHeaderLabelsAndTokenStart();
    if (!inferred) return false;
    labels = inferred.labels;
    tokenStart = inferred.tokenStart;
    headerEnd = tokenStart - 1;
  }

  const N = labels.length;
  if (N < 3 || N > 15) return false;

  const tokens = [];
  for (let i = tokenStart; i < texts.length; i++) {
    const t = texts[i];
    if (t && !blocks[i].querySelector("img")) {
      tokens.push(t);
    }
  }

  let solutions = [];

  function searchPartitions(labelIdx, tokenIdx, currentLists) {
    if (solutions.length > 0) return; // Stop early if found
    if (labelIdx === N) {
      if (tokenIdx === tokens.length) {
        const matrix = buildMatrix(currentLists);
        if (matrix) solutions.push(matrix);
      }
      return;
    }
    const nextLabelIdx = labelIdx + 1;
    if (nextLabelIdx === N) {
      const list = tokens.slice(tokenIdx);
      const matrix = buildMatrix([...currentLists, list]);
      if (matrix) solutions.push(matrix);
    } else {
      for (let j = tokenIdx; j <= tokens.length; j++) {
        if (j === tokens.length || tokens[j] === labels[nextLabelIdx]) {
          const list = tokens.slice(tokenIdx, j);
          searchPartitions(nextLabelIdx, j + 1, [...currentLists, list]);
        }
      }
    }
  }

  function buildMatrix(lists) {
    let matrix = Array(N).fill(0).map(() => Array(N).fill(null));
    function solve(r, c, idx) {
      if (r === N) return true;
      if (c === N) {
        if (idx === lists[r].length) return solve(r + 1, 0, 0);
        return false;
      }
      if (r === c) return solve(r, c + 1, idx);
      if (c < r) {
        if (matrix[r][c] !== null) {
          if (idx < lists[r].length && lists[r][idx] === matrix[r][c]) {
            return solve(r, c + 1, idx + 1);
          }
          return false;
        }
        return solve(r, c + 1, idx);
      }
      if (solve(r, c + 1, idx)) return true;
      if (idx < lists[r].length) {
        const val = lists[r][idx];
        matrix[r][c] = val;
        matrix[c][r] = val;
        if (solve(r, c + 1, idx + 1)) return true;
        matrix[r][c] = null;
        matrix[c][r] = null;
      }
      return false;
    }
    if (solve(0, 0, 0)) return matrix;
    return null;
  }

  if (tokens[0] === labels[0]) {
    searchPartitions(0, 1, []);
  }

  if (solutions.length === 0) return false;

  const matrix = solutions[0];
  const doc = root.ownerDocument;
  const table = doc.createElement("table");
  table.className = "MsoNormalTable";
  table.setAttribute("border", "1");

  const tbody = doc.createElement("tbody");
  const trH1 = doc.createElement("tr");
  const tdTitle = doc.createElement("td");
  tdTitle.setAttribute("colspan", String(N + 1));
  tdTitle.innerHTML = `<p>${texts[headerStart]}</p>`;
  trH1.appendChild(tdTitle);
  tbody.appendChild(trH1);

  const trH2 = doc.createElement("tr");
  const tdEmpty = doc.createElement("td");
  tdEmpty.innerHTML = "&nbsp;";
  trH2.appendChild(tdEmpty);
  labels.forEach((l) => {
    const td = doc.createElement("td");
    td.innerHTML = `<p>${l}</p>`;
    trH2.appendChild(td);
  });
  tbody.appendChild(trH2);

  labels.forEach((l, i) => {
    const tr = doc.createElement("tr");
    const tdL = doc.createElement("td");
    tdL.innerHTML = `<p>${l}</p>`;
    tr.appendChild(tdL);

    for (let j = 0; j < N; j++) {
      const td = doc.createElement("td");
      if (matrix[i][j] !== null) {
        td.innerHTML = `<p>${matrix[i][j]}</p>`;
      } else {
        td.innerHTML = "&nbsp;";
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);

  // Insert the reconstructed table before the first block
  blocks[headerStart].parentNode.insertBefore(table, blocks[headerStart]);

  // Remove the old flattened blocks up to the end of the tokens
  // Determine the last block that was part of the matrix
  let tokensMatched = 0;
  let lastBlockIdx = headerEnd;
  for (let i = headerEnd + 1; i < blocks.length; i++) {
    const t = texts[i];
    if (t && !blocks[i].querySelector("img")) {
      tokensMatched++;
      lastBlockIdx = i;
    }
    if (tokensMatched === tokens.length) break;
  }

  for (let i = headerStart; i <= lastBlockIdx; i++) {
    if (!blocks[i].querySelector("img")) {
      blocks[i].remove();
    }
  }

  return true;
}

function findBestRoadMatrix(root) {
  let best = null;
  let bestScore = -1;
  root.querySelectorAll("table").forEach((table) => {
    if (!tableIsRoadMatrix(table)) return;
    let inner = table;
    while (true) {
      const nested = [...inner.querySelectorAll(":scope td > table, :scope th > table")].find(
        tableIsRoadMatrix
      );
      if (!nested) break;
      inner = nested;
    }
    const rows = tableDirectRows(inner).length;
    const cells = inner.querySelectorAll("td, th").length;
    // Предпочитаем самую вложенную матрицу, не обёртку с текстом условия.
    const depth = [...inner.querySelectorAll("table")].length;
    const score = depth * 1000 + rows * 10 + cells;
    if (score > bestScore) {
      bestScore = score;
      best = inner;
    }
  });
  return best;
}

function ensureCell(doc, tagName) {
  const cell = doc.createElement(tagName === "th" ? "th" : "td");
  cell.innerHTML = "&nbsp;";
  return cell;
}

function setCellText(cell, text) {
  cell.textContent = text || "";
  if (!text) cell.innerHTML = "&nbsp;";
}

/** Разреженная матрица ФИПИ: дополняем строки пустыми ячейками до полной сетки. */
function normalizeSparseRoadMatrix(table) {
  const rows = tableDirectRows(table);
  if (rows.length < 3) return;
  const doc = table.ownerDocument;
  const directCells = (row) => [...row.querySelectorAll(":scope > td, :scope > th")];

  const headerLabels = directCells(rows[0])
    .map((cell) => normalizeCellText(cell))
    .filter((text) => cellTextIsPointLabel(text));
  if (headerLabels.length < 3) return;

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
      // Метки пунктов внутри строки матрицы не считаем весами рёбер.
      if (cellTextIsPointLabel(t)) continue;
      values.push(t);
    }
    byLabel.set(rowLabel, values);
  }

  if (!headerLabels.every((label) => byLabel.has(label))) return;
  const lists = headerLabels.map((label) => byLabel.get(label) || []);
  const N = headerLabels.length;

  const matrix = Array.from({ length: N }, () => Array(N).fill(null));
  const solve = (r, c, idx) => {
    if (r === N) return true;
    if (c === N) {
      return idx === lists[r].length ? solve(r + 1, 0, 0) : false;
    }
    if (c === r) return solve(r, c + 1, idx);

    if (matrix[r][c] !== null) {
      return idx < lists[r].length && lists[r][idx] === matrix[r][c]
        ? solve(r, c + 1, idx + 1)
        : false;
    }

    if (solve(r, c + 1, idx)) return true;

    if (idx < lists[r].length) {
      const val = lists[r][idx];
      matrix[r][c] = val;
      matrix[c][r] = val;
      if (solve(r, c + 1, idx + 1)) return true;
      matrix[r][c] = null;
      matrix[c][r] = null;
    }
    return false;
  };

  if (!solve(0, 0, 0)) return;

  const tbody = doc.createElement("tbody");
  const headRow = doc.createElement("tr");
  const corner = doc.createElement("th");
  corner.innerHTML = "&nbsp;";
  headRow.appendChild(corner);
  headerLabels.forEach((label) => {
    const th = doc.createElement("th");
    th.innerHTML = `<p>${label}</p>`;
    headRow.appendChild(th);
  });
  tbody.appendChild(headRow);

  for (let r = 0; r < N; r++) {
    const tr = doc.createElement("tr");
    const rowHead = doc.createElement("th");
    rowHead.innerHTML = `<p>${headerLabels[r]}</p>`;
    tr.appendChild(rowHead);
    for (let c = 0; c < N; c++) {
      const td = doc.createElement("td");
      const val = matrix[r][c];
      td.innerHTML = val == null ? "&nbsp;" : `<p>${val}</p>`;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.innerHTML = "";
  table.appendChild(tbody);
}

function removeEmptyTableRows(root) {
  root.querySelectorAll("tr").forEach((row) => {
    const cells = [...row.querySelectorAll(":scope > td, :scope > th")];
    if (!cells.length) {
      row.remove();
      return;
    }
    if (cells.every((c) => !normalizeCellText(c) && !c.querySelector("img, table, svg, script"))) {
      row.remove();
    }
  });
  root.querySelectorAll("table").forEach((table) => {
    if (!table.querySelector("tr")) table.remove();
  });
}

function unwrapSideBySideLayout(root) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const table of [...root.querySelectorAll("table")]) {
      const rows = tableDirectRows(table);
      if (rows.length !== 1) continue;
      const cells = [...rows[0].querySelectorAll(":scope > td, :scope > th")];
      if (cells.length !== 2) continue;
      const hasMatrix = cells.some((c) => c.querySelector("table"));
      const hasGraph = cells.some(
        (c) => c.querySelector("img, script") || /ShowPictureQ/i.test(c.innerHTML || "")
      );
      if (!hasMatrix || !hasGraph) continue;
      const frag = root.ownerDocument.createDocumentFragment();
      cells.forEach((cell) => {
        while (cell.firstChild) frag.appendChild(cell.firstChild);
      });
      table.replaceWith(frag);
      changed = true;
      break;
    }
  }
}

function unwrapSingleCellWrapperTables(root) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const table of [...root.querySelectorAll("table")]) {
      if (table.classList.contains("ege-inf-1-road-table")) continue;
      const rows = tableDirectRows(table);
      if (rows.length !== 1) continue;
      const cells = [...rows[0].querySelectorAll(":scope > td, :scope > th")];
      if (cells.length !== 1) continue;
      const cell = cells[0];
      const innerTable = cell.querySelector(":scope > table");
      if (!innerTable || tableIsRoadMatrix(table)) continue;
      // Если это не обёртка над другой таблицей, а просто текстовый блок в рамке, не трогаем
      if (!cell.querySelector("table") && normalizeCellText(cell).length > 4 && !cell.querySelector("img")) continue;
      
      const frag = root.ownerDocument.createDocumentFragment();
      while (cell.firstChild) frag.appendChild(cell.firstChild);
      table.replaceWith(frag);
      changed = true;
      break;
    }
  }
}

function removeEmptyBlocks(root) {
  root.querySelectorAll("p, div.task-html-block, table").forEach((el) => {
    if (el.classList.contains("ege-inf-1-road-table")) return;
    if (el.tagName === "TABLE" && tableIsRoadMatrix(el)) return;
    const text = normalizeCellText(el);
    const hasMedia = el.querySelector("img, table, svg, mjx-container");
    if (!text && !hasMedia) el.remove();
  });
}

function tagParagraphRoles(root) {
  root.querySelectorAll("p, div.task-html-block").forEach((node) => {
    const t = normalizeCellText(node);
    if (/^на\s+рисунке/i.test(t) && /(дорог|таблиц)/i.test(t)) {
      node.classList.add("ege-inf-1-intro");
      if (/справа/i.test(t)) node.classList.add("ege-inf-1-intro--graph-right");
      return;
    }
    if (/каждому\s+населённому|так\s+как\s+таблицу/i.test(t)) {
      node.classList.add("ege-inf-1-question");
    }
    if (node.querySelector("img.ege-inf-1-graph-img")) {
      node.classList.add("ege-inf-1-graph");
    }
  });
}

function wrapRoadTable(matrixTable) {
  if (!matrixTable) return;
  // Нормализуем разрежённую матрицу так, чтобы веса попадали в правильные колонки.
  normalizeSparseRoadMatrix(matrixTable);
  matrixTable.classList.add("ege-inf-1-road-table");
  if (matrixTable.parentElement?.classList.contains("ege-inf-1-matrix-wrap")) return;
  const doc = matrixTable.ownerDocument;
  const wrap = doc.createElement("div");
  wrap.className = "ege-inf-1-matrix-wrap";
  matrixTable.parentNode.insertBefore(wrap, matrixTable);
  wrap.appendChild(matrixTable);
}

function dedupeGraphImages(root) {
  const seen = new Set();
  [...root.querySelectorAll("img")].forEach((img) => {
    const src = (img.getAttribute("src") || "").trim();
    if (!src) return;
    img.classList.remove("fipi-inline-formula");
    if (src.includes("math") || src.includes("mjx")) return;
    
    img.classList.add("ege-inf-1-graph-img");
    if (seen.has(src)) {
      const host = img.closest("p, figure, div.task-html-block");
      if (host && host.querySelectorAll("img").length === 1) host.remove();
      else img.remove();
      return;
    }
    seen.add(src);
    if (!img.closest(".ege-inf-1-graph")) {
      const host = img.closest("p, div.task-html-block");
      if (host) host.classList.add("ege-inf-1-graph");
    }
  });
}

function buildSideBySideBody(root) {
  const introRight = root.querySelector(".ege-inf-1-intro--graph-right");
  const matrixWrap = root.querySelector(".ege-inf-1-matrix-wrap");
  const graph = root.querySelector(".ege-inf-1-graph");
  if (!matrixWrap || !graph) return;

  const doc = root.ownerDocument;
  const body = doc.createElement("div");
  body.className = "ege-inf-1-body";

  const taskRoot = root.querySelector(".ege-inf-1-task") || root;
  const insertBefore =
    graph.compareDocumentPosition(matrixWrap) & DOC_POS_FOLLOWING ? matrixWrap : graph;

  if (insertBefore && insertBefore.parentNode) {
    insertBefore.parentNode.insertBefore(body, insertBefore);
  } else {
    taskRoot.insertBefore(body, insertBefore);
  }
  body.appendChild(matrixWrap);
  body.appendChild(graph);

  if (introRight) body.classList.add("ege-inf-1-body--graph-right");
}

function reorderGraphBeforeMatrix(root, matrixTable) {
  if (root.querySelector(".ege-inf-1-body")) return;
  if (root.querySelector(".ege-inf-1-intro--graph-right")) return;
  if (!matrixTable) return;

  const matrixBlock = matrixTable.closest(".ege-inf-1-matrix-wrap") || matrixTable;
  const graph =
    root.querySelector(".ege-inf-1-graph") ||
    root.querySelector("img.ege-inf-1-graph-img")?.closest("p, figure, div.task-html-block") ||
    root.querySelector("img")?.closest("p, figure, div.task-html-block");
  if (!graph || graph === matrixBlock) return;
  if (matrixBlock.compareDocumentPosition(graph) & DOC_POS_FOLLOWING) {
    matrixBlock.parentNode?.insertBefore(graph, matrixBlock);
  }
}

function keepOnlyPrimaryRoadGraph(root) {
  const removeImageHost = (img) => {
    if (!img) return;
    const host = img.closest(".ege-inf-1-graph, p, figure, div.task-html-block");
    if (!host || host === img) {
      img.remove();
      return;
    }
    const imgs = host.querySelectorAll("img");
    if (imgs.length <= 1) host.remove();
    else img.remove();
  };

  // Ищем первую картинку графа (которую мы пометили в dedupeGraphImages)
  const primaryGraphImg = root.querySelector("img.ege-inf-1-graph-img");
  if (!primaryGraphImg) {
    // Фолбэк: если почему-то нет класса, берём просто первую подходящую картинку
    const allImgs = [...root.querySelectorAll("img")].filter((img) => {
      const src = (img.getAttribute("src") || "").trim();
      return src && !src.includes("math") && !src.includes("mjx");
    });
    if (allImgs.length <= 1) return;
    
    // Удаляем все, кроме первой
    allImgs.slice(1).forEach(removeImageHost);
    return;
  }

  // Если нашли primaryGraphImg, удаляем ВСЕ остальные картинки в задании (кроме math/mjx),
  // так как в задании 1 всегда только один граф.
  [...root.querySelectorAll("img")].forEach((img) => {
    if (img === primaryGraphImg) return;
    
    // Пропускаем формулы
    const src = (img.getAttribute("src") || "").trim();
    if (src.includes("math") || src.includes("mjx")) return;
    
    removeImageHost(img);
  });

  // Также зачистим пустые блоки графа
  const graphBlocks = [...root.querySelectorAll(".ege-inf-1-graph")];
  graphBlocks.forEach(block => {
    if (!block.querySelector("img")) {
      block.remove();
    }
  });
}

function wrapTaskRoot(root) {
  if (root.querySelector(":scope > .ege-inf-1-task")) return;
  const wrap = root.ownerDocument.createElement("div");
  wrap.className = "ege-inf-1-task";
  while (root.firstChild) wrap.appendChild(root.firstChild);
  root.appendChild(wrap);
}

/**
 * @param {string} html
 * @returns {string}
 */
export function formatEgeInf1RoadGraphHtml(html) {
  if (html == null || typeof html !== "string") return html;
  const trimmed = html.trim();
  if (!trimmed || !mightBeEgeInf1RoadTask(trimmed)) return html;

  try {
    const repaired = repairLeadingParagraph(trimmed);
    const root = parseHtmlFragment(repaired);
    if (!root || !htmlHasVisibleContent(root.innerHTML)) return html;

    stripFipiTailGarbage(root);
    convertShowPictureScripts(root);
    removeEmptyTableRows(root);
    unwrapSideBySideLayout(root);
    unwrapSingleCellWrapperTables(root);
    reconstructFlattenedFipiMatrix(root);
    removeEmptyBlocks(root);

    if (!htmlHasVisibleContent(root.innerHTML)) return html;

    const matrixTable = findBestRoadMatrix(root);
    if (matrixTable) wrapRoadTable(matrixTable);

    tagParagraphRoles(root);
    dedupeGraphImages(root);
    buildSideBySideBody(root);
    reorderGraphBeforeMatrix(root, matrixTable);
    keepOnlyPrimaryRoadGraph(root);
    wrapTaskRoot(root);

    const result = root.innerHTML;
    if (!htmlHasVisibleContent(result)) return html;
    return result;
  } catch (err) {
    console.error("FORMAT_ERROR:", err);
    return html;
  }
}
