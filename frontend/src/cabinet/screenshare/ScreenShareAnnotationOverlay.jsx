import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import AnnotationToolbar from "../annotations/AnnotationToolbar";
import { useAnnotationSession } from "../annotations/AnnotationContext";
import { useElementClientRect } from "../annotations/useElementClientRect";
import {
  appendStrokePoint,
  createStroke,
  isMatchingActivePointer,
  isStrokePointerHeld,
  shouldIgnorePointerDown,
} from "../annotations/pointerStroke";
import {
  DRAWING_TOOLS,
  LASER_TTL_MS,
  MAX_POINTS_PER_BATCH,
  MAX_TEXT_LEN,
  PALETTE,
  POINTER_THROTTLE_MS,
  STROKE_FLUSH_MS,
  TOOLS,
  newAnnotationId,
  participantColor,
} from "./constants";
import {
  findAnnotationAt,
  lastOwnAnnotationId,
} from "./annotationModel";
import {
  COORD_SPACE,
  computeScreenShareContentRect,
  normalizedToVisible,
  pointerToNormalized,
  strokeWidthPx,
} from "./contentRect";

function pointsToPath(points, contentRect, visibleRect) {
  if (!points?.length) return "";
  const parts = [];
  for (let index = 0; index < points.length; index += 1) {
    const pt = points[index];
    const p = normalizedToVisible(pt.x, pt.y, contentRect, visibleRect);
    if (!p) continue;
    parts.push(`${index === 0 || parts.length === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  }
  return parts.join(" ");
}

function arrowHead(points, contentRect, visibleRect) {
  if (!points || points.length < 2) return null;
  const a = normalizedToVisible(points[points.length - 2].x, points[points.length - 2].y, contentRect, visibleRect);
  const b = normalizedToVisible(points[points.length - 1].x, points[points.length - 1].y, contentRect, visibleRect);
  if (!a || !b) return null;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const len = 12;
  return [
    b,
    {
      x: b.x - len * Math.cos(angle - 0.4),
      y: b.y - len * Math.sin(angle - 0.4),
    },
    {
      x: b.x - len * Math.cos(angle + 0.4),
      y: b.y - len * Math.sin(angle + 0.4),
    },
  ];
}

function AnnotationShape({ ann, contentRect, visibleRect }) {
  const pts = ann.points || [];
  const color = ann.color || "#ef4444";
  const sw = strokeWidthPx(ann.width || 3, visibleRect?.width || contentRect?.width);
  const tool = ann.tool || "pen";
  if (tool === "text" && pts[0]) {
    const p = normalizedToVisible(pts[0].x, pts[0].y, contentRect, visibleRect);
    if (!p) return null;
    return (
      <text
        x={p.x}
        y={p.y}
        fill={color}
        fontSize={Math.max(14, sw * 4)}
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="650"
        style={{ paintOrder: "stroke", stroke: "rgba(15,23,42,0.55)", strokeWidth: 3 }}
      >
        {String(ann.text || "")}
      </text>
    );
  }
  if ((tool === "rect" || tool === "ellipse") && pts.length >= 2) {
    const a = normalizedToVisible(pts[0].x, pts[0].y, contentRect, visibleRect);
    const b = normalizedToVisible(pts[1].x, pts[1].y, contentRect, visibleRect);
    if (!a || !b) return null;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (tool === "ellipse") {
      return (
        <ellipse
          cx={x + w / 2}
          cy={y + h / 2}
          rx={w / 2}
          ry={h / 2}
          fill="none"
          stroke={color}
          strokeWidth={sw}
        />
      );
    }
    return <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth={sw} />;
  }
  if (tool === "line" && pts.length >= 2) {
    const a = normalizedToVisible(pts[0].x, pts[0].y, contentRect, visibleRect);
    const b = normalizedToVisible(pts[pts.length - 1].x, pts[pts.length - 1].y, contentRect, visibleRect);
    if (!a || !b) return null;
    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={sw} />;
  }
  if (tool === "arrow" && pts.length >= 2) {
    const a = normalizedToVisible(pts[0].x, pts[0].y, contentRect, visibleRect);
    const b = normalizedToVisible(pts[pts.length - 1].x, pts[pts.length - 1].y, contentRect, visibleRect);
    const head = arrowHead([pts[0], pts[pts.length - 1]], contentRect, visibleRect);
    if (!a || !b || !head) return null;
    return (
      <g>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={sw} />
        <polygon points={head.map((p) => `${p.x},${p.y}`).join(" ")} fill={color} />
      </g>
    );
  }
  const d = pointsToPath(pts, contentRect, visibleRect);
  if (!d) return null;
  const highlighter = tool === "highlighter" || tool === "marker";
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={highlighter ? sw * 2.4 : sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={highlighter ? 0.38 : 1}
    />
  );
}

export default function ScreenShareAnnotationOverlay({
  active = false,
  compact = false,
  canManage = false,
  canAnnotate = false,
  participantsCanAnnotate = true,
  currentUserId = null,
  displayName = "",
  sessionId = "",
  contentWidth = 0,
  contentHeight = 0,
  annotations = [],
  remoteLasers = {},
  tileView = false,
  objectFit = "contain",
  targetRef = null,
  showToolbar = true,
  onReportLayout,
  onStrokeStart,
  onStrokeUpdate,
  onStrokeEnd,
  onObjectUpsert,
  onPointer,
  onErase,
  onUndo,
  onRedo,
  onClearMine,
  onClearAll,
  onSetParticipantsCanAnnotate,
}) {
  const session = useAnnotationSession();
  const hostFallbackRef = useRef(null);
  const geometryTarget = targetRef || hostFallbackRef;
  const hostBox = useElementClientRect(geometryTarget, {
    enabled: active,
    live: active,
  });

  const [localTool, setLocalTool] = useState(TOOLS.POINTER);
  const [localColor, setLocalColor] = useState(() => participantColor(currentUserId));
  const [localWidth, setLocalWidth] = useState(3);
  const [localStroke, setLocalStroke] = useState(null);
  const [textDraft, setTextDraft] = useState(null);
  const [redoStack, setRedoStack] = useState([]);
  const drawingRef = useRef(null);
  const activePointerRef = useRef(null);
  const pendingPointsRef = useRef([]);
  const flushTimerRef = useRef(null);
  const pointerThrottleRef = useRef(0);
  const rafRef = useRef(0);
  const captureNodeRef = useRef(null);

  const tool = session?.tool ?? localTool;
  const color = session?.color ?? localColor;
  const width = session?.width ?? localWidth;
  const setTool = session?.setTool ?? setLocalTool;
  const setColor = session?.setColor ?? setLocalColor;
  const setWidth = session?.setWidth ?? setLocalWidth;
  const panelOpen = session ? session.enabled && session.target === "screenshare" : tool !== TOOLS.POINTER;

  useEffect(() => {
    if (!session) {
      setLocalColor((prev) => (PALETTE.includes(prev) ? prev : participantColor(currentUserId)));
    }
  }, [currentUserId, session]);

  useEffect(() => {
    if (!active) {
      drawingRef.current = null;
      activePointerRef.current = null;
      setLocalStroke(null);
      setTextDraft(null);
    }
  }, [active]);

  const layout = useMemo(
    () => computeScreenShareContentRect({
      hostRect: hostBox,
      contentWidth,
      contentHeight,
      compact,
      tileView,
      objectFit,
    }),
    [hostBox, contentWidth, contentHeight, compact, tileView, objectFit],
  );

  useEffect(() => {
    if (!active || !layout?.visible?.width) return;
    onReportLayout?.(layout);
  }, [active, layout, onReportLayout]);

  const capturing = Boolean(
    active && panelOpen && DRAWING_TOOLS.has(tool) && canAnnotate && !tileView,
  );
  const contentRect = layout.content;
  const visibleRect = layout.visible;

  const bumpLocalStroke = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0;
      const drawing = drawingRef.current;
      if (!drawing || drawing.tool === TOOLS.LASER) return;
      setLocalStroke({ ...drawing, points: [...drawing.points] });
    });
  }, []);

  const flushPoints = useCallback((end = false) => {
    const drawing = drawingRef.current;
    if (!drawing || !pendingPointsRef.current.length) {
      if (end && drawing) onStrokeEnd?.(drawing);
      return;
    }
    const batch = pendingPointsRef.current.splice(0, MAX_POINTS_PER_BATCH);
    onStrokeUpdate?.({
      ...drawing,
      points: batch,
      coordSpace: COORD_SPACE,
    });
    if (pendingPointsRef.current.length) {
      flushTimerRef.current = window.setTimeout(() => flushPoints(end), STROKE_FLUSH_MS);
      return;
    }
    flushTimerRef.current = null;
    if (end) onStrokeEnd?.(drawing);
  }, [onStrokeEnd, onStrokeUpdate]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = window.setTimeout(() => flushPoints(false), STROKE_FLUSH_MS);
  }, [flushPoints]);

  const toNorm = useCallback((event) => {
    if (!layout?.content?.width) return null;
    return pointerToNormalized(event.clientX, event.clientY, layout);
  }, [layout]);

  const finishShape = useCallback(() => {
    const drawing = drawingRef.current;
    activePointerRef.current = null;
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    drawingRef.current = null;
    if (!drawing) {
      setLocalStroke(null);
      return;
    }
    if (drawing.tool === TOOLS.LASER) {
      setLocalStroke(null);
      return;
    }
    if (drawing.tool === TOOLS.PEN || drawing.tool === TOOLS.HIGHLIGHTER) {
      if (pendingPointsRef.current.length) flushPoints(true);
      else onStrokeEnd?.(drawing);
    } else if (drawing.points?.length >= 2) {
      onObjectUpsert?.({ ...drawing, completed: true, coordSpace: COORD_SPACE });
    }
    setLocalStroke(null);
    setRedoStack([]);
  }, [flushPoints, onObjectUpsert, onStrokeEnd]);

  const releaseCapture = useCallback((event) => {
    const node = event?.currentTarget || captureNodeRef.current;
    if (!node || event?.pointerId == null) return;
    try {
      node.releasePointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onPointerDown = useCallback((event) => {
    if (!capturing) return;
    if (shouldIgnorePointerDown(event)) return;
    if (activePointerRef.current != null) return;
    const point = toNorm(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    captureNodeRef.current = event.currentTarget;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
    activePointerRef.current = event.pointerId;
    if (tool === TOOLS.TEXT) {
      setTextDraft({
        x: point.x,
        y: point.y,
        overlay: normalizedToVisible(point.x, point.y, contentRect, visibleRect),
        value: "",
      });
      activePointerRef.current = null;
      releaseCapture(event);
      return;
    }
    if (tool === TOOLS.ERASER) {
      const hit = findAnnotationAt(
        new Map(annotations.map((a) => [a.id, a])),
        point.x,
        point.y,
      );
      if (hit) onErase?.(hit);
      activePointerRef.current = null;
      releaseCapture(event);
      return;
    }
    if (tool === TOOLS.LASER) {
      onPointer?.(point);
      drawingRef.current = { id: `laser-${event.pointerId}`, tool: TOOLS.LASER };
      return;
    }
    if (!canAnnotate) {
      activePointerRef.current = null;
      releaseCapture(event);
      return;
    }
    const stroke = createStroke({
      id: newAnnotationId(),
      tool,
      color,
      width,
      point,
      authorId: currentUserId,
      displayName,
      coordSpace: COORD_SPACE,
    });
    drawingRef.current = stroke;
    pendingPointsRef.current = [];
    setLocalStroke({ ...stroke, points: [...stroke.points] });
    if (tool === TOOLS.PEN || tool === TOOLS.HIGHLIGHTER) {
      onStrokeStart?.(stroke);
    }
  }, [
    annotations,
    canAnnotate,
    capturing,
    color,
    contentRect,
    currentUserId,
    displayName,
    onErase,
    onPointer,
    onStrokeStart,
    releaseCapture,
    toNorm,
    tool,
    visibleRect,
    width,
  ]);

  const onPointerMove = useCallback((event) => {
    if (!capturing) return;
    if (!isMatchingActivePointer(event, activePointerRef.current)) return;
    if ((event.pointerType === "mouse" || event.pointerType === "pen") && !isStrokePointerHeld(event, activePointerRef.current)) {
      finishShape();
      releaseCapture(event);
      return;
    }
    const point = toNorm(event);
    if (!point) return;
    if (tool === TOOLS.LASER && drawingRef.current?.tool === TOOLS.LASER) {
      const now = Date.now();
      if (now - pointerThrottleRef.current >= POINTER_THROTTLE_MS) {
        pointerThrottleRef.current = now;
        onPointer?.(point);
      }
      return;
    }
    const drawing = drawingRef.current;
    if (!drawing || drawing.tool === TOOLS.LASER) return;
    if (drawing.id && event.pointerId !== activePointerRef.current) return;
    if (tool === TOOLS.PEN || tool === TOOLS.HIGHLIGHTER) {
      appendStrokePoint(drawing, point);
      pendingPointsRef.current.push(point);
      bumpLocalStroke();
      scheduleFlush();
      return;
    }
    drawing.points = [drawing.points[0], point];
    bumpLocalStroke();
  }, [bumpLocalStroke, capturing, finishShape, onPointer, releaseCapture, scheduleFlush, toNorm, tool]);

  const onPointerUp = useCallback((event) => {
    if (activePointerRef.current != null && event.pointerId !== activePointerRef.current) return;
    releaseCapture(event);
    finishShape();
  }, [finishShape, releaseCapture]);

  useEffect(() => {
    if (!capturing) return undefined;
    const abortStroke = () => {
      if (!drawingRef.current && activePointerRef.current == null) return;
      finishShape();
    };
    const onBlur = () => abortStroke();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") abortStroke();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", abortStroke);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", abortStroke);
    };
  }, [capturing, finishShape]);

  const commitText = useCallback(() => {
    const draft = textDraft;
    setTextDraft(null);
    const value = String(draft?.value || "").trim().slice(0, MAX_TEXT_LEN);
    if (!draft || !value || !canAnnotate) return;
    onObjectUpsert?.({
      id: newAnnotationId(),
      tool: TOOLS.TEXT,
      color,
      width,
      points: [{ x: draft.x, y: draft.y }],
      text: value,
      authorId: currentUserId,
      displayName,
      completed: true,
      coordSpace: COORD_SPACE,
    });
  }, [canAnnotate, color, currentUserId, displayName, onObjectUpsert, textDraft, width]);

  const annotationMap = useMemo(
    () => new Map(annotations.map((item) => [item.id, item])),
    [annotations],
  );
  const canUndo = Boolean(lastOwnAnnotationId(annotationMap, currentUserId));
  const canRedo = redoStack.length > 0;

  const handleUndo = useCallback(() => {
    const id = lastOwnAnnotationId(annotationMap, currentUserId);
    if (!id) return;
    const item = annotationMap.get(id);
    if (item) setRedoStack((prev) => [...prev, item]);
    onUndo?.();
  }, [annotationMap, currentUserId, onUndo]);

  const handleRedo = useCallback(() => {
    const item = redoStack[redoStack.length - 1];
    if (!item) return;
    setRedoStack((prev) => prev.slice(0, -1));
    onRedo?.(item);
    onObjectUpsert?.(item);
  }, [onObjectUpsert, onRedo, redoStack]);

  if (!active) return null;

  const visible = visibleRect?.width > 0 && visibleRect?.height > 0;
  const toolbarHint = tileView
    ? "Для точных координат выйдите из режима плиток в конференции."
    : "";

  const svg = visible ? (
    <svg
      className={`ss-annot__svg${capturing ? " is-capturing" : ""}`}
      width={visibleRect.width}
      height={visibleRect.height}
      viewBox={`0 0 ${visibleRect.width} ${visibleRect.height}`}
      preserveAspectRatio="none"
      style={{
        position: "fixed",
        left: visibleRect.left,
        top: visibleRect.top,
        width: visibleRect.width,
        height: visibleRect.height,
        pointerEvents: capturing ? "auto" : "none",
        touchAction: capturing ? "none" : "auto",
        zIndex: 45,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      {[...annotationMap.values()]
        .filter((ann) => !localStroke || ann.id !== localStroke.id)
        .map((ann) => (
          <AnnotationShape
            key={ann.id}
            ann={ann}
            contentRect={contentRect}
            visibleRect={visibleRect}
          />
        ))}
      {localStroke ? (
        <AnnotationShape ann={localStroke} contentRect={contentRect} visibleRect={visibleRect} />
      ) : null}
      {Object.entries(remoteLasers).map(([id, laser]) => {
        const p = normalizedToVisible(laser.x, laser.y, contentRect, visibleRect);
        if (!p) return null;
        const age = Date.now() - (laser.at || 0);
        if (age > LASER_TTL_MS) return null;
        return (
          <g key={id}>
            <circle cx={p.x} cy={p.y} r="7" fill={laser.color || "#ef4444"} opacity="0.85" />
            {laser.displayName ? (
              <text x={p.x + 10} y={p.y - 8} fill="#fff" fontSize="11" fontWeight="650">
                {laser.displayName}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  ) : null;

  const toolbar = showToolbar && panelOpen ? (
    <div className={`ann-toolbar-slot${compact ? " is-compact" : ""}`}>
      <AnnotationToolbar
        tool={tool}
        color={color}
        width={width}
        canAnnotate={canAnnotate}
        canManage={canManage}
        canUndo={canUndo}
        canRedo={canRedo}
        participantsCanAnnotate={participantsCanAnnotate}
        compact={compact}
        hint={toolbarHint}
        onToolChange={setTool}
        onColorChange={setColor}
        onWidthChange={setWidth}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClearMine={onClearMine}
        onClearAll={onClearAll}
        onSetParticipantsCanAnnotate={onSetParticipantsCanAnnotate}
      />
    </div>
  ) : null;

  return (
    <>
      {targetRef ? null : (
        <div ref={hostFallbackRef} className="ss-annot ss-annot--measure" aria-hidden="true" />
      )}
      {typeof document !== "undefined" && svg ? createPortal(svg, document.body) : svg}
      {typeof document !== "undefined" && toolbar ? createPortal(toolbar, document.body) : toolbar}
      {textDraft?.overlay && visible ? createPortal(
        <input
          className="ss-annot__text"
          style={{
            position: "fixed",
            left: visibleRect.left + textDraft.overlay.x,
            top: visibleRect.top + textDraft.overlay.y,
            zIndex: 56,
          }}
          autoFocus
          maxLength={MAX_TEXT_LEN}
          value={textDraft.value}
          onChange={(e) => setTextDraft((prev) => ({ ...prev, value: e.target.value }))}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            }
            if (e.key === "Escape") setTextDraft(null);
          }}
        />,
        document.body,
      ) : null}
    </>
  );
}
