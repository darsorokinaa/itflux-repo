import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MaterialCollabBar from "./MaterialCollabBar";
import InteractivePlayer from "./InteractivePlayer";
import { fetchInteractive, fetchMeetingMaterialInteractive } from "../../utils/cabinetAuth";

const PEN_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#ca8a04", "#7c3aed", "#0f172a"];
const WIDTHS = [2, 3, 5, 8];
const TOOL_STORAGE_KEY = "itflux.material.drawTools";

function loadToolPrefs() {
  try {
    const raw = localStorage.getItem(TOOL_STORAGE_KEY);
    if (!raw) return { color: "#e11d48", width: 3 };
    const parsed = JSON.parse(raw);
    return {
      color: String(parsed.color || "#e11d48"),
      width: Number(parsed.width) || 3,
    };
  } catch {
    return { color: "#e11d48", width: 3 };
  }
}

function saveToolPrefs(prefs) {
  try {
    localStorage.setItem(TOOL_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** answers/fields: per-user {userId:{itemId:row}} или legacy flat {itemId:row} → плоский для DOM. */
function flattenUserBucket(bucket, currentUserId, canManage) {
  if (!bucket || typeof bucket !== "object") return {};
  const values = Object.values(bucket);
  const looksPerUser = values.some((v) => {
    if (!v || typeof v !== "object" || "value" in v) return false;
    return Object.values(v).some((row) => row && typeof row === "object" && ("value" in row || "author_id" in row));
  });
  if (!looksPerUser) {
    // Legacy flat — отдаём как есть (учитель/ученик видят своё после personalize на сервере).
    return bucket;
  }
  if (canManage) {
    // Учителю для DOM текущего слайда показываем последний ответ по каждому item
    // (панель «Ответы» читает полную структуру отдельно).
    const flat = {};
    for (const userBucket of values) {
      if (!userBucket || typeof userBucket !== "object") continue;
      for (const [itemId, row] of Object.entries(userBucket)) {
        if (row && typeof row === "object") flat[itemId] = row;
      }
    }
    return flat;
  }
  const key = currentUserId != null ? String(currentUserId) : "";
  const mine = (key && bucket[key]) || {};
  return mine && typeof mine === "object" ? mine : {};
}

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
  return path.endsWith(".pdf");
}

function viewerSrc(url, { page, showPdf } = {}) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (!showPdf) return raw;
  const base = raw.split("#")[0];
  return `${base}#page=${page || 1}`;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function strokeNearPoint(ann, x, y, threshold = 0.02) {
  const pts = ann?.points || [];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!Array.isArray(a) || !Array.isArray(b)) continue;
    if (distToSegment(x, y, Number(a[0]), Number(a[1]), Number(b[0]), Number(b[1])) <= threshold) {
      return true;
    }
  }
  return false;
}

function roleCursorClass(role) {
  return role === "teacher" || role === "staff" ? "is-teacher" : "is-student";
}

/**
 * Рабочая область синхронного материала с аннотациями и указателем.
 */
