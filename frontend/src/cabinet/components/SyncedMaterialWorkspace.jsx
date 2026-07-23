import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MaterialCollabBar from "./MaterialCollabBar";

function resourceTypeLabel(kind) {
  const map = {
    pdf: "PDF",
    presentation: "Презентация",
    image: "Изображение",
    text: "Текст",
    notes: "Заметки",
    workbook: "Рабочая тетрадь",
    interactive: "Интерактив",
    cards: "Карточки",
    test: "Тест",
    exercise: "Упражнение",
    file: "Файл",
    embed: "Страница",
    link: "Ссылка",
  };
  return map[kind] || "Материал";
}

function isImageUrl(url, kind = "") {
  if (kind === "image") return true;
  return /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(String(url || "").split("?")[0]);
}

function isPdfUrl(url, kind = "") {
  if (kind === "pdf" || kind === "presentation") return true;
  const path = String(url || "").split("?")[0].toLowerCase();
  if (path.endsWith(".pdf")) return true;
  return false;
}

function viewerSrc(url, { page, showPdf } = {}) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (!showPdf || raw.includes("#")) return raw;
  return `${raw}#page=${page || 1}`;
}

/**
 * Рабочая область синхронного материала с аннотациями и указателем.
 */
export default function SyncedMaterialWorkspace({
  canManage,
  material,
  state,
  interactionMode = "view_only",
  syncStatus = "synced",
  remotePointer = null,
  notice = "",
  canEditContent = false,
  onCloseLocal,
  onCloseForAll,
  onToggleCollaborative,
  onStatePatch,
  onSendCursor,
  onSendPointer,
  onDrawComplete,
}) {
  const stageRef = useRef(null);
  const hitRef = useRef(null);
  const drawingRef = useRef(null);
  const [localStroke, setLocalStroke] = useState(null);
  const [tool, setTool] = useState("pointer");
  const isCollaborative = interactionMode === "collaborative";
  const locked = !canManage && !isCollaborative;
  const contentLocked = locked || (!canManage && !canEditContent);
  const showTools = canManage || isCollaborative;
  // Поверх iframe нужен hit-layer: иначе PDF перехватывает все pointer-события.
  const toolsCaptureInput = showTools && !contentLocked;

  const annotations = useMemo(
    () => (Array.isArray(state?.annotations) ? state.annotations : []),
    [state],
  );
  const page = Number(state?.page || 1);
  const zoom = Number(state?.zoom || 1);
  const scroll = Number(state?.scroll || 0);

  const toNorm = useCallback((clientX, clientY) => {
    const el = stageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const handlePointerMove = useCallback((e) => {
    if (!toolsCaptureInput) return;
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    if (tool === "pointer") {
      if (canManage) onSendPointer?.(p.x, p.y);
      else onSendCursor?.(p.x, p.y);
    } else if (tool === "pen" || tool === "highlighter") {
      onSendCursor?.(p.x, p.y);
    }
    if (!drawingRef.current) return;
    drawingRef.current.points.push([p.x, p.y]);
    setLocalStroke({ ...drawingRef.current, points: [...drawingRef.current.points] });
  }, [canManage, onSendCursor, onSendPointer, toNorm, tool, toolsCaptureInput]);

  const handlePointerDown = useCallback((e) => {
    if (!toolsCaptureInput) return;
    if (tool !== "pen" && tool !== "highlighter" && tool !== "pointer") return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    if (tool === "pointer") {
      const p = toNorm(e.clientX, e.clientY);
      if (p && canManage) onSendPointer?.(p.x, p.y);
      return;
    }
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    const stroke = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool: tool === "highlighter" ? "highlighter" : "pen",
      color: tool === "highlighter" ? "rgba(250, 204, 21, 0.45)" : "#e11d48",
      width: tool === "highlighter" ? 12 : 2.5,
      points: [[p.x, p.y]],
      page,
    };
    drawingRef.current = stroke;
    setLocalStroke(stroke);
  }, [canManage, onSendPointer, page, toNorm, tool, toolsCaptureInput]);

  const handlePointerUp = useCallback((e) => {
    try {
      e?.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    const stroke = drawingRef.current;
    drawingRef.current = null;
    setLocalStroke(null);
    if (!stroke || stroke.points.length < 2) return;
    onDrawComplete?.(stroke);
  }, [onDrawComplete]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || !canManage) return undefined;
    const onScroll = () => {
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      onStatePatch?.({ action: "scrolled", payload: { scroll: el.scrollTop / max } });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [canManage, onStatePatch]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || canManage) return;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    el.scrollTop = scroll * max;
  }, [scroll, canManage, material?.openUrl, material?.contentText]);

  const url = material?.openUrl || material?.url || "";
  const text = material?.contentText || material?.text || "";
  const kind = material?.type || material?.kind || "file";
  const showImage = isImageUrl(url, kind);
  const showPdf = isPdfUrl(url, kind);
  const frameSrc = viewerSrc(url, { page, showPdf });

  const allStrokes = localStroke ? [...annotations, localStroke] : annotations;
  const cursorClass = toolsCaptureInput
    ? (tool === "pointer" ? " is-pointer" : tool === "pen" || tool === "highlighter" ? " is-draw" : "")
    : "";

  return (
    <section className="video-lesson-workspace video-lesson-workspace--synced" aria-label="Просмотр материала">
      <MaterialCollabBar
        canManage={canManage}
        title={material?.title}
        typeLabel={resourceTypeLabel(kind)}
        interactionMode={interactionMode}
        syncStatus={syncStatus}
        collaborative={isCollaborative}
        onToggleCollaborative={onToggleCollaborative}
        onClose={onCloseForAll}
        notice={notice}
        tools={showTools ? (
          <div className="vl-collab-tools" role="toolbar" aria-label="Инструменты">
            <button
              type="button"
              className={tool === "pointer" ? "is-active" : ""}
              onClick={() => setTool("pointer")}
              title="Указатель"
            >
              Указка
            </button>
            <button
              type="button"
              className={tool === "pen" ? "is-active" : ""}
              disabled={contentLocked}
              onClick={() => setTool("pen")}
              title="Перо"
            >
              Перо
            </button>
            <button
              type="button"
              className={tool === "highlighter" ? "is-active" : ""}
              disabled={contentLocked}
              onClick={() => setTool("highlighter")}
              title="Маркер"
            >
              Маркер
            </button>
            {canManage ? (
              <>
                <button
                  type="button"
                  onClick={() => onStatePatch?.({
                    action: "page_changed",
                    payload: { page: Math.max(1, page - 1) },
                  })}
                >
                  ←
                </button>
                <span className="vl-collab-tools__page">стр. {page}</span>
                <button
                  type="button"
                  onClick={() => onStatePatch?.({
                    action: "page_changed",
                    payload: { page: page + 1 },
                  })}
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => onStatePatch?.({
                    action: "zoom_changed",
                    payload: { zoom: Math.max(0.5, zoom - 0.25) },
                  })}
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => onStatePatch?.({
                    action: "zoom_changed",
                    payload: { zoom: Math.min(3, zoom + 0.25) },
                  })}
                >
                  +
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        onCloseLocal={() => {
          if (canManage) onCloseForAll?.();
          else onCloseLocal?.();
        }}
      />
      <div
        className={`video-lesson-workspace__stage${contentLocked ? " is-locked" : ""}${cursorClass}`}
        ref={stageRef}
      >
        <div
          className={`vl-synced-content${toolsCaptureInput ? " is-tools-active" : ""}`}
          style={zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: "top center" } : undefined}
        >
          {text && !url ? (
            <div className="video-lesson-workspace__text">{text}</div>
          ) : showImage && url ? (
            <img src={url} alt={material?.title || ""} className="vl-synced-image" draggable={false} />
          ) : frameSrc ? (
            <iframe
              key={`${frameSrc}|${page}`}
              title={material?.title || "Материал"}
              src={frameSrc}
              className="video-lesson-workspace__frame"
              allow="clipboard-read; clipboard-write; fullscreen"
            />
          ) : (
            <div className="vl-empty">
              <p className="vl-empty__title">Материал недоступен</p>
              <p className="vl-empty__text">Файл нельзя открыть напрямую. Закройте и откройте материал снова.</p>
            </div>
          )}
        </div>
        <svg className="vl-synced-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          {allStrokes
            .filter((a) => !a.page || Number(a.page) === page)
            .map((ann) => {
              const pts = (ann.points || []).map((p) => `${p[0]},${p[1]}`).join(" ");
              return (
                <polyline
                  key={ann.id}
                  points={pts}
                  fill="none"
                  stroke={ann.color || "#e11d48"}
                  strokeWidth={(Number(ann.width) || 2) / 400}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
        </svg>
        {remotePointer ? (
          <div
            className="vl-remote-pointer"
            style={{ left: `${remotePointer.x * 100}%`, top: `${remotePointer.y * 100}%` }}
            aria-hidden="true"
          />
        ) : null}
        {toolsCaptureInput ? (
          <div
            ref={hitRef}
            className={`vl-synced-hit vl-synced-hit--${tool}`}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={(e) => {
              // Не завершаем штрих при уходе курсора, если capture активен.
              if (drawingRef.current && e.buttons === 0) handlePointerUp(e);
            }}
            role="presentation"
          />
        ) : contentLocked ? (
          <div className="vl-synced-lock" aria-hidden="true" />
        ) : null}
      </div>
    </section>
  );
}
