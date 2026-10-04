import { DEFAULT_THEME } from "@tldraw/editor";
import { getIndices } from "@tldraw/utils";
import {
  ArrowShapeArrowheadEndStyle,
  ArrowShapeArrowheadStartStyle,
  AssetRecordType,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultSizeStyle,
  DefaultTextAlignStyle,
  GeoShapeGeoStyle,
  createShapeId,
  toRichText,
} from "@tldraw/tlschema";

import { loadMathJax } from "../../utils/loadMathJax";
import { isLessonLinkUrl } from "./lessonGeoUrl";
import { lessonBoardAssetCanUpload } from "./lessonBoardAssetStore";
import {
  getLessonThickness,
  lessonCellValue,
  LESSON_MARKER_OPACITY,
  lessonGraphPoints,
  scaledLessonThickness,
  setLessonThickness,
} from "./lessonShell";

function centerOf(editor) {
  const bounds = editor.getViewportPageBounds();
  return { x: bounds.midX ?? bounds.x + bounds.width / 2, y: bounds.midY ?? bounds.y + bounds.height / 2 };
}

function rich(text) {
  return toRichText(String(text ?? ""));
}

export function applyStyle(editor, style, value) {
  editor.run(() => {
    editor.setStyleForNextShapes(style, value);
    if (editor.getSelectedShapes().length) editor.setStyleForSelectedShapes(style, value);
  });
}

export function applyThickness(editor, next) {
  const previous = getLessonThickness();
  const value = setLessonThickness(next);
  if (value === previous) return;
  const shapes = editor.getSelectedShapes().filter((shape) => typeof shape.props?.scale === "number");
  if (!shapes.length) return;
  editor.updateShapes(
    shapes.map((shape) => ({
      id: shape.id,
      type: shape.type,
      props: { scale: scaledLessonThickness(shape.props.scale, previous, value) },
    })),
  );
}

export function applyOpacity(editor, next) {
  editor.run(() => {
    editor.setOpacityForNextShapes(next);
    if (editor.getSelectedShapes().length) editor.setOpacityForSelectedShapes(next);
  });
}

const CUSTOM_COLOR_KEY = "lesson-board-custom-colors";