export default function SyncedMaterialWorkspace({
  canManage,
  meetingUuid,
  material,
  state,
  interactionMode = "view_only",
  followPolicy = "strict",
  syncStatus = "synced",
  remoteCursors = [],
  remotePreviews = {},
  presence = [],
  notice = "",
  canEditContent = false,
  currentUserId = null,
  isController = true,
  controllerLabel = "",
  onAllowIndependent,
  onReturnToLeader,
  onTransferControl,
  onCloseLocal,
  onCloseForAll,
  onToggleCollaborative,
  onStatePatch,
  onSendCursor,
  onSendPointer,
  onDrawComplete,
  onDrawPreview,
  onEraseAnnotation,
  onClearOwnAnnotations,
  onInteractiveOp,
  remoteApplyGuard = null,
}) {
  const stageRef = useRef(null);
  const hitRef = useRef(null);
  const drawingRef = useRef(null);
  const interactiveRootRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const fieldDebounceRef = useRef(new Map());
  const prefs = useMemo(() => loadToolPrefs(), []);
  const [localStroke, setLocalStroke] = useState(null);
  const [localPointer, setLocalPointer] = useState(null);
  const [tool, setTool] = useState("hand");
  const [penColor, setPenColor] = useState(prefs.color);
  const [penWidth, setPenWidth] = useState(prefs.width);
  const [customColor, setCustomColor] = useState(prefs.color);
  const [interactive, setInteractive] = useState(null);
  const [interactiveError, setInteractiveError] = useState("");

  const isCollaborative = interactionMode === "collaborative";
  const independent = followPolicy === "independent";
  // strict follow: навигация за учителем, ответы доступны.
  const followMode = !canManage && !independent && !isCollaborative;
  const locked = followMode;
  const contentLocked = !canManage && !canEditContent && !followMode && !independent;
  const canAnswer = canManage || canEditContent || followMode || independent;
  const showTools = canManage || isCollaborative;
  const canNavigate = (canManage && isController) || independent || isCollaborative;
  const drawToolActive = tool === "pen" || tool === "highlighter" || tool === "pointer" || tool === "eraser";
  const toolsCaptureInput = showTools && drawToolActive && (canManage || !contentLocked || tool === "pointer");

  const annotations = useMemo(
    () => (Array.isArray(state?.annotations) ? state.annotations : []),
    [state],
  );
  const page = Number(state?.page || 1);
  const zoom = Number(state?.zoom || 1);
  const scroll = Number(state?.scroll || 0);

  useEffect(() => {
    saveToolPrefs({ color: penColor, width: penWidth });
  }, [penColor, penWidth]);

  useEffect(() => {
    const id = material?.interactiveId;
    if (!id) {
      setInteractive(null);
      setInteractiveError("");
      return undefined;
    }
    let cancelled = false;
    setInteractiveError("");
    // В комнате урока — только через meeting-scoped эндпоинт: /interactives/<id>/
    // доступен лишь учителю-владельцу (IsCabinetTeacher), ученик получал бы 403.
    const request = meetingUuid
      ? fetchMeetingMaterialInteractive(meetingUuid, id).then((data) => data?.interactive)
      : fetchInteractive(id);
    request
      .then((data) => {
        if (!cancelled) setInteractive(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setInteractive(null);
          setInteractiveError(err?.message || "Не удалось загрузить интерактив");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [material?.interactiveId, meetingUuid]);

  const patchState = useCallback((action, payload) => {
    if (remoteApplyGuard?.isRemote?.()) return;
    onStatePatch?.({ action, payload });
  }, [onStatePatch, remoteApplyGuard]);

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
      setLocalPointer(p);
      if (canManage) onSendPointer?.(p.x, p.y);
      else onSendCursor?.(p.x, p.y);
      return;
    }
    if (tool === "pen" || tool === "highlighter" || tool === "eraser") {
      onSendCursor?.(p.x, p.y);
    }
    if (!drawingRef.current) return;
    if (tool === "eraser") return;
    drawingRef.current.points.push([p.x, p.y]);
    const stroke = {
      ...drawingRef.current,
      points: drawingRef.current.points.slice(),
    };
    setLocalStroke(stroke);
    onDrawPreview?.(stroke);
  }, [canManage, onDrawPreview, onSendCursor, onSendPointer, toNorm, tool, toolsCaptureInput]);

  const handlePointerDown = useCallback((e) => {
    if (!toolsCaptureInput) return;
    if (tool !== "pen" && tool !== "highlighter" && tool !== "pointer" && tool !== "eraser") return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    if (tool === "pointer") {
      setLocalPointer(p);
      if (canManage) onSendPointer?.(p.x, p.y);
      return;
    }
    if (tool === "eraser") {
      const pageAnns = annotations.filter((a) => !a.page || Number(a.page) === page);
      const hit = [...pageAnns].reverse().find((ann) => {
        if (!canManage && currentUserId != null && Number(ann.author_id) !== Number(currentUserId)) {
          return false;
        }
        return strokeNearPoint(ann, p.x, p.y, Math.max(0.015, (Number(ann.width) || 3) / 400));
      });
      if (hit?.id) {
        onEraseAnnotation?.(hit);
        undoStackRef.current.push({ type: "delete", annotation: hit });
        redoStackRef.current = [];
      }
      return;
    }
    const stroke = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool: tool === "highlighter" ? "highlighter" : "pen",
      color: tool === "highlighter" ? "rgba(250, 204, 21, 0.55)" : penColor,
      width: tool === "highlighter" ? Math.max(12, penWidth * 3) : penWidth,
      points: [[p.x, p.y], [p.x + 0.0001, p.y]],
      page,
      created_at: Date.now(),
      version: 1,
    };
    drawingRef.current = stroke;
    setLocalStroke({ ...stroke, points: stroke.points.slice() });
    onDrawPreview?.(stroke);
  }, [
    annotations,
    canManage,
    currentUserId,
    onDrawPreview,
    onEraseAnnotation,
    onSendPointer,
    page,
    penColor,
    penWidth,
    toNorm,
    tool,
    toolsCaptureInput,
  ]);

  const finishStroke = useCallback(() => {
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (!stroke) {
      setLocalStroke(null);
      return;
    }
    if (stroke.points.length < 2) {
      setLocalStroke(null);
      return;
    }
    onDrawComplete?.(stroke);
    undoStackRef.current.push({ type: "add", annotation: stroke });
    redoStackRef.current = [];
    setLocalStroke(null);
  }, [onDrawComplete]);

  const handlePointerUp = useCallback((e) => {
    try {
      e?.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    finishStroke();
  }, [finishStroke]);

  useEffect(() => {
    if (tool !== "pointer") setLocalPointer(null);
  }, [tool]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || !canNavigate) return undefined;
    const onScroll = () => {
      if (remoteApplyGuard?.isRemote?.()) return;
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      patchState("scrolled", { scroll: el.scrollTop / max });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [canNavigate, patchState, remoteApplyGuard]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || canManage || canNavigate) return;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    el.scrollTop = scroll * max;
  }, [scroll, canManage, canNavigate, material?.openUrl, material?.contentText]);

  // Синхронизация интерактивных полей внутри корневого контейнера (input/select/checkbox).
  useEffect(() => {
    const root = interactiveRootRef.current;
    if (!root || !canAnswer) return undefined;

    const emitField = (fieldId, value, action = "field_changed") => {
      if (remoteApplyGuard?.isRemote?.()) return;
      onInteractiveOp?.({
        action,
        payload: {
          fieldId,
          questionId: fieldId,
          value,
          status: "draft",
        },
      });
    };

    const onInput = (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      const fieldId = el.getAttribute("name") || el.id || el.getAttribute("data-field-id");
      if (!fieldId) return;
      let value;
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        value = el.type === "checkbox" ? el.checked : el.value;
      } else {
        value = "value" in el ? el.value : "";
      }
      const timers = fieldDebounceRef.current;
      if (timers.has(fieldId)) window.clearTimeout(timers.get(fieldId));
      timers.set(fieldId, window.setTimeout(() => {
        emitField(
          fieldId,
          value,
          el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")
            ? "answer_selected"
            : "field_changed",
        );
      }, 120));
    };

    root.addEventListener("input", onInput, true);
    root.addEventListener("change", onInput, true);
    return () => {
      root.removeEventListener("input", onInput, true);
      root.removeEventListener("change", onInput, true);
    };
  }, [canAnswer, onInteractiveOp, remoteApplyGuard, interactive, material?.interactiveId]);

  // Плоский вид answers/fields для текущего пользователя (или все — для учителя).
  const flatFields = useMemo(() => flattenUserBucket(state?.fields, currentUserId, canManage), [state?.fields, currentUserId, canManage]);
  const flatAnswers = useMemo(() => flattenUserBucket(state?.answers, currentUserId, canManage), [state?.answers, currentUserId, canManage]);

  // Применить удалённые fields/answers к DOM.
  useEffect(() => {
    const root = interactiveRootRef.current;
    if (!root) return;
    const fields = flatFields;
    const answers = flatAnswers;
    const findField = (id) => {
      try {
        const esc = CSS.escape(String(id));
        return root.querySelector(`[name="${esc}"], #${esc}, [data-field-id="${esc}"]`);
      } catch {
        return root.querySelector(`[name="${id}"], [data-field-id="${id}"]`);
      }
    };
    remoteApplyGuard?.run?.(() => {
      for (const [fieldId, row] of Object.entries(fields)) {
        const el = findField(fieldId);
        if (!el) continue;
        const value = row?.value;
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          el.checked = Boolean(value);
        } else if (el instanceof HTMLInputElement && el.type === "radio") {
          if (String(el.value) === String(value)) el.checked = true;
        } else if ("value" in el) {
          el.value = value == null ? "" : String(value);
        }
      }
      for (const [qid, row] of Object.entries(answers)) {
        const el = findField(qid);
        if (!el || !("value" in el)) continue;
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
          el.checked = Boolean(row?.value) || String(el.value) === String(row?.value);
        } else {
          el.value = row?.value == null ? "" : String(row.value);
        }
      }
    });
  }, [flatFields, flatAnswers, remoteApplyGuard, interactive]);

  const handleUndo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    if (entry.type === "add") {
      onEraseAnnotation?.(entry.annotation);
      redoStackRef.current.push(entry);
    } else if (entry.type === "delete") {
      onDrawComplete?.(entry.annotation);
      redoStackRef.current.push(entry);
    }
  }, [onDrawComplete, onEraseAnnotation]);

  const handleRedo = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    if (entry.type === "add") {
      onDrawComplete?.(entry.annotation);
      undoStackRef.current.push(entry);
    } else if (entry.type === "delete") {
      onEraseAnnotation?.(entry.annotation);
      undoStackRef.current.push(entry);
    }
  }, [onDrawComplete, onEraseAnnotation]);

  const url = material?.openUrl || material?.url || "";
  const text = material?.contentText || material?.text || "";
  const kind = material?.type || material?.kind || "file";
  const showImage = isImageUrl(url, kind);
  const showPdf = isPdfUrl(url, kind);
  const frameSrc = viewerSrc(url, { page, showPdf });
  const showInteractive = Boolean(material?.interactiveId);

  const allStrokes = useMemo(() => {
    const map = new Map();
    for (const a of annotations) {
      if (a?.id) map.set(a.id, a);
    }
    for (const a of Object.values(remotePreviews || {})) {
      if (a?.id) map.set(a.id, a);
    }
    if (localStroke?.id) map.set(localStroke.id, localStroke);
    return Array.from(map.values());
  }, [annotations, localStroke, remotePreviews]);

  const cursorClass = toolsCaptureInput
    ? (tool === "pointer" ? " is-pointer" : tool === "eraser" ? " is-eraser" : tool === "pen" || tool === "highlighter" ? " is-draw" : "")
    : "";

  const presenceLabel = presence.length
    ? presence.map((p) => p.displayName || p.display_name || "Участник").join(", ")
    : "";

  return (
    <section className="video-lesson-workspace video-lesson-workspace--synced" aria-label="Просмотр материала">
      <MaterialCollabBar
        canManage={canManage}
        title={material?.title}
        typeLabel={resourceTypeLabel(kind)}
        interactionMode={interactionMode}
        followPolicy={followPolicy}
        syncStatus={syncStatus}
        collaborative={isCollaborative}
        isController={isController}
        controllerLabel={controllerLabel}
        onToggleCollaborative={onToggleCollaborative}
        onAllowIndependent={onAllowIndependent}
        onReturnToLeader={onReturnToLeader}
        onTransferControl={onTransferControl}
        onClose={onCloseForAll}
        notice={notice}
        presenceLabel={presenceLabel}
        tools={showTools ? (
          <div className="vl-collab-tools" role="toolbar" aria-label="Инструменты">
            <button type="button" className={tool === "hand" ? "is-active" : ""} onClick={() => setTool("hand")} title="Курсор / просмотр">Курсор</button>
            <button type="button" className={tool === "pointer" ? "is-active" : ""} onClick={() => setTool("pointer")} title="Указка">Указка</button>
            <button type="button" className={tool === "pen" ? "is-active" : ""} disabled={contentLocked && !canManage} onClick={() => setTool("pen")} title="Перо">Перо</button>
            <button type="button" className={tool === "eraser" ? "is-active" : ""} disabled={contentLocked && !canManage} onClick={() => setTool("eraser")} title="Ластик">Ластик</button>
            <label className="vl-collab-tools__color" title="Цвет">
              <span className="vl-collab-tools__swatches">
                {PEN_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`vl-swatch${penColor === c ? " is-active" : ""}`}
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => { setPenColor(c); setCustomColor(c); setTool("pen"); }}
                  />
                ))}
              </span>
              <input
                type="color"
                value={customColor.startsWith("#") ? customColor : "#e11d48"}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  setPenColor(e.target.value);
                  setTool("pen");
                }}
                aria-label="Свой цвет"
              />
            </label>
            <label className="vl-collab-tools__width" title="Толщина">
              <select
                value={penWidth}
                onChange={(e) => setPenWidth(Number(e.target.value) || 3)}
                aria-label="Толщина линии"
              >
                {WIDTHS.map((w) => <option key={w} value={w}>{w}px</option>)}
              </select>
            </label>
            <button type="button" disabled={contentLocked && !canManage} onClick={handleUndo} title="Отменить">↩</button>
            <button type="button" disabled={contentLocked && !canManage} onClick={handleRedo} title="Повторить">↪</button>
            <button
              type="button"
              disabled={contentLocked && !canManage}
              onClick={() => onClearOwnAnnotations?.()}
              title="Очистить свои пометки"
            >
              Очистить
            </button>
            {canNavigate ? (
              <>
                <button
                  type="button"
                  onClick={() => patchState("page_changed", { page: Math.max(1, page - 1) })}
                >
                  ←
                </button>
                <span className="vl-collab-tools__page">стр. {page}</span>
                <button
                  type="button"
                  onClick={() => patchState("page_changed", { page: page + 1 })}
                >
                  →
                </button>
                <button type="button" onClick={() => patchState("zoom_changed", { zoom: Math.max(0.5, zoom - 0.25) })}>−</button>
                <button type="button" onClick={() => patchState("zoom_changed", { zoom: Math.min(3, zoom + 0.25) })}>+</button>
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
          ref={interactiveRootRef}
        >
          {showInteractive && interactive ? (
            <div className="vl-synced-interactive">
              <InteractivePlayer interactive={interactive} bare playing />
            </div>
          ) : showInteractive && interactiveError ? (
            <div className="vl-empty">
              <p className="vl-empty__title">Интерактив недоступен</p>
              <p className="vl-empty__text">{interactiveError}</p>
            </div>
          ) : text && !url ? (
            <div className="video-lesson-workspace__text">{text}</div>
          ) : showImage && url ? (
            <img src={url} alt={material?.title || ""} className="vl-synced-image" draggable={false} />
          ) : frameSrc ? (
            <iframe
              key={`${frameSrc.split("#")[0]}|${page}`}
              title={material?.title || "Материал"}
              src={frameSrc}
              className="video-lesson-workspace__frame"
              allow="camera; microphone; display-capture; autoplay; clipboard-read; clipboard-write; fullscreen"
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
              const pts = (ann.points || [])
                .filter((p) => Array.isArray(p) && p.length >= 2)
                .map((p) => `${Number(p[0])},${Number(p[1])}`)
                .join(" ");
              if (!pts) return null;
              const px = Math.max(2, Number(ann.width) || 3);
              return (
                <polyline
                  key={ann.id}
                  points={pts}
                  fill="none"
                  stroke={ann.color || "#e11d48"}
                  strokeWidth={px}
                  strokeOpacity={ann.tool === "highlighter" ? 0.65 : 1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
        </svg>
        {localPointer && tool === "pointer" ? (
          <div
            className="vl-local-pointer"
            style={{ left: `${localPointer.x * 100}%`, top: `${localPointer.y * 100}%` }}
            aria-hidden="true"
          />
        ) : null}
        {remoteCursors.map((cursor) => (
          <div
            key={cursor.clientId || cursor.authorId || `${cursor.x}-${cursor.y}`}
            className={`vl-remote-cursor ${roleCursorClass(cursor.authorRole || cursor.role)}`}
            style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
            aria-hidden="true"
          >
            <span className="vl-remote-cursor__dot" />
            <span className="vl-remote-cursor__label">{cursor.displayName || "Участник"}</span>
          </div>
        ))}
        {toolsCaptureInput ? (
          <div
            ref={hitRef}
            className={`vl-synced-hit vl-synced-hit--${tool}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            role="presentation"
          />
        ) : null}
      </div>
    </section>
  );
}

