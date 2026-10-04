import { useEffect, useRef, useState } from "react";
import {
  annotationBounds,
  clientToPage,
  constrainBox,
  constrainLine,
  handleAtPoint,
  hitRotateHandle,
  hitTest,
  isStylusPointer,
  moveObject,
  pointerEventSamples,
  pointerPressure,
  rectsIntersect,
  scaleAnnotation,
  smoothStroke,
} from "./notebookGeometry";
import { TOOL } from "./notebookModel";
import { drawNotebookScene } from "./notebookRender";

function cursorForTool(tool, { grabbing, spacePan, editingText } = {}) {
  if (editingText) return "text";
  if (grabbing) return "grabbing";
  if (spacePan || tool === TOOL.HAND) return "grab";
  if (tool === TOOL.TEXT) return "text";
  if (tool === TOOL.SELECT) return "default";
  if (tool === TOOL.ERASER) return "cell";
  return "crosshair";
}

function pressureOf(event, fallback = 0.5) {
  return pointerPressure(event, fallback);
}

function textEditorStyle(editor, pageWidth, pageHeight) {
  const width = pageWidth || 1000;
  const height = pageHeight || 1414;
  const fontSize = editor.fontSize || 24;
  const lines = Math.max(1, String(editor.text || "").split("\n").length);
  const boxPct = Math.max(8, ((editor.w || 180) / width) * 100);
  const roomPct = Math.max(8, ((width - (editor.x || 0)) / width) * 100);
  return {
    left: `${((editor.x || 0) / width) * 100}%`,
    top: `${(((editor.y || 0) - fontSize) / height) * 100}%`,
    width: `${Math.min(boxPct, roomPct)}%`,
    height: `${((lines * fontSize * 1.35) / height) * 100}%`,
    fontSize: `calc(${(fontSize / width) * 100}cqi)`,
    color: editor.stroke || editor.color || "#111827",
  };
}

function pagePointFromEvent(event, canvas, page, { clamp = true } = {}) {
  return {
    ...clientToPage(event, canvas, page, { clamp }),
    pressure: pressureOf(event),
  };
}

function maybePushPoint(points, point, minDistance = 0.35) {
  const last = points[points.length - 1];
  if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) {
    points.push(point);
    return true;
  }
  last.x = point.x;
  last.y = point.y;
  last.pressure = point.pressure ?? last.pressure;
  return false;
}