export function customColorId(hex) {
  const match = String(hex || "").trim().toLowerCase().match(/^#?([0-9a-f]{6})$/);
  return match ? `c${match[1]}` : null;
}

function mixWithWhite(hex, amount) {
  const value = Number.parseInt(hex, 16);
  const mix = (channel) => Math.round(channel + (255 - channel) * amount);
  const red = mix((value >> 16) & 255);
  const green = mix((value >> 8) & 255);
  const blue = mix(value & 255);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function customSwatch(hex) {
  const solid = `#${hex}`;
  return {
    solid,
    fill: solid,
    linedFill: mixWithWhite(hex, 0.28),
    frameHeadingStroke: solid,
    frameHeadingFill: "#ffffff",
    frameStroke: solid,
    frameFill: "#ffffff",
    frameText: "#1a1d23",
    noteFill: mixWithWhite(hex, 0.45),
    noteText: "#1a1d23",
    semi: mixWithWhite(hex, 0.82),
    pattern: solid,
    highlightSrgb: solid,
    highlightP3: solid,
  };
}

function readCustomHexes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_COLOR_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const id = customColorId(item);
      return id ? `#${id.slice(1)}` : null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export function savedCustomColors() {
  return readCustomHexes().map((hex) => ({ id: customColorId(hex), hex, label: hex }));
}

/** Основные цвета и один кружок нового цвета, если выбран именно он. */
export function lessonInkChoices(presets, selectedId) {
  const current = savedCustomColors().find((item) => item.id === selectedId);
  if (!current || presets.some((preset) => preset.id === current.id)) return presets;
  return [...presets, current];
}

function publishCustomColors(entries) {
  if (!entries.length || !DEFAULT_THEME?.colors?.light || !DEFAULT_THEME?.colors?.dark) return;
  entries.forEach(([id, hex]) => {
    if (!id) return;
    const ink = customSwatch(hex);
    DEFAULT_THEME.colors.light[id] = ink;
    DEFAULT_THEME.colors.dark[id] = ink;
    DefaultColorStyle.addValues(id);
  });
}

function customColorEntries() {
  return readCustomHexes().map((hex) => [customColorId(hex), hex.slice(1)]);
}

publishCustomColors(customColorEntries());

function paintCustomColors(editor, entries) {
  publishCustomColors(entries);
  if (!entries.length) return;
  const theme = editor.getCurrentTheme();
  if (!theme?.colors?.light || !theme?.colors?.dark) return;
  const light = { ...theme.colors.light };
  const dark = { ...theme.colors.dark };
  entries.forEach(([id, hex]) => {
    const ink = customSwatch(hex);
    light[id] = ink;
    dark[id] = ink;
  });
  editor.updateTheme({
    ...theme,
    colors: { ...theme.colors, light, dark },
  });
}

export function installSavedCustomColors(editor) {
  paintCustomColors(editor, customColorEntries());
}

export function applyCustomColor(editor, hex) {
  const id = customColorId(hex);
  if (!id) return;
  const normalized = `#${id.slice(1)}`;
  DefaultColorStyle.addValues(id);
  const next = [normalized, ...readCustomHexes().filter((item) => item !== normalized)].slice(0, 16);
  try {
    localStorage.setItem(CUSTOM_COLOR_KEY, JSON.stringify(next));
  } catch {
    /* The color still applies in this session when storage is unavailable. */
  }
  paintCustomColors(editor, [[id, id.slice(1)]]);
  applyStyle(editor, DefaultColorStyle, id);
}

const inkMemory = {
  draw: null,
  highlight: { color: "yellow", opacity: LESSON_MARKER_OPACITY },
};

function rememberInk(editor, toolId) {
  if (toolId !== "draw" && toolId !== "highlight") return;
  inkMemory[toolId] = {
    color: editor.getStyleForNextShape(DefaultColorStyle),
    opacity: editor.getInstanceState().opacityForNextShape,
  };
}

function restoreInk(editor, toolId) {
  const memory = inkMemory[toolId];
  if (!memory) return;
  editor.setStyleForNextShapes(DefaultColorStyle, memory.color);
  editor.setOpacityForNextShapes(memory.opacity);
}

export function chooseTool(editor, toolId) {
  const current = editor.getCurrentToolId();
  if (current !== toolId) rememberInk(editor, current);
  editor.run(() => {
    if (toolId === "draw" || toolId === "highlight") restoreInk(editor, toolId);
    editor.setCurrentTool(toolId);
  });
}

export function chooseTextKind(editor, size) {
  editor.run(() => {
    editor.setStyleForNextShapes(DefaultSizeStyle, size);
    editor.setCurrentTool("text");
  });
}

export function chooseGeo(editor, geo) {
  editor.run(() => {
    editor.setStyleForNextShapes(GeoShapeGeoStyle, geo);
    editor.setCurrentTool("geo");
  });
}

export function chooseSticker(editor, color) {
  editor.run(() => {
    editor.setStyleForNextShapes(DefaultColorStyle, color);
    editor.setCurrentTool("note");
  });
}

export function chooseLink(editor, kind) {
  const start = kind === "both" ? "arrow" : "none";
  const end = kind === "plain" ? "none" : "arrow";
  const dash = kind === "dashed" ? "dashed" : "solid";
  const tool = kind === "plain" ? "line" : "arrow";
  editor.run(() => {
    editor.setStyleForNextShapes(ArrowShapeArrowheadStartStyle, start);
    editor.setStyleForNextShapes(ArrowShapeArrowheadEndStyle, end);
    editor.setStyleForNextShapes(DefaultDashStyle, dash);
    editor.setCurrentTool(tool);
  });
}

export function setPenMode(editor, stylusOnly) {
  editor.updateInstanceState({ isPenMode: Boolean(stylusOnly) });
}

export function placeBracket(editor) {
  const origin = centerOf(editor);
  const keys = getIndices(4);
  const coords = [
    [28, 0],
    [0, 0],
    [0, 120],
    [28, 120],
  ];
  const points = {};
  keys.forEach((key, index) => {
    points[key] = { id: key, index: key, x: coords[index][0], y: coords[index][1] };
  });
  const id = createShapeId();
  editor.createShape({
    id,
    type: "line",
    x: origin.x - 14,
    y: origin.y - 60,
    props: { points, spline: "line", dash: "solid" },
  });
  editor.select(id);
}

function placeText(editor, text, props, offset = { x: 0, y: 0 }) {
  const origin = centerOf(editor);
  const id = createShapeId();
  editor.createShape({
    id,
    type: "text",
    x: origin.x - 80 + offset.x,
    y: origin.y - 16 + offset.y,
    props: { richText: rich(text), font: "sans", size: "m", ...props },
  });
  editor.select(id);
  return id;
}

function placeGeo(editor, { x, y, w, h, text, geo = "rectangle", fill = "solid", color = "blue", dash = "solid" }) {
  const id = createShapeId();
  editor.createShape({
    id,
    type: "geo",
    x,
    y,
    props: {
      geo,
      w,
      h,
      fill,
      color,
      dash,
      richText: rich(text),
      align: "middle",
      verticalAlign: "middle",
    },
  });
  return id;
}

export async function insertFormula(editor, tex) {
  const source = String(tex || "").trim();
  if (!source) return;
  try {
    const svg = await formulaSvg(source);
    if (svg) {
      await placeImage(editor, svg.blob, svg.width, svg.height, "formula.svg");
      return;
    }
  } catch {
    /* формула остаётся текстом, если MathJax не собрал картинку */
  }
  placeText(editor, source, { font: "serif" });
}

async function formulaSvg(tex) {
  const mathjax = await loadMathJax();
  if (!mathjax?.tex2svg) return null;
  await mathjax.startup?.promise;
  const wrapped = mathjax.tex2svg(tex, { display: true });
  const svg = wrapped.querySelector("svg");
  if (!svg) return null;
  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const width = Math.max(48, Math.ceil(svg.viewBox?.baseVal?.width || svg.width?.baseVal?.value || 120));
  const height = Math.max(32, Math.ceil(svg.viewBox?.baseVal?.height || svg.height?.baseVal?.value || 48));
  const xml = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([xml], { type: "image/svg+xml" });
  return { blob, width: width * 2, height: height * 2 };
}

export function insertGraph(editor, options) {
  const min = Number(options.min);
  const max = Number(options.max);
  const points = lessonGraphPoints(options.expression, min, max);
  if (!points) return false;
  const origin = centerOf(editor);
  const scale = 28;
  const ids = [];
  const xOf = (x) => origin.x + (x - min) * scale;
  const yOf = (y) => origin.y + y * scale;
  if (options.grid) {
    for (let step = Math.ceil(min); step <= Math.floor(max); step += 1) {
      ids.push(placeGeo(editor, {
        x: xOf(step),
        y: yOf(2),
        w: 1,
        h: 4 * scale,
        text: "",
        fill: "none",
        color: "grey",
        dash: "dotted",
      }));
    }
  }
  if (options.axes) {
    ids.push(placeGeo(editor, {
      x: xOf(min),
      y: origin.y,
      w: (max - min) * scale,
      h: 1,
      text: "",
      fill: "none",
      color: "black",
    }));
    ids.push(placeGeo(editor, {
      x: origin.x,
      y: yOf(2),
      w: 1,
      h: 4 * scale,
      text: "",
      fill: "none",
      color: "black",
    }));
  }
  const keys = getIndices(points.length);
  const mapped = {};
  points.forEach((point, index) => {
    const key = keys[index];
    mapped[key] = { id: key, index: key, x: (point.x - min) * scale, y: point.y * scale };
  });
  const curveId = createShapeId();
  editor.createShape({
    id: curveId,
    type: "line",
    x: xOf(min),
    y: origin.y,
    props: { points: mapped, spline: "cubic", dash: "solid", color: "blue" },
  });
  ids.push(curveId);
  if (options.points) {
    points.filter((_, index) => index % 8 === 0).forEach((point) => {
      ids.push(placeGeo(editor, {
        x: xOf(point.x) - 4,
        y: yOf(point.y) - 4,
        w: 8,
        h: 8,
        geo: "ellipse",
        text: "",
        fill: "solid",
        color: "blue",
      }));
    });
  }
  if (options.labels) {
    ids.push(placeText(editor, options.expression, { font: "serif", size: "s" }, { x: 0, y: -160 }));
  }
  if (options.tangent) {
    const at = Number(options.tangentAt);
    const sample = lessonGraphPoints(options.expression, at - 0.05, at + 0.05, 2);
    if (sample && sample.length >= 2) {
      const slope = (sample[sample.length - 1].y - sample[0].y) / (sample[sample.length - 1].x - sample[0].x);
      const yAt = sample[1]?.y ?? sample[0].y;
      ids.push(placeGeo(editor, {
        x: xOf(at) - 40,
        y: yOf(yAt) - slope * 20,
        w: 80,
        h: 2,
        text: "",
        fill: "none",
        color: "red",
      }));
    }
  }
  if (options.area) {
    ids.push(placeGeo(editor, {
      x: xOf(min),
      y: origin.y,
      w: (max - min) * scale,
      h: 80,
      text: "",
      fill: "semi",
      color: "blue",
      dash: "solid",
    }));
  }
  editor.select(...ids);
  return true;
}

export function insertTable(editor, rows, cols) {
  const origin = centerOf(editor);
  const cellW = 96;
  const cellH = 40;
  const ids = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      ids.push(placeGeo(editor, {
        x: origin.x + col * cellW,
        y: origin.y + row * cellH,
        w: cellW,
        h: cellH,
        text: "",
        fill: "none",
        color: "black",
      }));
    }
  }
  editor.groupShapes(ids, { select: true });
  const group = editor.getOnlySelectedShape();
  if (group?.type === "group") {
    editor.updateShape({
      id: group.id,
      type: "group",
      meta: { ...group.meta, lessonTable: { rows, cols } },
    });
  }
}

