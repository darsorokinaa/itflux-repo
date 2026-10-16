// <define:import.meta.env>
var define_import_meta_env_default = {};

// src/cabinet/boards/excalidrawToTldraw.ts
import { DIM_2D, DIM_3D, b64Vecs, toRichText } from "@tldraw/tlschema";
import { getIndicesBetween, getIndicesBelow } from "@tldraw/utils";

// src/cabinet/boards/boardFiles.ts
var STABLE_URL_KEY = "itfluxStableURL";
function isTransientFileUrl(url) {
  return url.startsWith("data:") || url.startsWith("blob:");
}
function isStableFileUrl(url) {
  return Boolean(url) && !isTransientFileUrl(url);
}
function stableUrlOf(meta) {
  const tagged = String(meta[STABLE_URL_KEY] || "");
  if (isStableFileUrl(tagged)) return tagged;
  const url = String(meta.dataURL || meta.url || "");
  return isStableFileUrl(url) ? url : "";
}

// src/cabinet/boards/boardOpenFrame.ts
function cameraFromExcalidrawScroll(scrollX, scrollY, zoom) {
  const z = Number(zoom);
  return {
    x: scrollX,
    y: scrollY,
    z: Number.isFinite(z) && z > 0 ? z : 1
  };
}

// src/cabinet/boards/excalidrawToTldraw.ts
var PAGE_ID = "page:page";
var EXCALIDRAW_TYPES = /* @__PURE__ */ new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "line",
  "arrow",
  "freedraw",
  "image",
  "frame",
  "magicframe",
  "embeddable",
  "iframe",
  "selection"
]);
var LABEL_HOSTS = /* @__PURE__ */ new Set(["rectangle", "ellipse", "diamond", "arrow"]);
var ARROWHEADS = /* @__PURE__ */ new Set([
  "arrow",
  "triangle",
  "square",
  "dot",
  "pipe",
  "diamond",
  "inverted",
  "bar",
  "none"
]);
var FONT_SIZE = { s: 18, m: 24, l: 36, xl: 44 };
function devWarn(message, detail) {
  if (!define_import_meta_env_default?.DEV) return;
  if (detail === void 0) console.warn(message);
  else console.warn(message, detail);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function num(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}
function positive(value) {
  const next = Math.abs(num(value, 0));
  return next > 0 ? next : 1;
}
function opacityOf(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 1;
  const unit = next > 1 ? next / 100 : next;
  return Math.min(1, Math.max(0, unit));
}
function hexOf(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (!match) return "";
  const hex = match[1];
  if (hex.length === 8 && hex.slice(6) === "00") return "";
  if (hex.length === 3) return hex.split("").map((item) => item + item).join("");
  return hex.slice(0, 6);
}
function colorOf(value, fallback = "black") {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "transparent") return fallback;
  if (raw === "black" || raw === "white" || raw === "grey" || raw === "red" || raw === "blue" || raw === "green" || raw === "yellow" || raw === "orange" || raw === "violet") {
    return raw;
  }
  const hex = hexOf(raw);
  return hex ? `c${hex}` : fallback;
}
function dashOf(element) {
  const style = String(element.strokeStyle || "");
  if (style === "dashed") return "dashed";
  if (style === "dotted") return "dotted";
  if (num(element.roughness, 1) === 0) return "solid";
  return "draw";
}
function fillOf(element) {
  const background = String(element.backgroundColor || "").trim().toLowerCase();
  if (!background || background === "transparent") return "none";
  if (background.startsWith("#") && !hexOf(background)) return "none";
  const style = String(element.fillStyle || "hachure");
  if (style === "none") return "none";
  if (style === "solid") return "solid";
  return "pattern";
}
function strokeSize(value) {
  const width = num(value, 1);
  if (width <= 1.25) return "s";
  if (width <= 2.25) return "m";
  if (width <= 3.5) return "l";
  return "xl";
}
function fontOf(value) {
  const family = Number(value);
  if (family === 2) return "sans";
  if (family === 3) return "mono";
  if (family === 4) return "serif";
  return "draw";
}
function alignOf(value) {
  const align = String(value || "");
  if (align === "center" || align === "middle") return "middle";
  if (align === "right" || align === "end") return "end";
  return "start";
}
function verticalOf(value) {
  const align = String(value || "");
  if (align === "top" || align === "start") return "start";
  if (align === "bottom" || align === "end") return "end";
  return "middle";
}
function textMetrics(value) {
  const target = num(value, 20) > 0 ? num(value, 20) : 20;
  let size = "m";
  let best = Infinity;
  for (const [name, base] of Object.entries(FONT_SIZE)) {
    const distance = Math.abs(Math.log(target / base));
    if (distance < best) {
      best = distance;
      size = name;
    }
  }
  return {
    size,
    scale: Math.min(8, Math.max(0.25, target / FONT_SIZE[size]))
  };
}
function textOf(element) {
  if (typeof element.originalText === "string") return element.originalText;
  if (typeof element.text === "string") return element.text;
  return "";
}
function linkOf(element) {
  const raw = String(element.link || "");
  return /^https?:\/\//i.test(raw) ? raw : "";
}
function pointsOf(element) {
  if (!Array.isArray(element.points)) return [];
  const pressures = Array.isArray(element.pressures) ? element.pressures : null;
  const points = [];
  element.points.forEach((point, index) => {
    let x = Number.NaN;
    let y = Number.NaN;
    if (Array.isArray(point)) {
      x = Number(point[0]);
      y = Number(point[1]);
    } else if (isRecord(point)) {
      x = Number(point.x);
      y = Number(point.y);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const next = { x, y };
    const pressure = pressures ? Number(pressures[index]) : Number.NaN;
    if (Number.isFinite(pressure)) next.z = Math.min(1, Math.max(0, pressure));
    points.push(next);
  });
  return points;
}
function arrowhead(value, fallback) {
  if (value === void 0) return fallback;
  if (value === null || value === "") return "none";
  const name = String(value);
  return ARROWHEADS.has(name) ? name : fallback;
}
function arrowBend(points) {
  if (points.length < 3) return 0;
  const start = points[0];
  const end = points[points.length - 1];
  const mid = points[Math.floor(points.length / 2)];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  return ((mid.x - start.x) * dy - (mid.y - start.y) * dx) / length;
}
function legacyId(prefix, raw, used) {
  const cleaned = String(raw ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 96);
  const body = cleaned || "item";
  let id = `${prefix}:excalidraw-${body}`;
  let suffix = 2;
  while (used.has(id)) {
    id = `${prefix}:excalidraw-${body}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}
function fileFor(files, fileId) {
  if (!isRecord(files)) return null;
  const id = String(fileId ?? "");
  if (!id) return null;
  const direct = files[id];
  if (isRecord(direct)) return direct;
  for (const value of Object.values(files)) {
    if (isRecord(value) && String(value.id || "") === id) return value;
  }
  return null;
}
function isBackendUrl(value) {
  return value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://");
}
function imageSource(file) {
  if (!file) return "";
  const url = String(file.url || "");
  const dataUrl = String(file.dataURL || "");
  if (isBackendUrl(url)) return url;
  if (isBackendUrl(dataUrl)) return dataUrl;
  const stable = stableUrlOf(file);
  if (stable) return stable;
  if (dataUrl.startsWith("data:")) return dataUrl;
  if (url.startsWith("data:")) return url;
  return "";
}
function hasTldrawRecord(value) {
  if (!isRecord(value)) return false;
  const typeName = String(value.typeName || "");
  return typeName === "shape" || typeName === "page" || typeName === "document" || typeName === "asset";
}
function isTldrawSnapshot(data) {
  try {
    if (!isRecord(data)) return false;
    if (isRecord(data.store)) {
      return Object.values(data.store).some((record) => hasTldrawRecord(record));
    }
    if (Array.isArray(data.records)) {
      return data.records.some((record) => hasTldrawRecord(record));
    }
    return Object.entries(data).some(([key, record]) => (key.startsWith("shape:") || key.startsWith("page:") || key.startsWith("document:") || key.startsWith("asset:")) && hasTldrawRecord(record));
  } catch {
    return false;
  }
}
function isExcalidrawSnapshot(data) {
  try {
    if (!isRecord(data) || isTldrawSnapshot(data)) return false;
    if (!Array.isArray(data.elements)) return false;
    const typed = data.elements.some((element) => isRecord(element) && EXCALIDRAW_TYPES.has(String(element.type || "")));
    if (typed) return true;
    return "appState" in data || "files" in data;
  } catch {
    return false;
  }
}
function shapeBase(id, type, element, pageId, props) {
  return {
    id,
    typeName: "shape",
    type,
    x: num(element.x),
    y: num(element.y),
    rotation: num(element.angle),
    index: "a1",
    parentId: pageId,
    isLocked: Boolean(element.locked),
    opacity: opacityOf(element.opacity),
    props,
    meta: {}
  };
}
function geoProps(element, geo, label) {
  const metrics = textMetrics(label?.fontSize);
  const color = colorOf(element.strokeColor);
  return {
    geo,
    dash: dashOf(element),
    url: linkOf(element),
    w: positive(element.width),
    h: positive(element.height),
    growY: 0,
    scale: 1,
    flipX: false,
    flipY: false,
    labelColor: label ? colorOf(label.strokeColor, color) : color,
    color,
    fill: fillOf(element),
    size: label ? metrics.size : strokeSize(element.strokeWidth),
    font: label ? fontOf(label.fontFamily) : "draw",
    align: label ? alignOf(label.textAlign) : "middle",
    verticalAlign: label ? verticalOf(label.verticalAlign) : "middle",
    richText: toRichText(label ? textOf(label) : "")
  };
}
function linePoints(points) {
  const source = points.length === 1 ? [points[0], { x: points[0].x + 1, y: points[0].y }] : points;
  const indexes = getIndicesBetween(null, null, source.length);
  const mapped = {};
  source.forEach((point, index) => {
    const key = indexes[index];
    mapped[key] = { id: key, index: key, x: point.x, y: point.y };
  });
  return mapped;
}
function convertExcalidrawToTldraw(oldScene, options = {}) {
  try {
    if (!isExcalidrawSnapshot(oldScene) || !isRecord(oldScene)) return [];
    const pageId = options.pageId || PAGE_ID;
    const elements = Array.isArray(oldScene.elements) ? oldScene.elements : [];
    const files = oldScene.files;
    const used = /* @__PURE__ */ new Set();
    const labels = /* @__PURE__ */ new Map();
    const parents = /* @__PURE__ */ new Map();
    let warnedGroups = false;
    let warnedFrames = false;
    let warnedEmbeds = false;
    let warnedPolygons = false;
    elements.forEach((element) => {
      if (!isRecord(element) || element.isDeleted) return;
      const id = String(element.id || "");
      if (id) parents.set(id, element);
    });
    elements.forEach((element) => {
      if (!isRecord(element) || element.isDeleted || element.type !== "text") return;
      const containerId = String(element.containerId || "");
      const parent = parents.get(containerId);
      if (!parent || !LABEL_HOSTS.has(String(parent.type || ""))) return;
      const list = labels.get(containerId) || [];
      list.push(element);
      labels.set(containerId, list);
    });
    const absorbed = /* @__PURE__ */ new Set();
    labels.forEach((list) => {
      list.forEach((element) => {
        if (element.id) absorbed.add(String(element.id));
      });
    });
    const assets = [];
    const shapes = [];
    const assetIds = /* @__PURE__ */ new Map();
    const pushShape = (element, record) => {
      if (!record) return;
      shapes.push(record);
      const notes = labels.get(String(element.id || "")) || [];
      notes.forEach((note) => absorbed.add(String(note.id || "")));
    };
    elements.forEach((raw) => {
      if (!isRecord(raw) || raw.isDeleted || raw.type === "selection") return;
      if (Array.isArray(raw.groupIds) && raw.groupIds.length && !warnedGroups) {
        warnedGroups = true;
        devWarn("excalidraw groups are restored as separate shapes");
      }
      const type = String(raw.type || "");
      if (type === "text" && absorbed.has(String(raw.id || ""))) return;
      try {
        if (type === "rectangle" || type === "ellipse" || type === "diamond") {
          const label = (labels.get(String(raw.id || "")) || [])[0] || null;
          pushShape(raw, shapeBase(
            legacyId("shape", raw.id, used),
            "geo",
            raw,
            pageId,
            geoProps(raw, type === "rectangle" ? "rectangle" : type, label)
          ));
          return;
        }
        if (type === "text") {
          const content = textOf(raw);
          if (!content) return;
          const metrics = textMetrics(raw.fontSize);
          pushShape(raw, shapeBase(legacyId("shape", raw.id, used), "text", raw, pageId, {
            color: colorOf(raw.strokeColor),
            size: metrics.size,
            font: fontOf(raw.fontFamily),
            textAlign: alignOf(raw.textAlign),
            w: positive(raw.width),
            richText: toRichText(content),
            scale: metrics.scale,
            autoSize: false
          }));
          return;
        }
        if (type === "line" || type === "arrow") {
          const points = pointsOf(raw);
          if (!points.length) {
            devWarn(`excalidraw ${type} has no points`, raw.id);
            return;
          }
          if (type === "line") {
            if (raw.polygon && !warnedPolygons) {
              warnedPolygons = true;
              devWarn("excalidraw polygons are restored as lines");
            }
            pushShape(raw, shapeBase(legacyId("shape", raw.id, used), "line", raw, pageId, {
              color: colorOf(raw.strokeColor),
              dash: dashOf(raw),
              size: strokeSize(raw.strokeWidth),
              spline: raw.roundness ? "cubic" : "line",
              points: linePoints(points),
              scale: 1
            }));
            return;
          }
          const start = points[0];
          const end = points[points.length - 1];
          const label = (labels.get(String(raw.id || "")) || [])[0] || null;
          const distance = Math.hypot(end.x - start.x, end.y - start.y);
          pushShape(raw, shapeBase(legacyId("shape", raw.id, used), "arrow", raw, pageId, {
            kind: raw.elbowed ? "elbow" : "arc",
            labelColor: label ? colorOf(label.strokeColor, colorOf(raw.strokeColor)) : colorOf(raw.strokeColor),
            color: colorOf(raw.strokeColor),
            fill: "none",
            dash: dashOf(raw),
            size: strokeSize(raw.strokeWidth),
            arrowheadStart: arrowhead(raw.startArrowhead, "none"),
            arrowheadEnd: arrowhead(raw.endArrowhead, "arrow"),
            font: label ? fontOf(label.fontFamily) : "draw",
            start: { x: start.x, y: start.y },
            end: distance < 0.5 ? { x: start.x + positive(raw.width), y: start.y } : { x: end.x, y: end.y },
            bend: raw.elbowed ? 0 : arrowBend(points),
            richText: toRichText(label ? textOf(label) : ""),
            labelPosition: 0.5,
            scale: 1,
            elbowMidPoint: 0.5
          }));
          return;
        }
        if (type === "freedraw") {
          const points = pointsOf(raw);
          if (!points.length) {
            devWarn("excalidraw freedraw has no points", raw.id);
            return;
          }
          const pressured = points.some((point) => typeof point.z === "number" && Math.abs(point.z - 0.5) > 1e-3);
          pushShape(raw, shapeBase(legacyId("shape", raw.id, used), "draw", raw, pageId, {
            color: colorOf(raw.strokeColor),
            fill: "none",
            dash: dashOf(raw),
            size: strokeSize(raw.strokeWidth),
            segments: [{
              type: "free",
              path: pressured ? b64Vecs.encodePoints(points) : b64Vecs.encodePoints(points, DIM_2D),
              dim: pressured ? DIM_3D : DIM_2D
            }],
            isComplete: true,
            isClosed: false,
            isPen: pressured,
            scale: 1,
            scaleX: 1,
            scaleY: 1
          }));
          return;
        }
        if (type === "image") {
          const file = fileFor(files, raw.fileId);
          const src = imageSource(file);
          if (!src || !file) {
            devWarn("excalidraw image has no readable asset", raw.id);
            return;
          }
          const fileId = String(raw.fileId || file.id || raw.id || "");
          let assetId = assetIds.get(fileId);
          if (!assetId) {
            assetId = legacyId("asset", fileId, used);
            assetIds.set(fileId, assetId);
            const mime = String(file.mimeType || "").split(";", 1)[0].trim().toLowerCase();
            assets.push({
              id: assetId,
              typeName: "asset",
              type: "image",
              props: {
                w: positive(raw.width),
                h: positive(raw.height),
                name: String(file.id || fileId || "image"),
                isAnimated: false,
                mimeType: mime || (src.startsWith("data:") ? src.slice(5).split(";", 1)[0] : "image/png"),
                src
              },
              meta: {}
            });
          }
          pushShape(raw, shapeBase(legacyId("shape", raw.id, used), "image", raw, pageId, {
            w: positive(raw.width),
            h: positive(raw.height),
            playing: false,
            url: "",
            assetId,
            crop: null,
            flipX: false,
            flipY: false,
            altText: ""
          }));
          return;
        }
        if (type === "frame" || type === "magicframe" || type === "embeddable" || type === "iframe") {
          if ((type === "frame" || type === "magicframe") && !warnedFrames) {
            warnedFrames = true;
            devWarn("excalidraw frames are restored as rectangles");
          }
          if ((type === "embeddable" || type === "iframe") && !warnedEmbeds) {
            warnedEmbeds = true;
            devWarn("excalidraw embeds are restored as rectangles");
          }
          pushShape(raw, shapeBase(legacyId("shape", raw.id, used), "geo", raw, pageId, geoProps(raw, "rectangle", null)));
          return;
        }
        devWarn("excalidraw shape has no exact tldraw match", type || raw.id);
        if (num(raw.width, 0) > 0 && num(raw.height, 0) > 0) {
          pushShape(raw, shapeBase(legacyId("shape", raw.id, used), "geo", raw, pageId, geoProps(raw, "rectangle", null)));
        }
      } catch (error) {
        console.error("skipped excalidraw element", raw.id, error);
        (labels.get(String(raw.id || "")) || []).forEach((note) => {
          const content = textOf(note);
          if (!content) return;
          try {
            const metrics = textMetrics(note.fontSize);
            shapes.push(shapeBase(legacyId("shape", note.id, used), "text", note, pageId, {
              color: colorOf(note.strokeColor),
              size: metrics.size,
              font: fontOf(note.fontFamily),
              textAlign: alignOf(note.textAlign),
              w: positive(note.width),
              richText: toRichText(content),
              scale: metrics.scale,
              autoSize: false
            }));
          } catch (textError) {
            console.error("skipped excalidraw text", note.id, textError);
          }
        });
      }
    });
    const indexes = getIndicesBetween(null, null, shapes.length);
    shapes.forEach((shape, index) => {
      shape.index = indexes[index];
    });
    return [...assets, ...shapes];
  } catch (error) {
    console.error("excalidraw conversion failed", error);
    return [];
  }
}
function documentShapes(editor) {
  const records = editor.store?.allRecords?.() || [];
  return records.filter((record) => record?.typeName === "shape");
}
function placeLegacyRecords(editor, scene, records, camera) {
  try {
    if (!records.length || !editor.store?.put || !editor.store.mergeRemoteChanges) return false;
    const existing = new Set((editor.store.allRecords?.() || []).map((record) => record.id));
    const missing = records.filter((record) => record?.id && !existing.has(record.id));
    if (!missing.length) return false;
    const previousShapes = documentShapes(editor);
    let lowest = null;
    previousShapes.forEach((shape) => {
      if (typeof shape.index === "string" && (lowest === null || shape.index < lowest)) lowest = shape.index;
    });
    const pageId = editor.getCurrentPageId?.() || PAGE_ID;
    const shapeIndexes = lowest ? getIndicesBelow(lowest, missing.filter((record) => record.typeName === "shape").length) : null;
    let shapeIndex = 0;
    const placed = missing.map((record) => {
      if (record.typeName !== "shape") return record;
      const index = shapeIndexes ? shapeIndexes[shapeIndex] : record.index;
      shapeIndex += 1;
      return { ...record, index, parentId: pageId };
    });
    const failedAssets = /* @__PURE__ */ new Set();
    let added = 0;
    editor.store.mergeRemoteChanges(() => {
      placed.forEach((record) => {
        if (record.typeName === "shape" && record.type === "image") {
          const assetId = String(record.props?.assetId || "");
          if (assetId && failedAssets.has(assetId)) return;
        }
        try {
          editor.store?.put?.([record]);
          added += 1;
        } catch (error) {
          if (record.typeName === "asset") failedAssets.add(record.id);
          console.error("skipped restored board record", record.id, error);
        }
      });
    });
    if (!added) return false;
    if (camera && !previousShapes.length) {
      const app = isRecord(scene) && isRecord(scene.appState) ? scene.appState : null;
      const scrollX = Number(app?.scrollX);
      const scrollY = Number(app?.scrollY);
      const zoom = app?.zoom;
      const zoomValue = typeof zoom === "number" ? zoom : Number(isRecord(zoom) ? zoom.value : Number.NaN);
      try {
        if (Number.isFinite(scrollX) && Number.isFinite(scrollY)) {
          editor.setCamera?.(cameraFromExcalidrawScroll(
            scrollX,
            scrollY,
            Number.isFinite(zoomValue) && zoomValue > 0 ? zoomValue : 1
          ));
        } else {
          editor.zoomToFit?.();
        }
      } catch (error) {
        console.error("failed to restore excalidraw camera", error);
      }
    }
    return true;
  } catch (error) {
    console.error("failed to restore excalidraw board", error);
    return false;
  }
}
function loadLegacyExcalidrawScene(editor, scene) {
  try {
    if (isTldrawSnapshot(scene)) return false;
    if (!isExcalidrawSnapshot(scene)) {
      if (isRecord(scene) && Object.keys(scene).length) {
        console.warn("interactive board scene format is not tldraw or excalidraw");
      }
      return false;
    }
    return placeLegacyRecords(editor, scene, convertExcalidrawToTldraw(scene), true);
  } catch (error) {
    console.error("failed to restore excalidraw board", error);
    return false;
  }
}
function publishLegacyEdits(client, editor, legacyIds) {
  const diff = client?.unsentChanges?.nextDiff;
  if (!diff || !legacyIds.size) return false;
  const updated = diff.updated || {};
  const removed = diff.removed || {};
  const touched = Object.keys(updated).some((id) => legacyIds.has(id)) || Object.keys(removed).some((id) => legacyIds.has(id));
  if (!touched) return false;
  if (!diff.added) diff.added = {};
  for (const id of Object.keys(updated)) {
    if (!legacyIds.has(id)) continue;
    diff.added[id] = updated[id][1];
    delete updated[id];
  }
  const records = editor.store?.allRecords?.() || [];
  for (const record of records) {
    if (!record?.id || !legacyIds.has(record.id) || diff.added[record.id] || removed[record.id]) continue;
    diff.added[record.id] = record;
  }
  return true;
}
function legacySyncClient(editor) {
  const client = globalThis.window?.tlsync;
  if (!client?.unsentChanges) return null;
  if (client.store && editor.store && client.store !== editor.store) return null;
  return client;
}
function attachLegacyExcalidrawScene(editor, scene) {
  const restored = loadLegacyExcalidrawScene(editor, scene);
  const dispose = () => {
  };
  if (!restored && (!isExcalidrawSnapshot(scene) || isTldrawSnapshot(scene))) {
    return { restored: false, dispose };
  }
  const records = convertExcalidrawToTldraw(scene);
  if (!records.length || typeof editor.store?.listen !== "function") {
    return { restored, dispose };
  }
  const legacyIds = new Set(records.map((record) => record.id).filter(Boolean));
  let applying = false;
  let published = false;
  const stop = editor.store.listen(() => {
    if (applying) return;
    applying = true;
    try {
      placeLegacyRecords(editor, scene, records, false);
    } finally {
      applying = false;
    }
  }, { source: "remote", scope: "document" });
  const stopUser = editor.store.listen(() => {
    if (published || applying) return;
    if (publishLegacyEdits(legacySyncClient(editor), editor, legacyIds)) published = true;
  }, { source: "user", scope: "document" });
  return {
    restored,
    dispose: () => {
      if (typeof stop === "function") stop();
      if (typeof stopUser === "function") stopUser();
    }
  };
}
export {
  attachLegacyExcalidrawScene,
  convertExcalidrawToTldraw,
  isExcalidrawSnapshot,
  isTldrawSnapshot,
  loadLegacyExcalidrawScene,
  publishLegacyEdits
};