export default function NotebookCanvas({
  page,
  objects,
  tool,
  color,
  strokeWidth,
  opacity,
  fontSize,
  smoothing = 1,
  eraserMode = "stroke",
  selectedIds,
  onSelectIds,
  onObjectsCommit,
  spacePan = false,
  readOnly = false,
  editingText,
  onEditingText,
  onPanDelta,
}) {
  const canvasRef = useRef(null);
  const objectsRef = useRef(objects || []);
  const selectedRef = useRef(selectedIds || []);
  const toolRef = useRef(tool);
  const sessionRef = useRef(null);
  const draftRef = useRef(null);
  const marqueeRef = useRef(null);
  const rafRef = useRef(0);
  const fallbackRef = useRef(0);
  const textDraftRef = useRef(null);
  const editingTextRef = useRef(editingText);
  const ignoreBlurRef = useRef(false);
  const [textDraft, setTextDraft] = useState(null);
  editingTextRef.current = editingText;
  textDraftRef.current = textDraft;

  objectsRef.current = sessionRef.current ? objectsRef.current : (objects || []);
  selectedRef.current = selectedIds || [];
  toolRef.current = tool;

  const paint = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (fallbackRef.current) {
      clearTimeout(fallbackRef.current);
      fallbackRef.current = 0;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawNotebookScene(ctx, objectsRef.current, {
      selectedIds: selectedRef.current,
      pageWidth: page?.width || 1000,
      pageHeight: page?.height || 1414,
      draft: draftRef.current,
      marquee: marqueeRef.current,
      hideTextId: textDraftRef.current?.id || editingTextRef.current?.id || null,
    });
  };

  const schedulePaint = () => {
    if (rafRef.current || fallbackRef.current) return;
    rafRef.current = requestAnimationFrame(paint);
    // Some embedded browsers never run the frame; a short timeout still shows the stroke.
    fallbackRef.current = window.setTimeout(paint, 32);
  };

  const capturePointer = (event) => {
    try {
      canvasRef.current?.setPointerCapture?.(event.pointerId);
    } catch {
      /* The pointer can already be inactive; drawing should continue. */
    }
  };

  useEffect(() => {
    schedulePaint();
  }, [objects, selectedIds, page, textDraft, editingText]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const block = (event) => {
      if (event.pointerType === "pen" || event.pointerType === "touch") event.preventDefault();
    };
    const blockTouch = (event) => event.preventDefault();
    canvas.addEventListener("pointerdown", block, { passive: false });
    canvas.addEventListener("pointermove", block, { passive: false });
    canvas.addEventListener("touchstart", blockTouch, { passive: false });
    canvas.addEventListener("touchmove", blockTouch, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", block);
      canvas.removeEventListener("pointermove", block);
      canvas.removeEventListener("touchstart", blockTouch);
      canvas.removeEventListener("touchmove", blockTouch);
    };
  }, [page]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
    rafRef.current = 0;
    fallbackRef.current = 0;
  }, []);

  const commitObjects = (next, historyType) => {
    onObjectsCommit?.(next, historyType);
  };

  const rememberDraft = (next, { fresh = false } = {}) => {
    if (fresh) {
      ignoreBlurRef.current = true;
      window.setTimeout(() => {
        ignoreBlurRef.current = false;
      }, 0);
    }
    textDraftRef.current = next;
    setTextDraft(next);
    onEditingText?.(next);
  };

  const finishText = (keep) => {
    const current = textDraftRef.current || editingTextRef.current;
    if (!current) return;
    textDraftRef.current = null;
    editingTextRef.current = null;
    const value = keep ? String(current.text || "").trimEnd() : "";
    const existed = objectsRef.current.some((obj) => obj.id === current.id);
    const next = objectsRef.current.filter((obj) => obj.id !== current.id);
    if (value) {
      const stored = { ...current, text: value, updatedAt: new Date().toISOString() };
      delete stored._created;
      next.push(stored);
    }
    objectsRef.current = next;
    setTextDraft(null);
    onEditingText?.(null);
    paint();
    if (value || existed) commitObjects(next, current._created ? "ADD_ANNOTATION" : "UPDATE_ANNOTATION");
  };

  const pointerDown = (event) => {
    if (event.button === 2) return;
    const session = sessionRef.current;
    if (session?.pointerType === "pen" && event.pointerType === "touch") return;
    const canvas = canvasRef.current;
    const stylus = isStylusPointer(event);
    if (stylus || event.pointerType === "touch") event.preventDefault();
    const point = pagePointFromEvent(event, canvas, page, { clamp: !stylus });
    const currentTool = spacePan || event.button === 1 ? TOOL.HAND : toolRef.current;
    if ((textDraftRef.current || editingTextRef.current) && currentTool !== TOOL.TEXT) finishText(true);

    if (currentTool === TOOL.HAND || event.button === 1) {
      sessionRef.current = {
        mode: "pan",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        lastClient: { x: event.clientX, y: event.clientY },
      };
      capturePointer(event);
      return;
    }
    if (readOnly) return;

    if (currentTool === TOOL.TEXT) {
      if (textDraftRef.current || editingTextRef.current) finishText(true);
      const hit = [...objectsRef.current].reverse().find((obj) => obj.type === "text" && hitTest(obj, point));
      if (hit) {
        rememberDraft({ ...hit, _created: false }, { fresh: true });
        onSelectIds?.([hit.id]);
        return;
      }
      const created = {
        id: crypto.randomUUID?.() || `text-${Date.now()}`,
        type: "text",
        pageId: page.id,
        x: point.x,
        y: point.y,
        w: 180,
        text: "",
        stroke: color,
        color,
        fontSize,
        opacity: 1,
        strokeWidth: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _created: true,
      };
      rememberDraft(created, { fresh: true });
      onSelectIds?.([created.id]);
      return;
    }

    capturePointer(event);

    if (currentTool === TOOL.SELECT) {
      const selected = selectedRef.current;
      const currentObjects = objectsRef.current;
      if (selected.length === 1) {
        const obj = currentObjects.find((item) => item.id === selected[0]);
        if (obj) {
          const box = annotationBounds(obj);
          if ((obj.type === "rect" || obj.type === "ellipse" || obj.type === "text") && hitRotateHandle(box, point)) {
            sessionRef.current = {
              mode: "rotate",
              pointerId: event.pointerId,
              origin: currentObjects,
              id: obj.id,
              center: { x: box.x + box.w / 2, y: box.y + box.h / 2 },
              startAngle: Math.atan2(point.y - (box.y + box.h / 2), point.x - (box.x + box.w / 2)),
              startRotation: obj.rotation || 0,
            };
            return;
          }
          const handle = handleAtPoint({ x: box.x - 6, y: box.y - 6, w: box.w + 12, h: box.h + 12 }, point, 12);
          if (handle) {
            sessionRef.current = {
              mode: "resize",
              pointerId: event.pointerId,
              origin: currentObjects,
              id: obj.id,
              handle,
              shift: event.shiftKey,
            };
            return;
          }
        }
      }
      const hit = [...currentObjects].reverse().find((obj) => hitTest(obj, point));
      let nextSelected = selected;
      if (hit) {
        if (event.shiftKey) {
          nextSelected = selected.includes(hit.id)
            ? selected.filter((id) => id !== hit.id)
            : [...selected, hit.id];
        } else if (!selected.includes(hit.id)) {
          nextSelected = [hit.id];
        }
        onSelectIds?.(nextSelected);
        sessionRef.current = {
          mode: event.altKey ? "duplicate-drag" : "move",
          pointerId: event.pointerId,
          origin: currentObjects,
          ids: nextSelected.length ? nextSelected : [hit.id],
          startPoint: point,
          duplicated: false,
        };
      } else {
        if (!event.shiftKey) onSelectIds?.([]);
        sessionRef.current = {
          mode: "marquee",
          pointerId: event.pointerId,
          start: point,
          additive: event.shiftKey,
        };
        marqueeRef.current = { x: point.x, y: point.y, w: 0, h: 0 };
        schedulePaint();
      }
      return;
    }

    if (currentTool === TOOL.ERASER) {
      const pad = eraserMode === "object" ? 18 : 14;
      const hit = [...objectsRef.current].reverse().find((obj) => hitTest(obj, point, pad));
      const removed = new Set();
      if (hit) {
        removed.add(hit.id);
        objectsRef.current = objectsRef.current.filter((obj) => obj.id !== hit.id);
        onSelectIds?.([]);
        schedulePaint();
      }
      sessionRef.current = { mode: "erase", pointerId: event.pointerId, pointerType: event.pointerType, removed };
      return;
    }

    if (event.pointerType === "touch" && !stylus && [TOOL.PEN, TOOL.MARKER, TOOL.LINE, TOOL.ARROW, TOOL.RECT, TOOL.ELLIPSE].includes(currentTool)) {
      sessionRef.current = {
        mode: "pan",
        pointerId: event.pointerId,
        pointerType: "touch",
        lastClient: { x: event.clientX, y: event.clientY },
      };
      return;
    }

    const start = { ...point, pressure: pressureOf(event) };
    sessionRef.current = {
      mode: "draw",
      tool: currentTool,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      start,
      points: [start],
      shift: event.shiftKey,
      alt: event.altKey,
    };
    if (currentTool === TOOL.PEN || currentTool === TOOL.MARKER) {
      draftRef.current = {
        id: "draft",
        type: currentTool,
        points: [start],
        stroke: color,
        color,
        strokeWidth,
        width: strokeWidth,
        opacity: currentTool === TOOL.MARKER ? (opacity ?? 0.28) : 1,
      };
      paint();
    }
  };

  const pointerMove = (event) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.pointerType === "pen" || event.pointerType === "touch") event.preventDefault();
    const canvas = canvasRef.current;
    const stylus = session.pointerType === "pen" || isStylusPointer(event);
    const samples = session.mode === "draw" && (session.tool === TOOL.PEN || session.tool === TOOL.MARKER)
      ? pointerEventSamples(event)
      : [event];
    const point = pagePointFromEvent(samples[samples.length - 1] || event, canvas, page, { clamp: !stylus });
    if (session.mode === "pan") {
      onPanDelta?.({
        dx: event.clientX - session.lastClient.x,
        dy: event.clientY - session.lastClient.y,
      });
      session.lastClient = { x: event.clientX, y: event.clientY };
      return;
    }
    if (session.mode === "erase") {
      const hit = [...objectsRef.current].reverse().find((obj) => hitTest(obj, point, 14));
      if (hit && !session.removed?.has(hit.id)) {
        session.removed = session.removed || new Set();
        session.removed.add(hit.id);
        objectsRef.current = objectsRef.current.filter((obj) => obj.id !== hit.id);
        schedulePaint();
      }
      return;
    }
    if (session.mode === "move" || session.mode === "duplicate-drag") {
      let origin = session.origin;
      if (session.mode === "duplicate-drag" && !session.duplicated) {
        const clones = origin.filter((obj) => session.ids.includes(obj.id)).map((obj) => ({
          ...JSON.parse(JSON.stringify(obj)),
          id: crypto.randomUUID?.() || `dup-${Date.now()}-${Math.random()}`,
        }));
        origin = [...origin, ...clones];
        session.ids = clones.map((obj) => obj.id);
        session.duplicated = true;
        session.origin = origin;
        onSelectIds?.(session.ids);
      }
      const dx = point.x - session.startPoint.x;
      const dy = point.y - session.startPoint.y;
      objectsRef.current = origin.map((obj) => (
        session.ids.includes(obj.id) ? moveObject(obj, dx, dy) : obj
      ));
      schedulePaint();
      return;
    }
    if (session.mode === "resize") {
      const originObj = session.origin.find((obj) => obj.id === session.id);
      objectsRef.current = session.origin.map((obj) => (
        obj.id === session.id ? scaleAnnotation(originObj, session.handle, point, { shift: event.shiftKey || session.shift }) : obj
      ));
      schedulePaint();
      return;
    }
    if (session.mode === "rotate") {
      const angle = Math.atan2(point.y - session.center.y, point.x - session.center.x);
      const degrees = ((angle - session.startAngle) * 180) / Math.PI;
      objectsRef.current = session.origin.map((obj) => (
        obj.id === session.id ? { ...obj, rotation: session.startRotation + degrees } : obj
      ));
      schedulePaint();
      return;
    }
    if (session.mode === "marquee") {
      marqueeRef.current = {
        x: Math.min(session.start.x, point.x),
        y: Math.min(session.start.y, point.y),
        w: Math.abs(point.x - session.start.x),
        h: Math.abs(point.y - session.start.y),
      };
      schedulePaint();
      return;
    }
    if (session.mode === "draw") {
      session.shift = event.shiftKey;
      session.alt = event.altKey;
      if (session.tool === TOOL.PEN || session.tool === TOOL.MARKER) {
        const minDistance = session.pointerType === "pen" ? 0.22 : 0.7;
        samples.forEach((sample) => {
          const live = pagePointFromEvent(sample, canvas, page, { clamp: session.pointerType !== "pen" });
          live.pressure = pressureOf(sample, session.points[session.points.length - 1]?.pressure ?? 0.5);
          maybePushPoint(session.points, live, minDistance);
        });
        draftRef.current = {
          id: "draft",
          type: session.tool,
          points: session.points,
          stroke: color,
          color,
          strokeWidth,
          width: strokeWidth,
          opacity: session.tool === TOOL.MARKER ? (opacity ?? 0.28) : 1,
        };
      } else if (session.tool === TOOL.LINE || session.tool === TOOL.ARROW) {
        const end = constrainLine(session.start, point, session.shift);
        draftRef.current = {
          id: "draft",
          type: session.tool,
          x1: session.start.x,
          y1: session.start.y,
          x2: end.x,
          y2: end.y,
          stroke: color,
          color,
          strokeWidth,
          width: strokeWidth,
        };
      } else if (session.tool === TOOL.RECT || session.tool === TOOL.ELLIPSE) {
        const box = constrainBox(session.start, point, { shift: session.shift, alt: session.alt });
        draftRef.current = session.tool === TOOL.RECT
          ? {
            id: "draft",
            type: "rect",
            x: box.w < 0 ? box.x + box.w : box.x,
            y: box.h < 0 ? box.y + box.h : box.y,
            w: Math.abs(box.w),
            h: Math.abs(box.h),
            stroke: color,
            color,
            strokeWidth,
            width: strokeWidth,
          }
          : {
            id: "draft",
            type: "ellipse",
            cx: box.x + box.w / 2,
            cy: box.y + box.h / 2,
            rx: Math.abs(box.w) / 2,
            ry: Math.abs(box.h) / 2,
            stroke: color,
            color,
            strokeWidth,
            width: strokeWidth,
          };
      }
      paint();
    }
  };

  const pointerUp = (event) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    sessionRef.current = null;
    const canvas = canvasRef.current;
    const point = clientToPage(event, canvas, page);
    if (session.mode === "pan") return;
    if (session.mode === "erase") {
      if (session.removed?.size) commitObjects(objectsRef.current, "DELETE_ANNOTATION");
      return;
    }
    if (session.mode === "move" || session.mode === "duplicate-drag" || session.mode === "resize" || session.mode === "rotate") {
      commitObjects(objectsRef.current, session.mode === "resize" ? "RESIZE_ANNOTATION" : "MOVE_ANNOTATIONS");
      draftRef.current = null;
      schedulePaint();
      return;
    }
    if (session.mode === "marquee") {
      const box = marqueeRef.current;
      marqueeRef.current = null;
      if (box && box.w > 3 && box.h > 3) {
        const hits = objectsRef.current.filter((obj) => rectsIntersect(annotationBounds(obj), box)).map((obj) => obj.id);
        onSelectIds?.(session.additive ? [...new Set([...(selectedRef.current || []), ...hits])] : hits);
      }
      schedulePaint();
      return;
    }
    if (session.mode !== "draw") return;
    let created = null;
    const id = crypto.randomUUID?.() || `ann-${Date.now()}`;
    if (session.tool === TOOL.PEN || session.tool === TOOL.MARKER) {
      const last = pagePointFromEvent(event, canvas, page, { clamp: session.pointerType !== "pen" });
      last.pressure = pressureOf(event, session.points[session.points.length - 1]?.pressure ?? 0.5);
      maybePushPoint(session.points, last, session.pointerType === "pen" ? 0.18 : 0.7);
      const refine = session.pointerType === "pen" ? 0 : Math.max(0, Number(smoothing) || 0);
      const points = refine ? smoothStroke(session.points, refine) : session.points;
      if (points.length < 2) {
        draftRef.current = null;
        schedulePaint();
        return;
      }
      created = {
        id,
        type: session.tool,
        pageId: page.id,
        points,
        stroke: color,
        color,
        strokeWidth,
        width: strokeWidth,
        opacity: session.tool === TOOL.MARKER ? (opacity ?? 0.28) : 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else if (session.tool === TOOL.LINE || session.tool === TOOL.ARROW) {
      const end = constrainLine(session.start, point, session.shift);
      created = {
        id,
        type: session.tool,
        pageId: page.id,
        x1: session.start.x,
        y1: session.start.y,
        x2: end.x,
        y2: end.y,
        stroke: color,
        color,
        strokeWidth,
        width: strokeWidth,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else if (session.tool === TOOL.RECT || session.tool === TOOL.ELLIPSE) {
      created = { ...draftRef.current, id, pageId: page.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (!created || Math.abs(created.w || created.rx || 0) < 2) created = null;
    }
    draftRef.current = null;
    if (created) {
      objectsRef.current = [...objectsRef.current, created];
      paint();
      commitObjects(objectsRef.current, "ADD_ANNOTATION");
    } else schedulePaint();
  };

  const onDoubleClick = (event) => {
    if (readOnly) return;
    const point = clientToPage(event, canvasRef.current, page);
    const hit = [...objectsRef.current].reverse().find((obj) => obj.type === "text" && hitTest(obj, point));
    if (hit) {
      rememberDraft({ ...hit, _created: false });
      onSelectIds?.([hit.id]);
    }
  };

  const grabbing = sessionRef.current?.mode === "pan" || sessionRef.current?.mode === "move";
  const width = page?.width || 1000;
  const height = page?.height || 1414;
  const editor = textDraft || editingText;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="hw-notebook-canvas"
        width={width}
        height={height}
        style={{ cursor: cursorForTool(tool, { grabbing, spacePan, editingText: editor }), touchAction: "none" }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
      />
      {editor ? (
        <textarea
          className="hw-notebook-text-editor"
          autoFocus
          value={editor.text || ""}
          style={textEditorStyle(editor, width, height)}
          onChange={(event) => {
            const next = { ...editor, text: event.target.value, w: Math.max(80, event.target.value.length * (editor.fontSize || 24) * 0.56) };
            rememberDraft(next);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              textDraftRef.current = null;
              editingTextRef.current = null;
              setTextDraft(null);
              onEditingText?.(null);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.stopPropagation();
              finishText(true);
            }
          }}
          onBlur={() => {
            if (ignoreBlurRef.current) return;
            const open = textDraftRef.current || editingTextRef.current;
            if (open && open.id !== editor.id) return;
            finishText(true);
          }}
        />
      ) : null}
    </>
  );
}