function selectedTable(editor) {
  const selected = editor.getSelectedShapes();
  const direct = selected.find((shape) => shape.type === "group" && shape.meta?.lessonTable);
  if (direct) return direct;
  for (const shape of selected) {
    const parent = editor.getShape(shape.parentId);
    if (parent?.meta?.lessonTable) return parent;
  }
  return null;
}

export function addTableRow(editor) {
  const group = selectedTable(editor);
  if (!group) return false;
  const cells = editor.getSortedChildIdsForParent(group.id).map((id) => editor.getShape(id)).filter((shape) => shape?.type === "geo");
  if (!cells.length) return false;
  const { rows, cols } = group.meta.lessonTable;
  const sample = cells[0];
  const minX = Math.min(...cells.map((shape) => shape.x));
  const maxY = Math.max(...cells.map((shape) => shape.y));
  for (let col = 0; col < cols; col += 1) {
    editor.createShape({
      id: createShapeId(),
      type: "geo",
      parentId: group.id,
      x: minX + col * sample.props.w,
      y: maxY + sample.props.h,
      props: {
        geo: "rectangle",
        w: sample.props.w,
        h: sample.props.h,
        fill: "none",
        dash: "solid",
        color: "black",
        richText: rich(""),
      },
    });
  }
  editor.updateShape({
    id: group.id,
    type: "group",
    meta: { ...group.meta, lessonTable: { rows: rows + 1, cols } },
  });
  return true;
}

