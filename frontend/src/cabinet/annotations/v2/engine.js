import { COORD_SPACE_CAPTURED_V1, normalizeShapePoints, pointerToNormalized, pxWidthToNormalized, sanitizeNormalizedPoint, sanitizeNormalizedPoints, viewportPointerToNormalized } from "./coordinateMapper";
import { rectsClose } from "../../screenshare/contentRect";
import { createPointerMachine } from "./pointerMachine";
import { createStrokeStore, isPersistentStroke } from "./strokeStore";
import { createAnnotationRenderer } from "./renderer";
import { createAnnotationHistory } from "./history";
import { continueStrokeSegment, scalePoints, strokeBounds, translatePoints } from "./smoothStroke";
import { annDebug } from "./debug";
import { operationBelongsToSession } from "./sessionFilter";
import {
  HIGHLIGHTER_OPACITY_DEFAULT,
  NAME_LABEL_TTL_MS,
  SHAPE_TOOLS,
  TOOLS,
  VANISHING_TTL_MS,
  isEphemeralTool,
  isPassthroughTool,
  newAnnotationId,
} from "../../screenshare/constants";

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTest(stroke, x, y, threshold = 0.02, { interior = false } = {}) {
  const pts = stroke?.points || [];
  const tool = String(stroke?.tool || "pen");
  if ((tool === "text" || tool === "stamp" || tool === "arrow_pointer") && pts[0]) {
    return Math.hypot(pts[0].x - x, pts[0].y - y) < 0.06;
  }
  if ((tool === "rect" || tool === "ellipse") && pts.length >= 2) {
    const x1 = Math.min(pts[0].x, pts[pts.length - 1].x);
    const y1 = Math.min(pts[0].y, pts[pts.length - 1].y);
    const x2 = Math.max(pts[0].x, pts[pts.length - 1].x);
    const y2 = Math.max(pts[0].y, pts[pts.length - 1].y);
    const nearEdge = (
      (Math.abs(x - x1) <= threshold && y >= y1 - threshold && y <= y2 + threshold)
      || (Math.abs(x - x2) <= threshold && y >= y1 - threshold && y <= y2 + threshold)
      || (Math.abs(y - y1) <= threshold && x >= x1 - threshold && x <= x2 + threshold)
      || (Math.abs(y - y2) <= threshold && x >= x1 - threshold && x <= x2 + threshold)
    );
    if (nearEdge) return true;
    if (!interior) return false;
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  }
  if (pts.length < 2) {
    return pts[0] ? Math.hypot(pts[0].x - x, pts[0].y - y) <= threshold * 2 : false;
  }
  for (let i = 1; i < pts.length; i += 1) {
    if (distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= threshold) {
      return true;
    }
  }
  return false;
}

function stampPoint(point, event) {
  const clean = sanitizeNormalizedPoint(point);
  if (!clean) return null;
  return {
    x: clean.x,
    y: clean.y,
    t: Date.now(),
    pressure: Number(event?.pressure) || 0,
  };
}

function cloneAnn(ann) {
  if (!ann) return null;
  return { ...ann, points: Array.isArray(ann.points) ? ann.points.map((p) => ({ ...p })) : [] };
}

