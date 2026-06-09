/**
 * ЕГЭ информатика: задания с прилагаемыми файлами (ФИПИ).
 * Убирает декоративные иконки, JS-ссылки «Открыть файл» и дубли картинок —
 * файл показывается через TaskFileAttachment.
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

export function mightHaveFipiAttachedFiles(html) {
  if (!html || typeof html !== "string") return false;
  if (/\bege-inf-file-task\b/i.test(html)) return false;
  const s = html.toLowerCase();
  return (
    /прилагаем/.test(s) &&
    (/javascript:\s*var\s+wnd\s*=\s*window\.open/i.test(html) ||
      /_simg1_/i.test(html) ||
      /xs3qstsrc/i.test(html))
  );
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

function styleFileNoticeBlocks(root) {
  root.querySelectorAll(".task-html-block").forEach((block) => {
    const text = normalizeCellText(block);
    if (!/прилагаем/i.test(text) || !/файл/i.test(text)) return;
    block.querySelectorAll("img").forEach((img) => {
      if (isDecorativeFipiImage(img)) img.remove();
    });
    block.classList.add("ege-inf-file-notice");
  });
}

function blockIsFipiFileLink(el) {
  const html = el?.innerHTML || "";
  return /javascript:\s*var\s+wnd\s*=\s*window\.open/i.test(html);
}

function removeFipiFileLinkBlocks(root) {
  root.querySelectorAll(".task-html-block, p, div, a").forEach((el) => {
    if (!blockIsFipiFileLink(el)) return;
    if (el.matches("a[href^='javascript']")) {
      el.remove();
      return;
    }
    const text = normalizeCellText(el);
    const onlyLink =
      !text ||
      /^открыть\s+файл/i.test(text) ||
      el.querySelector("a[href^='javascript']") === el.firstElementChild;
    if (onlyLink || blockIsFipiFileLink(el)) el.remove();
  });
}

function removeTrailingImageParagraphs(root) {
  [...root.querySelectorAll(":scope > p, :scope > div.task-html-block")].forEach(
    (node) => {
      const imgs = [...node.querySelectorAll(":scope img, img")];
      if (!imgs.length) return;
      const text = normalizeCellText(node);
      const imgText = imgs.map((img) => normalizeCellText(img)).join("");
      const decorativeOnly =
        imgs.every(isDecorativeFipiImage) &&
        (!text || text === imgText || /^открыть\s+файл/i.test(text));
      if (decorativeOnly) node.remove();
    }
  );
}

function removeOrphanDecorativeImages(root) {
  root.querySelectorAll("img").forEach((img) => {
    if (!isDecorativeFipiImage(img)) return;
    const inNotice = img.closest(".ege-inf-file-notice");
    if (inNotice) return;
    img.remove();
  });
}

/**
 * @param {string} html
 * @returns {string}
 */
export function stripFipiAttachedFileMarkup(html) {
  if (html == null || typeof html !== "string") return html;
  const trimmed = html.trim();
  if (!trimmed || !mightHaveFipiAttachedFiles(trimmed)) return html;

  const root = parseHtmlFragment(trimmed);
  if (!root) return html;

  styleFileNoticeBlocks(root);
  removeFipiFileLinkBlocks(root);
  removeTrailingImageParagraphs(root);
  removeOrphanDecorativeImages(root);

  const wrap = root.ownerDocument.createElement("div");
  wrap.className = "ege-inf-file-task";
  wrap.innerHTML = root.innerHTML;
  return wrap.outerHTML;
}