export function addTableColumn(editor) {
  const group = selectedTable(editor);
  if (!group) return false;
  const cells = editor.getSortedChildIdsForParent(group.id).map((id) => editor.getShape(id)).filter((shape) => shape?.type === "geo");
  if (!cells.length) return false;
  const { rows, cols } = group.meta.lessonTable;
  const sample = cells[0];
  const minY = Math.min(...cells.map((shape) => shape.y));
  const maxX = Math.max(...cells.map((shape) => shape.x));
  for (let row = 0; row < rows; row += 1) {
    editor.createShape({
      id: createShapeId(),
      type: "geo",
      parentId: group.id,
      x: maxX + sample.props.w,
      y: minY + row * sample.props.h,
      props: {
        geo: "rectangle",
        w: sample.props.w,
        h: sample.props.h,
        fill: "none",
        dash: "solid",
        color: "black",
        richText: rich(""),
      },
    });
  }
  editor.updateShape({
    id: group.id,
    type: "group",
    meta: { ...group.meta, lessonTable: { rows, cols: cols + 1 } },
  });
  return true;
}

export function mergeTableCells(editor) {
  const cells = editor.getSelectedShapes().filter((shape) => shape.type === "geo");
  if (cells.length < 2) return false;
  const [first, ...rest] = cells.slice().sort((a, b) => a.x - b.x);
  const width = rest.reduce((sum, shape) => sum + shape.props.w, first.props.w);
  editor.updateShape({ id: first.id, type: "geo", props: { w: width } });
  editor.deleteShapes(rest.map((shape) => shape.id));
  return true;
}