export function createAnnotationEngine({
  authorId = null,
  displayName = "",
  sourceWidth = 1920,
  canAnnotate = false,
  canManage = false,
  isPresenter = false,
  showAuthorNames = false,
  presenterUserId = null,
  sessionId = "",
  onSend,
  onPointer,
  onTextRequest,
} = {}) {
  const store = createStrokeStore();
  const history = createAnnotationHistory();
  let renderer = null;
  let canvas = null;
  let host = null;
  let layout = null;
  let tool = TOOLS.PEN;
  let color = "#ef4444";
  let widthPx = 2;
  let opacity = HIGHLIGHTER_OPACITY_DEFAULT;
  let fontSize = 18;
  let fontWeight = 650;
  let stampKind = "star";
  let drawingEnabled = false;
  let localStroke = null;
  let pending = [];
  let flushTimer = 0;
  let lasers = [];
  let nameLabels = [];
  let disposed = false;
  let laserPointerId = null;
  let pointerSpace = "content";
  let viewportRenderer = null;
  let viewportCanvas = null;
  let selectedId = "";
  let drag = null;
  let vanishTimer = 0;
  let boundSessionId = String(sessionId || "");
  let remoteBuffer = new Map();
  let strokeGap = false;

  const syncRender = () => {
    const list = store.list();
    renderer?.setStrokes(list);
    renderer?.setLocalStroke(localStroke);
    renderer?.setLasers(lasers);
    renderer?.setSelectedId(selectedId);
    renderer?.setNameLabels(nameLabels);
    viewportRenderer?.setStrokes(list);
    viewportRenderer?.setLocalStroke(localStroke);
    viewportRenderer?.setLasers(lasers);
    viewportRenderer?.setSelectedId(selectedId);
    viewportRenderer?.setNameLabels(nameLabels);
  };

  const pushName = (point) => {
    if (!showAuthorNames || !point || !displayName) return;
    nameLabels = [{
      x: point.x,
      y: point.y,
      displayName,
      at: Date.now(),
      authorId,
    }];
    window.setTimeout(() => {
      if (disposed) return;
      nameLabels = nameLabels.filter((item) => Date.now() - item.at < NAME_LABEL_TTL_MS);
      syncRender();
    }, NAME_LABEL_TTL_MS);
  };

  const toNorm = (event) => {
    if (!event) return null;
    let raw = null;
    if (pointerSpace === "viewport") {
      raw = viewportPointerToNormalized(event.clientX, event.clientY, {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    } else if (layout?.content) {
      raw = pointerToNormalized(event.clientX, event.clientY, layout.content);
    }
    return stampPoint(raw, event);
  };

  const flushRemoteBuffer = (id) => {
    const key = String(id || "");
    const buf = remoteBuffer.get(key);
    if (!buf) return;
    remoteBuffer.delete(key);
    if (buf.points?.length) store.appendPoints(key, buf.points);
    if (buf.end) store.end(key);
  };

  const bufferRemotePoints = (id, points, { end = false } = {}) => {
    const key = String(id || "");
    if (!key) return;
    const prev = remoteBuffer.get(key) || { points: [], end: false };
    prev.points = prev.points.concat(points || []).slice(0, 800);
    prev.end = prev.end || end;
    remoteBuffer.set(key, prev);
    if (remoteBuffer.size > 24) {
      const first = remoteBuffer.keys().next().value;
      remoteBuffer.delete(first);
    }
  };

  const widthForTool = (nextTool) => {
    if (nextTool === TOOLS.HIGHLIGHTER) return widthPx * 3;
    return widthPx;
  };

  const baseAnnotation = (id, nextTool, points) => ({
    id,
    tool: nextTool,
    color,
    width: widthForTool(nextTool),
    widthNormalized: pxWidthToNormalized(widthForTool(nextTool), sourceWidth),
    opacity: nextTool === TOOLS.HIGHLIGHTER ? opacity : 1,
    fontSize,
    fontWeight,
    stamp: stampKind,
    points,
    authorId,
    displayName,
    coordSpace: COORD_SPACE_CAPTURED_V1,
    createdAt: Date.now(),
    completed: false,
    ephemeral: isEphemeralTool(nextTool),
  });

  const send = (action, payload) => {
    onSend?.(action, payload);
  };

  const rememberCreate = (ann) => {
    if (!isPersistentStroke(ann)) return;
    history.push({ type: "create", annotation: cloneAnn(ann) });
  };

  const flushPending = (sourceRevision) => {
    if (!pending.length || !localStroke) return;
    const points = pending.splice(0, 40);
    send("stroke_update", {
      annotation: {
        id: localStroke.id,
        tool: localStroke.tool,
        color: localStroke.color,
        width: localStroke.width,
        widthNormalized: localStroke.widthNormalized,
        opacity: localStroke.opacity,
        points,
        coordSpace: COORD_SPACE_CAPTURED_V1,
        sourceRevision,
        sequence: localStroke.sequence,
        ephemeral: localStroke.ephemeral,
      },
    });
  };

  const machine = createPointerMachine({
    onStart: ({ strokeId, point, sourceRevision, sequence, pressure, timestamp }) => {
      localStroke = {
        ...baseAnnotation(strokeId, tool, [point]),
        sequence,
        pressure,
        createdAt: timestamp,
      };
      store.start(localStroke);
      pending = [];
      strokeGap = false;
      syncRender();
      if (tool === TOOLS.PEN || tool === TOOLS.HIGHLIGHTER || tool === TOOLS.VANISHING) {
        send("stroke_start", { annotation: { ...localStroke, points: [point] } });
      }
      annDebug("stroke-start", { strokeId, sourceRevision, tool });
    },
    onPoint: ({ point, sequence, sourceRevision, coalesced }) => {
      if (!localStroke) return;
      const extras = [];
      if (Array.isArray(coalesced) && coalesced.length) {
        for (const ev of coalesced) {
          const mapped = toNorm(ev);
          if (mapped) extras.push(mapped);
        }
      }
      const incoming = extras.length ? extras : (point ? [point] : []);
      if (!incoming.length) return;
      if (SHAPE_TOOLS.has(localStroke.tool)) {
        localStroke.points = [localStroke.points[0], incoming[incoming.length - 1]];
        syncRender();
        return;
      }
      const dense = [];
      let prev = localStroke.points[localStroke.points.length - 1];
      for (const item of incoming) {
        const added = continueStrokeSegment(prev, item, { gap: strokeGap });
        strokeGap = false;
        dense.push(...added);
        prev = item;
      }
      localStroke.points.push(...dense);
      localStroke.sequence = sequence;
      pending.push(...dense);
      syncRender();
      if (!flushTimer) {
        flushTimer = window.setTimeout(() => {
          flushTimer = 0;
          flushPending(sourceRevision);
        }, 32);
      }
    },
    onEnd: ({ strokeId, point, sourceRevision }) => {
      if (flushTimer) {
        window.clearTimeout(flushTimer);
        flushTimer = 0;
      }
      if (!localStroke) return;
      if (point && localStroke.tool !== TOOLS.LASER && localStroke.tool !== TOOLS.SPOTLIGHT) {
        const last = localStroke.points[localStroke.points.length - 1];
        if (!last || last.x !== point.x || last.y !== point.y) localStroke.points.push(point);
      }
      flushPending(sourceRevision);
      const finished = { ...localStroke, completed: true };
      if (SHAPE_TOOLS.has(localStroke.tool) && localStroke.points.length >= 2) {
        finished.points = normalizeShapePoints(localStroke.tool, finished.points);
        store.start(finished);
        send("object_upsert", { annotation: finished });
        rememberCreate(finished);
      } else if (
        localStroke.tool === TOOLS.PEN
        || localStroke.tool === TOOLS.HIGHLIGHTER
        || localStroke.tool === TOOLS.VANISHING
      ) {
        store.end(strokeId);
        send("stroke_end", {
          annotation: {
            id: strokeId,
            tool: localStroke.tool,
            points: [],
            ephemeral: localStroke.ephemeral,
          },
        });
        if (localStroke.tool !== TOOLS.VANISHING) rememberCreate(finished);
        else scheduleVanishCleanup();
      }
      pushName(finished.points?.[finished.points.length - 1]);
      localStroke = null;
      syncRender();
      annDebug("stroke-end", { strokeId, sourceRevision });
    },
    onCancel: ({ strokeId }) => {
      if (flushTimer) {
        window.clearTimeout(flushTimer);
        flushTimer = 0;
      }
      pending = [];
      store.cancel(strokeId);
      localStroke = null;
      syncRender();
      if (strokeId) send("stroke_cancel", { id: strokeId, annotation: { id: strokeId } });
      annDebug("stroke-cancel", { strokeId });
    },
    onGap: () => {
      strokeGap = true;
    },
  });

  const scheduleVanishCleanup = () => {
    if (vanishTimer) return;
    vanishTimer = window.setTimeout(() => {
      vanishTimer = 0;
      if (disposed) return;
      const now = Date.now();
      let changed = false;
      for (const stroke of store.list()) {
        if (stroke.tool !== TOOLS.VANISHING) continue;
        if (now - Number(stroke.createdAt || 0) >= VANISHING_TTL_MS) {
          store.remove(stroke.id);
          changed = true;
        }
      }
      if (changed) syncRender();
      if (store.list().some((s) => s.tool === TOOLS.VANISHING)) scheduleVanishCleanup();
    }, 120);
  };

  const canEditStroke = (stroke) => {
    if (!stroke) return false;
    if (Number(stroke.authorId) === Number(authorId)) return true;
    return Boolean(canManage || isPresenter);
  };

  const placeObject = (ann) => {
    if (ann.tool === TOOLS.ARROW_POINTER) {
      const prev = store.list().find((s) => (
        Number(s.authorId) === Number(authorId) && s.tool === TOOLS.ARROW_POINTER
      ));
      if (prev) store.remove(prev.id);
      store.start(ann);
      send("arrow_set", { annotation: { ...ann, completed: true } });
      return;
    }
    store.start({ ...ann, completed: true });
    send("object_upsert", { annotation: { ...ann, completed: true } });
    rememberCreate(ann);
    pushName(ann.points?.[0]);
    syncRender();
  };

  const onPointerDown = (event) => {
    if (!drawingEnabled || !canAnnotate) return;
    if (event.isPrimary === false) return;
    const point = toNorm(event);
    if (!point) return;
    if (isPassthroughTool(tool)) return;
    event.preventDefault();
    if (tool === TOOLS.ERASER) {
      const hit = [...store.list()].reverse().find((s) => {
        if (!canEditStroke(s)) return false;
        return hitTest(s, point.x, point.y, 0.012, { interior: false });
      });
      if (hit && isPersistentStroke(hit)) {
        const snapshot = store.getClone(hit.id);
        store.remove(hit.id);
        if (selectedId === hit.id) selectedId = "";
        syncRender();
        send("annotation_deleted", { id: hit.id });
        history.push({ type: "delete", annotation: snapshot });
      }
      return;
    }
    if (tool === TOOLS.SELECT) {
      const hit = [...store.list()].reverse().find((s) => (
        Number(s.authorId) === Number(authorId) && isPersistentStroke(s) && hitTest(s, point.x, point.y, 0.02, { interior: true })
      ));
      selectedId = hit?.id || "";
      if (hit) {
        try {
          event.currentTarget?.setPointerCapture?.(event.pointerId);
        } catch {
          /* ignore */
        }
        const bounds = strokeBounds(hit.points);
        const corner = bounds && (
          (Math.abs(point.x - (bounds.x + bounds.w)) < 0.02 && Math.abs(point.y - (bounds.y + bounds.h)) < 0.02)
          || (Math.abs(point.x - bounds.x) < 0.02 && Math.abs(point.y - bounds.y) < 0.02)
        );
        drag = {
          pointerId: event.pointerId,
          id: hit.id,
          mode: corner ? "resize" : "move",
          start: point,
          origin: bounds ? { x: bounds.x, y: bounds.y } : point,
          before: store.getClone(hit.id),
        };
      }
      renderer?.setSelectedId(selectedId);
      syncRender();
      return;
    }
    if (tool === TOOLS.LASER || tool === TOOLS.SPOTLIGHT) {
      try {
        event.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
      laserPointerId = event.pointerId;
      onPointer?.({ ...point, kind: tool === TOOLS.SPOTLIGHT ? "spotlight" : "laser" });
      return;
    }
    if (tool === TOOLS.TEXT) {
      onTextRequest?.(point);
      return;
    }
    if (tool === TOOLS.STAMP) {
      const ann = baseAnnotation(newAnnotationId(), TOOLS.STAMP, [point]);
      placeObject(ann);
      return;
    }
    if (tool === TOOLS.ARROW_POINTER) {
      const ann = baseAnnotation(newAnnotationId(), TOOLS.ARROW_POINTER, [point]);
      placeObject({ ...ann, completed: true });
      syncRender();
      return;
    }
    machine.pointerdown(event, point, { strokeId: newAnnotationId() });
  };

  const onPointerMove = (event) => {
    if (!drawingEnabled) return;
    const point = toNorm(event);
    if (drag && event.pointerId === drag.pointerId && point) {
      const stroke = store.get(drag.id);
      if (!stroke) return;
      event.preventDefault();
      if (drag.mode === "resize" && drag.before?.points?.length) {
        const sx = (point.x - drag.origin.x) / Math.max(0.01, (drag.start.x - drag.origin.x) || 0.01);
        const sy = (point.y - drag.origin.y) / Math.max(0.01, (drag.start.y - drag.origin.y) || 0.01);
        store.update(drag.id, {
          points: scalePoints(drag.before.points, drag.origin, sx, sy),
        });
      } else {
        store.update(drag.id, {
          points: translatePoints(drag.before.points, point.x - drag.start.x, point.y - drag.start.y),
        });
      }
      syncRender();
      return;
    }
    if (tool === TOOLS.LASER || tool === TOOLS.SPOTLIGHT) {
      if (laserPointerId != null && event.pointerId === laserPointerId && point) {
        onPointer?.({ ...point, kind: tool === TOOLS.SPOTLIGHT ? "spotlight" : "laser" });
      }
      return;
    }
    machine.pointermove(event, point);
  };

  const onPointerUp = (event) => {
    if (drag && event.pointerId === drag.pointerId) {
      const after = store.getClone(drag.id);
      if (after && drag.before) {
        send("object_update", { annotation: after });
        history.push({ type: "update", annotation: after, before: drag.before, after });
      }
      drag = null;
      try {
        event.currentTarget?.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
      syncRender();
      return;
    }
    if (laserPointerId != null && event.pointerId === laserPointerId) {
      laserPointerId = null;
      try {
        event.currentTarget?.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }
    machine.pointerup(event, toNorm(event));
  };

  const onPointerCancel = (event) => {
    if (drag) {
      if (drag.before) store.update(drag.id, { points: drag.before.points });
      drag = null;
      syncRender();
    }
    machine.pointercancel(event);
  };
  const onLostCapture = (event) => machine.lostpointercapture(event);
  const onBlur = () => machine.blur();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") machine.blur();
  };

  const bindHost = (node) => {
    if (host === node) return;
    unbindHost();
    host = node;
    if (!host) return;
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerCancel);
    host.addEventListener("lostpointercapture", onLostCapture);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
  };

  const unbindHost = () => {
    if (!host) return;
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    host.removeEventListener("pointercancel", onPointerCancel);
    host.removeEventListener("lostpointercapture", onLostCapture);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    host = null;
  };

  const applyHistory = (entry, inverse) => {
    const item = inverse ? { ...entry, type: entry.type === "create" ? "delete" : entry.type === "delete" ? "create" : entry.type } : entry;
    if (item.type === "delete" || (inverse && entry.type === "create")) {
      const id = entry.annotation?.id;
      if (id) {
        store.remove(id);
        send("annotation_deleted", { id });
      }
    } else if (item.type === "create" || (inverse && entry.type === "delete")) {
      const ann = entry.annotation;
      if (ann?.id) {
        store.start({ ...ann, completed: true });
        send("object_upsert", { annotation: { ...ann, completed: true } });
      }
    } else if (entry.type === "update") {
      const ann = inverse ? entry.before : entry.after;
      if (ann?.id) {
        store.update(ann.id, ann);
        send("object_update", { annotation: ann });
      }
    } else if (entry.type === "clear") {
      if (inverse) {
        for (const ann of entry.annotations || []) {
          store.start({ ...ann, completed: true });
        }
        send("state_restore", { annotations: entry.annotations });
      }
    }
    syncRender();
  };

  return {
    store,
    machine,
    history,
    setCanAnnotate(value) {
      canAnnotate = Boolean(value);
      if (!canAnnotate) machine.disable();
    },
    setCanManage(value) {
      canManage = Boolean(value);
    },
    setIsPresenter(value) {
      isPresenter = Boolean(value);
    },
    setShowAuthorNames(value) {
      showAuthorNames = Boolean(value);
    },
    setPresenterUserId(value) {
      presenterUserId = value;
    },
    setTool(next) {
      if (tool !== next) machine.disable();
      tool = next;
      if (tool !== TOOLS.SELECT) selectedId = "";
      renderer?.setSelectedId(selectedId);
    },
    setColor(next) { color = next; },
    setWidth(next) { widthPx = Math.max(0.75, Number(next) || 2); },
    setOpacity(next) { opacity = Math.max(0.12, Math.min(0.8, Number(next) || HIGHLIGHTER_OPACITY_DEFAULT)); },
    setFontSize(next) { fontSize = Math.max(12, Math.min(48, Number(next) || 18)); },
    setFontWeight(next) { fontWeight = Number(next) || 650; },
    setStampKind(next) { stampKind = String(next || "star"); },
    setDrawingEnabled(value) {
      drawingEnabled = Boolean(value);
      if (!drawingEnabled) machine.disable();
    },
    setSourceWidth(w) {
      if (Number(w) > 0) sourceWidth = Number(w);
    },
    attachHost: bindHost,
    attachCanvas(node) {
      if (renderer) renderer.dispose();
      canvas = node;
      renderer = node ? createAnnotationRenderer(node) : null;
      syncRender();
    },
    attachViewportCanvas(node) {
      if (viewportRenderer) viewportRenderer.dispose();
      viewportCanvas = node;
      viewportRenderer = node ? createAnnotationRenderer(node) : null;
      if (viewportRenderer && typeof window !== "undefined") {
        const w = window.innerWidth;
        const h = window.innerHeight;
        viewportRenderer.setContentRect({ left: 0, top: 0, width: w, height: h });
        viewportRenderer.resize(w, h, window.devicePixelRatio || 1);
      }
      syncRender();
    },
    setPointerSpace(space) {
      pointerSpace = space === "viewport" ? "viewport" : "content";
    },
    setSessionId(next) {
      const value = String(next || "");
      if (value === boundSessionId) return;
      const prev = boundSessionId;
      boundSessionId = value;
      if (prev && value && prev !== value) {
        store.clearAll();
        remoteBuffer = new Map();
        localStroke = null;
        selectedId = "";
        history.clear();
        machine.disable();
        syncRender();
      }
    },
    getSessionId() {
      return boundSessionId;
    },
    setLayout(nextLayout, { cssWidth, cssHeight, dpr } = {}) {
      const geomChanged = Boolean(layout?.content)
        && Boolean(nextLayout?.content)
        && !rectsClose(layout.content, nextLayout.content, 1);
      if (geomChanged && machine.state === "DRAWING") {
        machine.disable();
        localStroke = null;
      }
      layout = nextLayout;
      if (nextLayout?.sourceRevision != null) {
        store.setSourceRevision(nextLayout.sourceRevision, { clear: false });
        machine.setSourceRevision(nextLayout.sourceRevision);
      }
      const dprValue = dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio : 1);
      if (renderer && nextLayout?.content) {
        renderer.setContentRect({
          left: 0,
          top: 0,
          width: nextLayout.content.width,
          height: nextLayout.content.height,
        });
        renderer.resize(
          cssWidth ?? nextLayout.content.width,
          cssHeight ?? nextLayout.content.height,
          dprValue,
        );
      }
      if (viewportRenderer && typeof window !== "undefined") {
        const w = window.innerWidth;
        const h = window.innerHeight;
        viewportRenderer.setContentRect({ left: 0, top: 0, width: w, height: h });
        viewportRenderer.resize(w, h, dprValue);
      }
      syncRender();
    },
    loadSnapshot(list, meta) {
      store.loadSnapshot(list, meta);
      localStroke = null;
      selectedId = "";
      remoteBuffer = new Map();
      history.clear();
      syncRender();
      annDebug("snapshot", { count: store.size(), revision: store.sourceRevision });
    },
    applyRemote(op) {
      if (!operationBelongsToSession(op, boundSessionId)) return;
      const action = op?.action || "";
      const payload = op?.payload || {};
      const rawAnn = payload.annotation || payload;
      const ann = rawAnn && typeof rawAnn === "object"
        ? { ...rawAnn, points: sanitizeNormalizedPoints(rawAnn.points) }
        : rawAnn;
      try {
        if (action === "stroke_start" || action === "object_upsert" || action === "arrow_set") {
          if (ann?.tool === TOOLS.ARROW_POINTER) {
            store.replaceAuthorTool(ann.authorId ?? op.author_id, TOOLS.ARROW_POINTER, ann);
          } else if (ann?.id) {
            store.start(ann);
            flushRemoteBuffer(ann.id);
          }
          if (ann?.tool === TOOLS.VANISHING) scheduleVanishCleanup();
        } else if (action === "stroke_update") {
          const id = ann?.id;
          if (!id) return;
          if (store.get(id)) {
            store.appendPoints(id, ann.points, { sequence: ann.sequence });
          } else {
            bufferRemotePoints(id, ann.points);
          }
        } else if (action === "stroke_end") {
          const id = ann?.id;
          if (!id) return;
          if (store.get(id)) {
            store.end(id, ann.points || []);
          } else {
            bufferRemotePoints(id, ann.points || [], { end: true });
          }
        } else if (action === "object_update") {
          if (ann?.id) store.update(ann.id, ann);
        } else if (action === "annotation_deleted" || action === "stroke_cancel") {
          store.remove(payload.id || ann.id);
          remoteBuffer.delete(String(payload.id || ann.id || ""));
          if (selectedId === (payload.id || ann.id)) selectedId = "";
        } else if (action === "clear_mine") {
          store.clearMine(op.author_id ?? op.authorId);
        } else if (action === "clear_viewers") {
          store.clearViewers(op.presenter_id ?? presenterUserId);
        } else if (action === "clear_all") {
          store.clearAll();
          remoteBuffer = new Map();
          selectedId = "";
        } else if (action === "state_restore") {
          for (const item of payload.annotations || []) store.start(item);
        }
      } catch (err) {
        annDebug("remote-error", { action, message: String(err?.message || err) });
      }
      syncRender();
    },
    setLasers(next) {
      lasers = next || [];
      syncRender();
    },
    commitText(point, text) {
      const value = String(text || "").trim();
      if (!value || !point) return false;
      const ann = {
        ...baseAnnotation(newAnnotationId(), TOOLS.TEXT, [point]),
        text: value.slice(0, 280),
        completed: true,
      };
      placeObject(ann);
      return true;
    },
    undo() {
      const entry = history.popUndo();
      if (!entry) return false;
      applyHistory(entry, true);
      return true;
    },
    redo() {
      const entry = history.popRedo();
      if (!entry) return false;
      applyHistory(entry, false);
      return true;
    },
    clearMine() {
      const removed = store.clearMine(authorId);
      syncRender();
      send("clear_mine", {});
      if (removed.length) history.push({ type: "clear", annotations: removed });
    },
    clearViewers() {
      store.clearViewers(presenterUserId ?? authorId);
      selectedId = "";
      syncRender();
      send("clear_viewers", {});
    },
    clearAll() {
      store.clearAll();
      selectedId = "";
      syncRender();
      send("clear_all", {});
    },
    getTool: () => tool,
    list: () => store.list(),
    dispose() {
      if (disposed) return;
      disposed = true;
      machine.dispose();
      unbindHost();
      renderer?.dispose();
      viewportRenderer?.dispose();
      renderer = null;
      viewportRenderer = null;
      canvas = null;
      viewportCanvas = null;
      if (flushTimer) window.clearTimeout(flushTimer);
      if (vanishTimer) window.clearTimeout(vanishTimer);
      pending = [];
      localStroke = null;
      lasers = [];
      nameLabels = [];
      remoteBuffer = new Map();
      annDebug("dispose");
    },
  };
}
