import { COORD_SPACE_CAPTURED_V1, pointerToNormalized, pxWidthToNormalized, viewportPointerToNormalized } from "./coordinateMapper";
import { rectsClose } from "../../screenshare/contentRect";
import { createPointerMachine } from "./pointerMachine";
import { createStrokeStore } from "./strokeStore";
import { createAnnotationRenderer } from "./renderer";
import { annDebug } from "./debug";
import { newAnnotationId, TOOLS } from "../../screenshare/constants";

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitTest(stroke, x, y, threshold = 0.02) {
  const pts = stroke?.points || [];
  if (stroke.tool === "text" && pts[0]) {
    return Math.abs(pts[0].x - x) < 0.08 && Math.abs(pts[0].y - y) < 0.05;
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
  if (!point) return null;
  return {
    x: point.x,
    y: point.y,
    t: Date.now(),
    pressure: Number(event?.pressure) || 0,
  };
}

const SHAPE_TOOLS = new Set(["line", "arrow", "rect", "ellipse"]);

export function createAnnotationEngine({
  authorId = null,
  displayName = "",
  sourceWidth = 1920,
  canAnnotate = false,
  canManage = false,
  onSend,
  onPointer,
} = {}) {
  const store = createStrokeStore();
  let renderer = null;
  let canvas = null;
  let host = null;
  let layout = null;
  let tool = TOOLS.PEN;
  let color = "#ef4444";
  let widthPx = 3;
  let drawingEnabled = false;
  let localStroke = null;
  let pending = [];
  let flushTimer = 0;
  let lasers = [];
  let disposed = false;
  let laserPointerId = null;
  let pointerSpace = "content";
  let viewportRenderer = null;
  let viewportCanvas = null;

  const syncRender = () => {
    const list = store.list();
    renderer?.setStrokes(list);
    renderer?.setLocalStroke(localStroke);
    renderer?.setLasers(lasers);
    viewportRenderer?.setStrokes(list);
    viewportRenderer?.setLocalStroke(localStroke);
    viewportRenderer?.setLasers(lasers);
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

  const machine = createPointerMachine({
    onStart: ({ strokeId, point, sourceRevision, sequence, pressure, timestamp }) => {
      const widthNormalized = pxWidthToNormalized(tool === TOOLS.HIGHLIGHTER ? widthPx * 3 : widthPx, sourceWidth);
      localStroke = {
        id: strokeId,
        tool,
        color,
        width: widthPx,
        widthNormalized,
        points: [point],
        authorId,
        displayName,
        coordSpace: COORD_SPACE_CAPTURED_V1,
        sourceRevision,
        sequence,
        pressure,
        createdAt: timestamp,
        completed: false,
      };
      store.start(localStroke);
      pending = [];
      syncRender();
      if (tool === TOOLS.PEN || tool === TOOLS.HIGHLIGHTER) {
        onSend?.("stroke_start", { annotation: { ...localStroke, points: [point] } });
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
      const batch = extras.length ? extras : (point ? [point] : []);
      if (!batch.length) return;
      if (SHAPE_TOOLS.has(localStroke.tool)) {
        localStroke.points = [localStroke.points[0], batch[batch.length - 1]];
        syncRender();
        return;
      }
      localStroke.points.push(...batch);
      localStroke.sequence = sequence;
      pending.push(...batch);
      syncRender();
      if (!flushTimer) {
        flushTimer = window.setTimeout(() => {
          flushTimer = 0;
          if (!pending.length || !localStroke) return;
          const points = pending.splice(0, 40);
          onSend?.("stroke_update", {
            annotation: {
              id: localStroke.id,
              tool: localStroke.tool,
              color: localStroke.color,
              width: localStroke.width,
              widthNormalized: localStroke.widthNormalized,
              points,
              coordSpace: COORD_SPACE_CAPTURED_V1,
              sourceRevision,
              sequence,
            },
          });
        }, 32);
      }
    },
    onEnd: ({ strokeId, point, sourceRevision }) => {
      if (flushTimer) {
        window.clearTimeout(flushTimer);
        flushTimer = 0;
      }
      if (!localStroke) return;
      if (point && localStroke.tool !== TOOLS.LASER) {
        const last = localStroke.points[localStroke.points.length - 1];
        if (!last || last.x !== point.x || last.y !== point.y) localStroke.points.push(point);
      }
      if (pending.length) {
        onSend?.("stroke_update", {
          annotation: {
            id: localStroke.id,
            points: pending.splice(0),
            coordSpace: COORD_SPACE_CAPTURED_V1,
            sourceRevision,
            sequence: localStroke.sequence,
          },
        });
      }
      if (SHAPE_TOOLS.has(localStroke.tool) && localStroke.points.length >= 2) {
        store.start({ ...localStroke, completed: true });
        onSend?.("object_upsert", { annotation: { ...localStroke, completed: true } });
      } else if (localStroke.tool === TOOLS.PEN || localStroke.tool === TOOLS.HIGHLIGHTER) {
        store.end(strokeId);
        onSend?.("stroke_end", { annotation: { id: strokeId, tool: localStroke.tool, points: [] } });
      }
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
      if (strokeId) onSend?.("stroke_cancel", { id: strokeId, annotation: { id: strokeId } });
      annDebug("stroke-cancel", { strokeId });
    },
  });

  const onPointerDown = (event) => {
    if (!drawingEnabled || !canAnnotate) return;
    if (event.isPrimary === false) return;
    const point = toNorm(event);
    if (!point) return;
    event.preventDefault();
    if (tool === TOOLS.ERASER) {
      const hit = [...store.list()].reverse().find((s) => {
        if (!canManage && authorId != null && Number(s.authorId) !== Number(authorId)) return false;
        return hitTest(s, point.x, point.y);
      });
      if (hit) {
        store.remove(hit.id);
        syncRender();
        onSend?.("annotation_deleted", { id: hit.id });
      }
      return;
    }
    if (tool === TOOLS.LASER) {
      try {
        event.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
      laserPointerId = event.pointerId;
      onPointer?.(point);
      return;
    }
    if (tool === TOOLS.POINTER) return;
    machine.pointerdown(event, point, { strokeId: newAnnotationId() });
  };

  const onPointerMove = (event) => {
    if (!drawingEnabled) return;
    const point = toNorm(event);
    if (tool === TOOLS.LASER) {
      if (laserPointerId != null && event.pointerId === laserPointerId && point) onPointer?.(point);
      return;
    }
    machine.pointermove(event, point);
  };

  const onPointerUp = (event) => {
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

  const onPointerCancel = (event) => machine.pointercancel(event);
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

  return {
    store,
    machine,
    setCanAnnotate(value) {
      canAnnotate = Boolean(value);
      if (!canAnnotate) machine.disable();
    },
    setCanManage(value) {
      canManage = Boolean(value);
    },
    setTool(next) {
      if (tool !== next) machine.disable();
      tool = next;
    },
    setColor(next) { color = next; },
    setWidth(next) { widthPx = Number(next) || 3; },
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
        const changed = store.setSourceRevision(nextLayout.sourceRevision);
        machine.setSourceRevision(nextLayout.sourceRevision);
        if (changed) {
          machine.disable();
          localStroke = null;
          annDebug("source-revision", { sourceRevision: nextLayout.sourceRevision });
        }
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
      syncRender();
      annDebug("snapshot", { count: store.size(), revision: store.sourceRevision });
    },
    applyRemote(op) {
      const action = op?.action || "";
      const payload = op?.payload || {};
      const ann = payload.annotation || payload;
      const packetRev = Number(ann?.sourceRevision);
      if (Number.isFinite(packetRev) && packetRev > 0) {
        store.setSourceRevision(packetRev);
        machine.setSourceRevision(packetRev);
      }
      if (action === "stroke_start" || action === "object_upsert") {
        if (ann?.id) store.start(ann);
      } else if (action === "stroke_update") {
        store.appendPoints(ann.id, ann.points, {
          sequence: ann.sequence,
          sourceRevision: ann.sourceRevision,
        });
      } else if (action === "stroke_end") {
        store.end(ann.id, ann.points || []);
      } else if (action === "annotation_deleted" || action === "stroke_cancel") {
        store.remove(payload.id || ann.id);
      } else if (action === "clear_mine") {
        store.clearMine(op.author_id ?? op.authorId);
      } else if (action === "clear_all") {
        store.clearAll();
      }
      syncRender();
    },
    setLasers(next) {
      lasers = next || [];
      syncRender();
    },
    undo() {
      const id = store.lastOwnId(authorId);
      if (!id) return false;
      store.remove(id);
      syncRender();
      onSend?.("annotation_deleted", { id });
      return true;
    },
    clearMine() {
      store.clearMine(authorId);
      syncRender();
      onSend?.("clear_mine", {});
    },
    clearAll() {
      store.clearAll();
      syncRender();
      onSend?.("clear_all", {});
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
      pending = [];
      localStroke = null;
      lasers = [];
      annDebug("dispose");
    },
  };
}