export function writeCellFormula(editor, source) {
  const value = lessonCellValue(source);
  const cell = editor.getSelectedShapes().find((shape) => shape.type === "geo");
  if (!cell || value == null) return false;
  editor.updateShape({ id: cell.id, type: "geo", props: { richText: rich(String(value)) } });
  return true;
}

export function insertTemplate(editor, template) {
  const origin = centerOf(editor);
  const ids = template.cards.map((label, index) => placeGeo(editor, {
    x: origin.x + (index % 2) * 220 - 180,
    y: origin.y + Math.floor(index / 2) * 140 - 40,
    w: 200,
    h: 120,
    text: label,
    fill: index === 0 ? "semi" : "none",
    color: "blue",
  }));
  const title = placeText(editor, template.label, { size: "l" }, { x: -40, y: -120 });
  editor.select(title, ...ids);
}

export function insertTaskCard(editor, title, body) {
  const origin = centerOf(editor);
  const id = placeGeo(editor, {
    x: origin.x - 150,
    y: origin.y - 80,
    w: 300,
    h: 170,
    text: body ? `${title}\n${body}` : title,
    fill: "semi",
    color: "yellow",
  });
  editor.updateShape({ id, type: "geo", meta: { lessonKind: "task" } });
  editor.select(id);
  editor.setEditingShape(id);
}

export async function insertBoardFile(editor, file) {
  const upload = editor.store?.props?.assets?.upload;
  if (typeof upload !== "function" || !file) return "Не удалось сохранить файл";
  let stored;
  try {
    stored = await upload({ props: { name: file.name, mimeType: file.type || "" } }, file);
  } catch (error) {
    return error?.message || "Файл не удалось загрузить";
  }
  if (!stored?.src) return "Файл не удалось загрузить";
  const name = file.name || "Файл";
  const origin = centerOf(editor);
  const id = placeGeo(editor, {
    x: origin.x - 140,
    y: origin.y - 36,
    w: 280,
    h: 72,
    text: name,
    fill: "semi",
    color: "light-blue",
  });
  editor.updateShape({
    id,
    type: "geo",
    meta: {
      lessonKind: "file",
      fileName: name,
      fileUrl: stored.src,
      fileMime: file.type || "",
    },
  });
  editor.select(id);
  return "";
}

export async function downloadLessonFile(url, name) {
  const href = String(url || "");
  if (!href) return false;
  const response = await fetch(href, { credentials: "same-origin" });
  if (!response.ok) return false;
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name || "file";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
  return true;
}

export function insertLinkCard(editor, url, title) {
  const origin = centerOf(editor);
  const id = placeGeo(editor, {
    x: origin.x - 140,
    y: origin.y - 40,
    w: 280,
    h: 88,
    text: title || url,
    fill: "semi",
    color: "light-blue",
  });
  if (isLessonLinkUrl(url)) editor.updateShape({ id, type: "geo", props: { url } });
  editor.select(id);
}

export function insertDiagram(editor) {
  const origin = centerOf(editor);
  const boxes = ["Шаг 1", "Шаг 2", "Шаг 3"].map((label, index) => placeGeo(editor, {
    x: origin.x - 280 + index * 200,
    y: origin.y - 40,
    w: 150,
    h: 80,
    text: label,
    fill: "semi",
    color: "blue",
  }));
  editor.select(...boxes);
}

