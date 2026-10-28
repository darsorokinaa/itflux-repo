import { pageAnnotations } from "./notebookModel";

const MARGIN = 36;
const TEXT_SIZE = 22;

export function pageImageSource(page) {
  const source = page?.source_attachment;
  const url = page?.background_url || source?.url || "";
  const mime = String(source?.mime_type || source?.content_type || "").toLowerCase();
  const filename = String(source?.filename || source?.name || "");
  const isPdf = page?.page_type === "pdf_page" || mime === "application/pdf" || /\.pdf($|\?)/i.test(filename);
  const looksImage = mime.startsWith("image/")
    || /\.(jpe?g|png|webp|gif|bmp|heic|heif)($|\?)/i.test(filename || url);
  return {
    url,
    isPdf,
    isImage: Boolean(url) && !isPdf && looksImage,
    sourceId: source?.id || page?.source_attachment_id || page?.id || "",
  };
}

export function plainAnswerText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function wrapPlainText(text, { maxWidth = 900, fontSize = TEXT_SIZE } = {}) {
  const plain = plainAnswerText(text);
  if (!plain) return "";
  const maxChars = Math.max(16, Math.floor(maxWidth / (fontSize * 0.52)));
  const lines = [];
  let line = "";
  plain.split(" ").forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines.join("\n");
}

/** Fit a picture on the page. `top` pins it to the upper edge; `center` matches the old full-page background. */
export function fitImageBox(naturalWidth, naturalHeight, pageWidth, pageHeight, { align = "top", top = MARGIN } = {}) {
  const nw = Math.max(1, Number(naturalWidth) || 1);
  const nh = Math.max(1, Number(naturalHeight) || 1);
  const margin = align === "center" ? 0 : MARGIN;
  const maxW = Math.max(48, pageWidth - margin * 2);
  const maxH = Math.max(48, pageHeight - (align === "center" ? 0 : top) - margin);
  const scale = Math.min(maxW / nw, maxH / nh);
  const w = Math.round(nw * scale);
  const h = Math.round(nh * scale);
  const x = Math.round((pageWidth - w) / 2);
  const y = align === "center" ? Math.round((pageHeight - h) / 2) : Math.round(top);
  return { x, y, w, h };
}

function hasInk(objects) {
  return (objects || []).some((obj) => (
    obj
    && obj.sourceKey !== "answer-text"
    && obj.type !== "image"
    && obj.type !== "comment"
    && obj.type !== "page_feedback"
  ));
}

function textBlock(page, text, y) {
  const width = page?.width || 1000;
  const maxWidth = width - MARGIN * 2;
  const wrapped = wrapPlainText(text, { maxWidth, fontSize: TEXT_SIZE });
  if (!wrapped) return null;
  const lines = wrapped.split("\n").length;
  return {
    object: {
      id: `src-text-${page.id}`,
      type: "text",
      sourceKey: "answer-text",
      pageId: page.id,
      x: MARGIN,
      y: y + TEXT_SIZE,
      w: maxWidth,
      text: wrapped,
      fontSize: TEXT_SIZE,
      stroke: "#111827",
      color: "#111827",
    },
    nextTop: y + lines * TEXT_SIZE * 1.25 + 18,
  };
}

function loadImageSize(url) {
  return new Promise((resolve) => {
    if (!url || typeof Image === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve({
      w: img.naturalWidth || img.width,
      h: img.naturalHeight || img.height,
    });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Turn the student's image or text into objects pinned to the top of the page.
 * Pages that already have ink keep the photo where the old background sat, so marks stay aligned.
 * Returns null when nothing new should be written.
 */
export async function placeReviewContent(doc, { loadSize = loadImageSize, headerTop = 0 } = {}) {
  if (!doc || doc.readonly || doc.owner_role === "student") return null;
  const answer = plainAnswerText(doc.answer_text);
  let textUsed = (doc.pages || []).some((page) => (
    pageAnnotations(page).some((obj) => obj?.sourceKey === "answer-text")
  ));
  let changed = false;
  let selectId = "";
  const pages = [];
  for (const page of doc.pages || []) {
    if (page?.state?.contentPlaced) {
      pages.push(page);
      continue;
    }
    const objects = pageAnnotations(page).map((obj) => ({ ...obj }));
    const source = pageImageSource(page);
    const marked = hasInk(objects);
    const additions = [];
    let imageOk = !source.isImage;
    let top = MARGIN;
    const existingText = objects.find((obj) => obj.sourceKey === "answer-text");
    if (existingText) {
      const lines = String(existingText.text || "").split("\n").length || 1;
      const fontSize = existingText.fontSize || TEXT_SIZE;
      top = (existingText.y || fontSize) - fontSize + lines * fontSize * 1.25 + 18;
      textUsed = true;
    }
    // r117: шапка листа сама показывает условие и ответ — текстовый объект не создаём, фото кладём ниже шапки.
    if (headerTop > 0) top = Math.max(top, headerTop);
    if (answer && !textUsed && !marked && !(headerTop > 0)) {
      const block = textBlock(page, answer, top);
      if (block && !objects.some((obj) => obj.sourceKey === "answer-text" || obj.id === block.object.id)) {
        additions.push(block.object);
        top = block.nextTop;
        textUsed = true;
        if (!selectId) selectId = block.object.id;
      }
    }
    if (source.isImage && !objects.some((obj) => obj.type === "image" && (obj.src === source.url || obj.sourceKey?.startsWith("student-image:")))) {
      const size = await loadSize(source.url);
      if (size?.w && size?.h) {
        const box = fitImageBox(size.w, size.h, page.width || 1000, page.height || 1414, {
          align: marked ? "center" : "top",
          top,
        });
        const image = {
          id: `src-image-${source.sourceId}`,
          type: "image",
          sourceKey: `student-image:${source.sourceId}`,
          src: source.url,
          pageId: page.id,
          ...box,
        };
        additions.push(image);
        imageOk = true;
        selectId = image.id;
      }
    }
    if (!additions.length) {
      pages.push(page);
      continue;
    }
    changed = true;
    pages.push({
      ...page,
      state: {
        ...(page.state || {}),
        version: 1,
        contentPlaced: imageOk,
        objects: [...objects, ...additions],
      },
    });
  }
  if (!changed) return null;
  return { doc: { ...doc, pages }, selectId };
}
