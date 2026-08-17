import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DRAWING_TOOLS,
  LASER_TTL_MS,
  MAX_POINTS_PER_BATCH,
  MAX_TEXT_LEN,
  PALETTE,
  POINTER_THROTTLE_MS,
  STROKE_FLUSH_MS,
  TOOLS,
  WIDTHS,
  newAnnotationId,
  participantColor,
} from "./constants";
import {
  applyScreenshareOperation,
  findAnnotationAt,
  lastOwnAnnotationId,
} from "./annotationModel";
import {
  clientToNormalized,
  computeScreenShareContentRect,
  normalizedToOverlay,
  strokeWidthPx,
} from "./contentRect";

function pointsToPath(points, contentRect, hostRect) {
  if (!points?.length) return "";
  return points.map((pt, index) => {
    const p = normalizedToOverlay(pt.x, pt.y, contentRect, hostRect);
    if (!p) return "";
    return `${index === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }).join(" ");
}

function arrowHead(points, contentRect, hostRect) {
  if (!points || points.length < 2) return null;
  const a = normalizedToOverlay(points[points.length - 2].x, points[points.length - 2].y, contentRect, hostRect);
  const b = normalizedToOverlay(points[points.length - 1].x, points[points.length - 1].y, contentRect, hostRect);
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

function AnnotationShape({ ann, contentRect, hostRect }) {
  const pts = ann.points || [];
  const color = ann.color || "#ef4444";
  const sw = strokeWidthPx(ann.width || 3, contentRect.width);
  const tool = ann.tool || "pen";
  if (tool === "text" && pts[0]) {
    const p = normalizedToOverlay(pts[0].x, pts[0].y, contentRect, hostRect);
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
    const a = normalizedToOverlay(pts[0].x, pts[0].y, contentRect, hostRect);
    const b = normalizedToOverlay(pts[1].x, pts[1].y, contentRect, hostRect);
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
    return (
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth={sw} />
    );
  }
  if (tool === "line" && pts.length >= 2) {
    const a = normalizedToOverlay(pts[0].x, pts[0].y, contentRect, hostRect);
    const b = normalizedToOverlay(pts[pts.length - 1].x, pts[pts.length - 1].y, contentRect, hostRect);
    if (!a || !b) return null;
    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={sw} />;
  }
  if (tool === "arrow" && pts.length >= 2) {
    const a = normalizedToOverlay(pts[0].x, pts[0].y, contentRect, hostRect);
    const b = normalizedToOverlay(pts[pts.length - 1].x, pts[pts.length - 1].y, contentRect, hostRect);
    const head = arrowHead([pts[0], pts[pts.length - 1]], contentRect, hostRect);
    if (!a || !b || !head) return null;
    return (
      <g>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={sw} />
        <polygon
          points={head.map((p) => `${p.x},${p.y}`).join(" ")}
          fill={color}
        />
      </g>
    );
  }
  const d = pointsToPath(pts, contentRect, hostRect);
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
  contentWidth = 1920,
  contentHeight = 1080,
  annotations = [],
  remoteLasers = {},
  tileView = false,
  onReportLayout,
  onStrokeStart,
  onStrokeUpdate,
  onStrokeEnd,
  onObjectUpsert,
  onPointer,
  onErase,
  onUndo,
  onClearMine,
  onClearAll,
  onSetParticipantsCanAnnotate,
}) {
  const hostRef = useRef(null);
  const [hostBox, setHostBox] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tool, setTool] = useState(TOOLS.POINTER);
  const [color, setColor] = useState(() => participantColor(currentUserId));
  const [width, setWidth] = useState(3);
  const [localStroke, setLocalStroke] = useState(null);
  const [textDraft, setTextDraft] = useState(null);
  const drawingRef = useRef(null);
  const pendingPointsRef = useRef([]);
  const flushTimerRef = useRef(null);
  const pointerThrottleRef = useRef(0);

  useEffect(() => {
    setColor((prev) => (PALETTE.includes(prev) ? prev : participantColor(currentUserId)));
  }, [currentUserId]);

  useEffect(() => {
    if (!active) {
      setPanelOpen(false);
      setTool(TOOLS.POINTER);
      setLocalStroke(null);
      setTextDraft(null);
      drawingRef.current = null;
    }
  }, [active]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return undefined;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setHostBox({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(node);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    document.addEventListener("fullscreenchange", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      document.removeEventListener("fullscreenchange", update);
    };
  }, [active]);

  const layout = useMemo(
    () => computeScreenShareContentRect({
      hostRect: hostBox,
      contentWidth,
      contentHeight,
      compact,
    }),
    [hostBox, contentWidth, contentHeight, compact],
  );

  useEffect(() => {
    if (!active || !layout?.content?.width) return;
    onReportLayout?.(layout);
  }, [active, layout, onReportLayout]);

  const capturing = panelOpen && DRAWING_TOOLS.has(tool) && canAnnotate;
  const contentRect = layout.content;
  const hostRect = layout.host;

  const flushPoints = useCallback((end = false) => {
    const drawing = drawingRef.current;
    if (!drawing || !pendingPointsRef.current.length) {
      if (end && drawing) onStrokeEnd?.(drawing);
      return;
    }
    const batch = pendingPointsRef.current.splice(0, MAX_POINTS_PER_BATCH);
    onStrokeUpdate?.({ ...drawing, points: batch });
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
    if (!contentRect?.width) return null;
    return clientToNormalized(event.clientX, event.clientY, contentRect);
  }, [contentRect]);

  const onPointerDown = useCallback((event) => {
    if (!capturing) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = toNorm(event);
    if (!point) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (tool === TOOLS.TEXT) {
      setTextDraft({
        x: point.x,
        y: point.y,
        overlay: normalizedToOverlay(point.x, point.y, contentRect, hostRect),
        value: "",
      });
      return;
    }
    if (tool === TOOLS.ERASER) {
      const hit = findAnnotationAt(
        new Map(annotations.map((a) => [a.id, a])),
        point.x,
        point.y,
      );
      if (hit) onErase?.(hit);
      return;
    }
    if (tool === TOOLS.LASER) {
      onPointer?.(point);
      drawingRef.current = { tool: TOOLS.LASER };
      return;
    }
    if (!canAnnotate) return;
    const stroke = {
      id: newAnnotationId(),
      tool,
      color,
      width,
      points: [point],
      authorId: currentUserId,
      displayName,
      completed: false,
    };
    drawingRef.current = stroke;
    pendingPointsRef.current = [];
    setLocalStroke(stroke);
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
    hostRect,
    onErase,
    onPointer,
    onStrokeStart,
    toNorm,
    tool,
    width,
  ]);

  const onPointerMove = useCallback((event) => {
    if (!capturing) return;
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
    if (tool === TOOLS.PEN || tool === TOOLS.HIGHLIGHTER) {
      drawing.points = [...drawing.points, point];
      pendingPointsRef.current.push(point);
      setLocalStroke({ ...drawing, points: [...drawing.points] });
      scheduleFlush();
      return;
    }
    drawing.points = [drawing.points[0], point];
    setLocalStroke({ ...drawing, points: [...drawing.points] });
  }, [capturing, onPointer, scheduleFlush, toNorm, tool]);

  const finishShape = useCallback(() => {
    const drawing = drawingRef.current;
    if (!drawing) return;
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (drawing.tool === TOOLS.LASER) {
      drawingRef.current = null;
      return;
    }
    if (drawing.tool === TOOLS.PEN || drawing.tool === TOOLS.HIGHLIGHTER) {
      flushPoints(true);
    } else if (drawing.points?.length >= 2) {
      onObjectUpsert?.({ ...drawing, completed: true });
    }
    drawingRef.current = null;
    setLocalStroke(null);
  }, [flushPoints, onObjectUpsert]);

  const onPointerUp = useCallback((event) => {
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
    finishShape();
  }, [finishShape]);

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
    });
  }, [canAnnotate, color, currentUserId, displayName, onObjectUpsert, textDraft, width]);

  const annotationMap = useMemo(
    () => new Map(annotations.map((item) => [item.id, item])),
    [annotations],
  );
  const canUndo = Boolean(lastOwnAnnotationId(annotationMap, currentUserId));

  if (!active) return null;

  const tools = [
    [TOOLS.POINTER, "Указка"],
    [TOOLS.LASER, "Лазер"],
    [TOOLS.PEN, "Перо"],
    [TOOLS.HIGHLIGHTER, "Маркер"],
    [TOOLS.LINE, "Линия"],
    [TOOLS.ARROW, "Стрелка"],
    [TOOLS.RECT, "Прямоуг."],
    [TOOLS.ELLIPSE, "Овал"],
    [TOOLS.TEXT, "Текст"],
    [TOOLS.ERASER, "Ластик"],
  ];

  return (
    <div
      ref={hostRef}
      className={`ss-annot${compact ? " ss-annot--compact" : ""}${capturing ? " is-capturing" : ""}`}
    >
      <button
        type="button"
        className={`ss-annot__toggle${panelOpen ? " is-open" : ""}`}
        onClick={() => setPanelOpen((v) => !v)}
        aria-pressed={panelOpen}
      >
        ✏ Аннотации
      </button>

      {panelOpen ? (
        <div className="ss-annot__panel" role="toolbar" aria-label="Инструменты аннотаций">
          <div className="ss-annot__tools">
            {tools.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tool === id ? "is-active" : ""}
                disabled={!canAnnotate && id !== TOOLS.POINTER}
                onClick={() => setTool(id)}
                title={label}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="ss-annot__style">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`ss-annot__swatch${color === c ? " is-active" : ""}`}
                style={{ background: c }}
                aria-label={`Цвет ${c}`}
                disabled={!canAnnotate}
                onClick={() => setColor(c)}
              />
            ))}
            <select
              className="ss-annot__width"
              value={width}
              disabled={!canAnnotate}
              onChange={(e) => setWidth(Number(e.target.value))}
              aria-label="Толщина"
            >
              {WIDTHS.map((w) => (
                <option key={w} value={w}>{w}px</option>
              ))}
            </select>
          </div>
          <div className="ss-annot__actions">
            <button type="button" disabled={!canAnnotate || !canUndo} onClick={() => onUndo?.()}>
              Отменить
            </button>
            <button type="button" disabled={!canAnnotate} onClick={() => onClearMine?.()}>
              Очистить свои
            </button>
            {canManage ? (
              <>
                <button type="button" onClick={() => onClearAll?.()}>Очистить все</button>
                <button
                  type="button"
                  className={participantsCanAnnotate ? "is-active" : ""}
                  onClick={() => onSetParticipantsCanAnnotate?.(!participantsCanAnnotate)}
                >
                  {participantsCanAnnotate ? "Запретить участникам" : "Разрешить участникам"}
                </button>
              </>
            ) : null}
          </div>
          {!canAnnotate ? (
            <p className="ss-annot__hint">Преподаватель запретил рисовать. Аннотации остаются видны.</p>
          ) : null}
          {tileView ? (
            <p className="ss-annot__hint">Для точных координат выйдите из режима плиток в конференции.</p>
          ) : null}
        </div>
      ) : null}

      <svg
        className="ss-annot__svg"
        width="100%"
        height="100%"
        style={{ pointerEvents: capturing ? "auto" : "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {[...annotationMap.values()].map((ann) => (
          <AnnotationShape
            key={ann.id}
            ann={ann}
            contentRect={contentRect}
            hostRect={hostRect}
          />
        ))}
        {localStroke ? (
          <AnnotationShape ann={localStroke} contentRect={contentRect} hostRect={hostRect} />
        ) : null}
        {Object.entries(remoteLasers).map(([id, laser]) => {
          const p = normalizedToOverlay(laser.x, laser.y, contentRect, hostRect);
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

      {textDraft?.overlay ? (
        <input
          className="ss-annot__text"
          style={{ left: textDraft.overlay.x, top: textDraft.overlay.y }}
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
        />
      ) : null}
    </div>
  );
}