export function insertMindMap(editor) {
  const origin = centerOf(editor);
  const center = placeGeo(editor, {
    x: origin.x - 70,
    y: origin.y - 36,
    w: 140,
    h: 72,
    text: "Тема",
    fill: "solid",
    color: "yellow",
    geo: "ellipse",
  });
  const branches = ["Ветка 1", "Ветка 2", "Ветка 3"].map((label, index) => placeGeo(editor, {
    x: origin.x + (index - 1) * 180 - 60,
    y: origin.y + 120,
    w: 130,
    h: 64,
    text: label,
    fill: "semi",
    color: "light-blue",
  }));
  editor.select(center, ...branches);
}

export function insertVote(editor) {
  insertTaskCard(editor, "Голосование", "За\nПротив\nВопрос");
}

export function insertCode(editor) {
  placeText(editor, "код", { font: "mono" });
}

export function insertEmoji(editor, emoji) {
  placeText(editor, emoji, { size: "xl" });
}

async function persistedImageSrc(editor, asset, file) {
  const upload = editor.store?.props?.assets?.upload;
  if (typeof upload === "function" && lessonBoardAssetCanUpload(file.type)) {
    try {
      const uploaded = await upload(asset, file);
      if (uploaded?.src) return uploaded.src;
    } catch {
      // Хранилище может отказать. Картинка и страницы PDF всё равно остаются на доске.
    }
  }
  return blobToDataUrl(file);
}

function imageFile(blob, name) {
  if (blob instanceof File) return blob;
  const mime = blob.type || "image/png";
  return new File([blob], name || "image.png", { type: mime });
}

async function storeImageAsset(editor, blob, width, height, name) {
  const file = imageFile(blob, name);
  const assetId = AssetRecordType.createId();
  const draft = {
    id: assetId,
    type: "image",
    typeName: "asset",
    props: {
      name: name || file.name || "image",
      src: "",
      w: width,
      h: height,
      mimeType: file.type || "image/png",
      isAnimated: false,
    },
    meta: {},
  };
  const src = await persistedImageSrc(editor, draft, file);
  editor.createAssets([{ ...draft, props: { ...draft.props, src } }]);
  return assetId;
}

export async function placeImage(editor, blob, width, height, name) {
  const assetId = await storeImageAsset(editor, blob, width, height, name);
  const origin = centerOf(editor);
  const fitted = fitSize(width, height, 520);
  const id = createShapeId();
  editor.createShape({
    id,
    type: "image",
    x: origin.x - fitted.w / 2,
    y: origin.y - fitted.h / 2,
    props: { assetId, w: fitted.w, h: fitted.h },
  });
  editor.select(id);
  return id;
}

function fitSize(width, height, maxEdge) {
  const edge = Math.max(width, height, 1);
  const scale = edge > maxEdge ? maxEdge / edge : 1;
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function insertPdfFile(editor, file) {
  const { openBoardPdf, renderBoardPdfPage } = await import("./boardPdfRender");
  const opened = await openBoardPdf(file);
  if (!opened.ok) return opened.message;
  const origin = centerOf(editor);
  let y = origin.y;
  for (let page = 1; page <= opened.opened.pageCount; page += 1) {
    const rendered = await renderBoardPdfPage(opened.opened.doc, page);
    const fitted = fitSize(rendered.width, rendered.height, 640);
    const assetId = await storeImageAsset(
      editor,
      rendered.blob,
      rendered.width,
      rendered.height,
      `${file.name || "pdf"}-${page}.jpg`,
    );
    editor.createShape({
      id: createShapeId(),
      type: "image",
      x: origin.x - fitted.w / 2,
      y,
      props: { assetId, w: fitted.w, h: fitted.h },
    });
    y += fitted.h + 24;
  }
  return opened.opened.truncated ? "Показаны первые страницы PDF" : "";
}

export async function replaceSelectedImage(editor, file) {
  const shape = editor.getOnlySelectedShape();
  if (!shape || shape.type !== "image") return false;
  const url = URL.createObjectURL(file);
  try {
    const size = await imageSize(url);
    const assetId = await storeImageAsset(editor, file, size.w, size.h, file.name || "image");
    editor.updateShape({ id: shape.id, type: "image", props: { assetId } });
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function imageSize(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ w: image.naturalWidth || 320, h: image.naturalHeight || 240 });
    image.onerror = () => reject(new Error("image"));
    image.src = url;
  });
}

