/** Physical page geometry and flow pagination for the worksheet editor. */

export const MM_TO_PX = 96 / 25.4;
export const DEFAULT_MARGIN_MM = 12;
export const PAGE_FOOTER_PX = 28;
export const BLOCK_GAP_PX = 24;

export const PAGE_PRESETS = {
  a4: { widthMm: 210, heightMm: 297 },
  a5: { widthMm: 148, heightMm: 210 },
  letter: { widthMm: 216, heightMm: 279 },
};

export function pageSizePx(preset = "a4", orientation = "portrait") {
  const spec = PAGE_PRESETS[preset] || PAGE_PRESETS.a4;
  const width = spec.widthMm * MM_TO_PX;
  const height = spec.heightMm * MM_TO_PX;
  if (orientation === "landscape") return { width: height, height: width };
  return { width, height };
}

export function contentBox(preset, orientation, marginMm) {
  const page = pageSizePx(preset, orientation);
  const margin = marginMm * MM_TO_PX;
  return {
    page,
    margin,
    contentWidth: page.width - margin * 2,
    contentHeight: page.height - margin * 2 - PAGE_FOOTER_PX,
  };
}

export function estimateBlockHeight(block) {
  if (!block) return 88;
  if (block.type === "heading") return 40;
  if (block.type === "text") return 52;
  if (block.type === "page-break") return 0;
  const type = block.task?.type || block.task?.content?.type;
  if (type === "function_graph" || type === "graph" || type === "coordinate_plane" || type === "solid" || type === "plane") return 300;
  if (block.type === "reference" || block.type === "fact") return 96;
  if (type === "table") return 180;
  if (type === "solution" || type === "lines") return 168;
  if (type === "single_choice" || type === "choice" || type === "matching" || type === "match") return 150;
  if (type === "image_question") return 220;
  if (block.workArea?.kind && block.workArea.kind !== "none") return 120;
  return 96;
}

function blockHeight(block, heights) {
  const measured = Number(heights?.[block.id]);
  if (measured > 0) return measured;
  return estimateBlockHeight(block);
}

export function stackHeight(blocks, heights = {}, gap = BLOCK_GAP_PX) {
  let used = 0;
  let count = 0;
  (blocks || []).forEach((block) => {
    if (!block || block.type === "page-break") return;
    if (count) used += gap;
    used += blockHeight(block, heights);
    count += 1;
  });
  return used;
}

function takePreface(list, index, heights, available, gap) {
  const preface = [];
  let used = 0;
  while (index < list.length) {
    const item = list[index];
    if (!item?.fullWidth || item.type === "page-break") break;
    const height = blockHeight(item, heights);
    const lead = preface.length ? gap : 0;
    if (preface.length && used + lead + height > available) break;
    preface.push(item);
    used += lead + height;
    index += 1;
  }
  return { preface, used, index };
}

/**
 * Flow blocks into pages. Explicit page-break blocks force a new page.
 * A heading stays with the following block when the pair still fits.
 * A block taller than the page is placed alone and may extend that page.
 */
export function paginateBlocks(blocks, heights = {}, options = {}) {
  const contentHeight = options.contentHeight || 900;
  const gap = options.gap ?? BLOCK_GAP_PX;
  const pages = [[]];
  let used = options.firstUsed || 0;

  const startPage = () => {
    pages.push([]);
    used = 0;
  };

  (blocks || []).forEach((block, index) => {
    if (!block || block.type === "page-break") {
      startPage();
      return;
    }
    const h = blockHeight(block, heights);
    const next = blocks.slice(index + 1).find((item) => item && item.type !== "page-break");
    const page = () => pages[pages.length - 1];
    const occupied = () => page().length > 0 || used > 0;

    if ((block.type === "heading" || block.keepTogether) && next) {
      const pair = (occupied() ? gap : 0) + h + gap + blockHeight(next, heights);
      if (occupied() && pair > contentHeight - used) startPage();
    }

    const lead = page().length ? gap : 0;
    if (occupied() && lead + h > contentHeight - used) startPage();

    if (page().length) used += gap;
    page().push(block);
    used += h;
  });

  return pages;
}

/**
 * Pack blocks into a fixed number of columns, then onto the next page.
 * Reading order is down the left column, then the right.
 * Each page is a flat list in that order.
 */