export async function readClipboardImage(editor) {
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((entry) => entry.startsWith("image/"));
    if (!type) continue;
    const blob = await item.getType(type);
    const url = URL.createObjectURL(blob);
    try {
      const size = await imageSize(url);
      await placeImage(editor, blob, size.w, size.h, "clipboard");
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const text = await navigator.clipboard.readText().catch(() => "");
  if (text) {
    placeText(editor, text, {});
    return true;
  }
  return false;
}

export function fileToImage(editor, file) {
  const url = URL.createObjectURL(file);
  return imageSize(url)
    .then((size) => placeImage(editor, file, size.w, size.h, file.name))
    .finally(() => URL.revokeObjectURL(url));
}

export function setImageMat(editor, color) {
  const shape = editor.getOnlySelectedShape();
  if (!shape || shape.type !== "image") return;
  const matId = shape.meta?.lessonMatId;
  const existing = matId ? editor.getShape(matId) : null;
  if (existing) {
    editor.updateShape({ id: existing.id, type: "geo", props: { color, fill: "solid" } });
    return;
  }
  const id = createShapeId();
  editor.createShape({
    id,
    type: "geo",
    x: shape.x - 12,
    y: shape.y - 12,
    props: {
      geo: "rectangle",
      w: shape.props.w + 24,
      h: shape.props.h + 24,
      color,
      fill: "solid",
      richText: rich(""),
    },
  });
  editor.updateShape({ id: shape.id, type: "image", meta: { ...shape.meta, lessonMatId: id } });
  editor.sendToBack([id]);
}

export function toggleMark(editor, operation) {
  const current = editor.getRichTextEditor();
  if (current?.chain) {
    current.chain().focus()[operation]().run();
    return;
  }
  const shape = editor.getOnlySelectedShape();
  if (!shape) return;
  editor.setEditingShape(shape.id);
  window.setTimeout(() => {
    const next = editor.getRichTextEditor();
    if (next?.chain) next.chain().focus()[operation]().run();
  }, 40);
}

export function lockSelection(editor) {
  const ids = [...editor.getSelectedShapeIds()];
  if (!ids.length) return;
  const locked = ids.every((id) => editor.getShape(id)?.isLocked);
  editor.toggleLock(ids);
  if (!locked) editor.select(...ids);
}

export function duplicateSelection(editor) {
  const ids = editor.getSelectedShapeIds();
  if (ids.length) editor.duplicateShapes(ids);
}

export function deleteSelection(editor) {
  const ids = editor.getSelectedShapeIds();
  if (ids.length) editor.deleteShapes(ids);
}

export function alignSelection(editor, operation) {
  const ids = editor.getSelectedShapeIds();
  if (ids.length > 1) editor.alignShapes(ids, operation);
}

export function distributeSelection(editor, operation) {
  const ids = editor.getSelectedShapeIds();
  if (ids.length > 2) editor.distributeShapes(ids, operation);
}

export function groupSelection(editor) {
  const ids = editor.getSelectedShapeIds();
  if (ids.length > 1) editor.groupShapes(ids, { select: true });
}

export function editSelection(editor) {
  const shape = editor.getOnlySelectedShape();
  if (shape) editor.setEditingShape(shape.id);
}

export function cropSelection(editor) {
  if (editor.getOnlySelectedShape()?.type === "image") editor.setCurrentTool("select.crop.idle");
}

export function followStudent(editor) {
  const peer = editor.getCollaborators().find((person) => person.userId);
  if (!peer) return false;
  editor.startFollowingUser(peer.userId);
  return true;
}

export function stopFollowing(editor) {
  editor.stopFollowingUser();
}

export {
  ArrowShapeArrowheadEndStyle,
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultSizeStyle,
  DefaultTextAlignStyle,
};