export function paginateColumns(blocks, heights = {}, options = {}) {
  const contentHeight = options.contentHeight || 900;
  const columns = Math.max(1, options.columns || 1);
  const gap = options.gap ?? BLOCK_GAP_PX;
  const firstUsed = options.firstUsed || 0;
  if (columns === 1) return paginateBlocks(blocks, heights, options);

  const list = blocks || [];
  const pages = [];
  let index = 0;
  let pageIndex = 0;
  while (index < list.length && pageIndex < 24) {
    const block = list[index];
    if (!block || block.type === "page-break") {
      if (pages.length === 0 || pages[pages.length - 1].length) pages.push([]);
      index += 1;
      pageIndex += 1;
      continue;
    }
    const available = Math.max(120, contentHeight - (pages.length === 0 ? firstUsed : 0));
    const preface = takePreface(list, index, heights, available, gap);
    index = preface.index;
    const columnHeight = Math.max(120, available - preface.used - (preface.preface.length ? gap : 0));
    const cols = Array.from({ length: columns }, () => []);
    const used = Array.from({ length: columns }, () => 0);
    let col = 0;
    while (index < list.length && col < columns) {
      const item = list[index];
      if (!item || item.type === "page-break" || item.fullWidth) break;
      const follower = list[index + 1];
      let need = blockHeight(item, heights);
      let take = 1;
      if ((item.type === "heading" || item.keepTogether) && follower && follower.type !== "page-break" && !follower.fullWidth) {
        need += gap + blockHeight(follower, heights);
        take = 2;
      }
      const lead = cols[col].length ? gap : 0;
      if (cols[col].length && lead + need > columnHeight - used[col]) {
        col += 1;
        continue;
      }
      if (cols[col].length) used[col] += gap;
      cols[col].push(item);
      used[col] += blockHeight(item, heights);
      index += 1;
      if (take === 2 && index < list.length && list[index] && list[index].type !== "page-break") {
        used[col] += gap;
        cols[col].push(list[index]);
        used[col] += blockHeight(list[index], heights);
        index += 1;
      }
    }
    pages.push([...preface.preface, ...cols.flat()]);
    pageIndex += 1;
    if (index < list.length && list[index]?.type === "page-break") {
      index += 1;
    }
  }
  return pages.length ? pages : [[]];
}

/** Split one page into columns using the same heights the packer used. */
export function columnSlices(blocks, heights = {}, options = {}) {
  const columns = Math.max(1, options.columns || 1);
  if (columns <= 1) return [blocks || []];
  const packed = paginateColumns(blocks, heights, {
    ...options,
    columns,
    firstUsed: 0,
    contentHeight: options.columnHeight || options.contentHeight || 900,
  });
  const page = packed[0] || [];
  const gap = options.gap ?? BLOCK_GAP_PX;
  const columnHeight = options.columnHeight || options.contentHeight || 900;
  const cols = Array.from({ length: columns }, () => []);
  const used = Array.from({ length: columns }, () => 0);
  let col = 0;
  page.forEach((block) => {
    const h = blockHeight(block, heights);
    const lead = cols[col].length ? gap : 0;
    if (col < columns - 1 && cols[col].length && lead + h > columnHeight - used[col]) col += 1;
    if (cols[col].length) used[col] += gap;
    cols[col].push(block);
    used[col] += h;
  });
  packed.slice(1).forEach((extra) => {
    extra.forEach((block) => cols[columns - 1].push(block));
  });
  return cols;
}

/**
 * Place blocks on a wrapping grid.
 * column 0 stays left, column 1 sits on the right, fullWidth spans the row.
 */
export function placeGrid(blocks, columns = 2) {
  const cols = Math.max(1, columns || 1);
  const cells = [];
  let row = 1;
  let col = 1;
  (blocks || []).forEach((block) => {
    if (!block || block.type === "page-break") return;
    if (cols === 1 || block.fullWidth) {
      if (col !== 1) {
        row += 1;
        col = 1;
      }
      cells.push({ block, row, col: 1, span: cols });
      row += 1;
      col = 1;
      return;
    }
    let target = col;
    if (block.column === 1) target = Math.min(cols, 2);
    else if (block.column === 0) target = 1;
    if (target < col) {
      row += 1;
      col = 1;
      target = block.column === 1 ? Math.min(cols, 2) : 1;
    }
    if (target > col) col = target;
    cells.push({ block, row, col, span: 1 });
    col += 1;
    if (col > cols) {
      row += 1;
      col = 1;
    }
  });
  return cells;
}

function commitGridRow(pages, usedRef, row, heights, contentHeight, gap) {
  if (!row.length) return;
  const height = Math.max(...row.map((block) => blockHeight(block, heights)));
  let page = pages[pages.length - 1];
  const occupied = page.length > 0 || usedRef.used > 0;
  const lead = page.length ? gap : 0;
  if (occupied && page.length && lead + height > contentHeight - usedRef.used) {
    pages.push([]);
    usedRef.used = 0;
    page = pages[pages.length - 1];
  }
  if (page.length) usedRef.used += gap;
  row.forEach((block) => page.push(block));
  usedRef.used += height;
}

/**
 * Flow blocks across columns, one row at a time, then onto the next page.
 * Two blocks in a row share the height of the taller one.
 */
export function paginateGrid(blocks, heights = {}, options = {}) {
  const contentHeight = options.contentHeight || 900;
  const columns = Math.max(1, options.columns || 1);
  const gap = options.gap ?? BLOCK_GAP_PX;
  if (columns === 1) return paginateBlocks(blocks, heights, options);

  const pages = [[]];
  const usedRef = { used: options.firstUsed || 0 };
  let chunk = [];

  const flush = (pageBreak) => {
    const rows = new Map();
    placeGrid(chunk, columns).forEach((cell) => {
      if (!rows.has(cell.row)) rows.set(cell.row, []);
      rows.get(cell.row).push(cell.block);
    });
    [...rows.keys()].sort((a, b) => a - b).forEach((key) => {
      commitGridRow(pages, usedRef, rows.get(key), heights, contentHeight, gap);
    });
    chunk = [];
    if (pageBreak) {
      if (pages[pages.length - 1].length) pages.push([]);
      usedRef.used = 0;
    }
  };

  (blocks || []).forEach((block) => {
    if (!block || block.type === "page-break") {
      flush(true);
      return;
    }
    chunk.push(block);
  });
  flush(false);
  return pages.length ? pages : [[]];
}

/**
 * Keep the sheet on one or two A4 pages. A second column is used
 * when a single column would run past the second page.
 */
export function fitSheet(blocks, heights = {}, options = {}) {
  const single = paginateBlocks(blocks, heights, options);
  const filled = single.filter((page) => page.length);
  if (filled.length <= 2) return { columns: 1, pages: single.length ? single : [[]] };
  const gap = options.gap ?? BLOCK_GAP_PX;
  const pages = paginateGrid(blocks, heights, { ...options, columns: 2, gap });
  return { columns: 2, pages };
}

export function collectContentWarnings(blocks) {
  const warnings = [];
  (blocks || []).forEach((block) => {
    if (!block || block.type === "page-break") return;
    if (block.type === "heading" || block.type === "text" || block.type === "reference" || block.type === "fact") {
      if (!String(block.text || "").trim()) {
        warnings.push({ id: block.id, text: "Пустой текстовый блок." });
      }
      return;
    }
    if (block.type !== "task") return;
    const question = String(block.task?.question || block.task?.q || "").trim();
    if (!question || question === "Новое задание") {
      warnings.push({ id: block.id, text: `Задание ${block.number || ""} без условия.`.trim() });
    }
    const type = block.task?.type;
    if (type === "image_question" && !block.task?.content?.imageUrl) {
      warnings.push({ id: block.id, text: `Задание ${block.number || ""} без изображения.`.trim() });
    }
    if (type === "expression" && !String(block.task?.content?.latex || "").trim()) {
      warnings.push({ id: block.id, text: `Задание ${block.number || ""} без формулы.`.trim() });
    }
    if (type === "function_graph" && !String(block.task?.content?.expression || "").trim()) {
      warnings.push({ id: block.id, text: `Задание ${block.number || ""} без функции.`.trim() });
    }
  });
  return warnings;
}

export function collectMetricWarnings(blocks, heights, contentHeight) {
  const warnings = [];
  (blocks || []).forEach((block) => {
    if (!block || block.type === "page-break") return;
    const measured = Number(heights?.[block.id]);
    if (measured > contentHeight + 1) {
      warnings.push({ id: block.id, text: "Элемент может быть обрезан при печати." });
    }
    const font = Number(heights?.[`${block.id}:font`]);
    if (font > 0 && font < 12) {
      warnings.push({ id: block.id, text: "Текст мельче 9 pt — на печати его будет трудно читать." });
    }
  });
  return warnings;
}
