import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MaterialCollabBar from "./MaterialCollabBar";
import InteractivePlayer from "./InteractivePlayer";
import { fetchInteractive, fetchMeetingMaterialInteractive } from "../../utils/cabinetAuth";
import {
  THROTTLE,
  VIEWPORT_THROTTLE_MS,
  COORD_SPACE_CONTENT_V1,
  createHtmlLessonBridge,
  htmlEventToMaterialOp,
  getCapabilitiesForKind,
  getMaterialViewportTransform,
  clientToContentNorm,
  contentNormToSurfaceNorm,
  getVisibleContentViewport,
  pxWidthToNorm,
  resolveStrokeWidthPx,
  isContentCoordSpace,
} from "../materials/collab";
import SpreadsheetMaterialView from "./SpreadsheetMaterialView";
import { useAnnotationSession } from "../annotations/AnnotationContext";
import AnnotationToolbar from "../annotations/AnnotationToolbar";
import {
  isMatchingActivePointer,
  isStrokePointerHeld,
  shouldIgnorePointerDown,
} from "../annotations/pointerStroke";
import { DRAWING_TOOLS, TOOLS } from "../screenshare/constants";

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
    board: "Доска",
    spreadsheet: "Таблица",
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
  // Include page in src for first load only; subsequent page changes update
  // iframe location hash without remounting (see page sync effect).
  return `${base}#page=${page || 1}`;
}

function frameBaseKey(url) {
  return String(url || "").split("#")[0];
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

function materialToolFromSession(tool) {
  if (!tool || tool === TOOLS.POINTER || tool === TOOLS.LASER) return "pointer";
  if (tool === TOOLS.HIGHLIGHTER) return "highlighter";
  if (tool === TOOLS.ERASER) return "eraser";
  if (DRAWING_TOOLS.has(tool)) return "pen";
  return "hand";
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
  collaborationPermission = "answers_only",
  followingTeacher = true,
  onFollowBreak = null,
  onFollowReturn = null,
  onFollowStatusChange = null,
  onConfigurePermissions = null,
  studentViewports = {},
  onSendStudentViewport = null,
}) {
  const stageRef = useRef(null);
  const surfaceRef = useRef(null);
  const mediaRef = useRef(null);
  const hitRef = useRef(null);
  const drawingRef = useRef(null);
  const activePointerRef = useRef(null);
  const interactiveRootRef = useRef(null);
  const iframeRef = useRef(null);
  const htmlBridgeRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const fieldDebounceRef = useRef(new Map());
  const transformRef = useRef(null);
  const annotation = useAnnotationSession();
  const prefs = useMemo(() => loadToolPrefs(), []);
  const [localStroke, setLocalStroke] = useState(null);
  const [localPointer, setLocalPointer] = useState(null);
  const [localTool, setLocalTool] = useState("hand");
  const [localColor, setLocalColor] = useState(prefs.color);
  const [localWidth, setLocalWidth] = useState(prefs.width);
  const [customColor, setCustomColor] = useState(prefs.color);
  const [interactive, setInteractive] = useState(null);
  const [interactiveError, setInteractiveError] = useState("");
  const [localBrowsingAway, setLocalBrowsingAway] = useState(false);
  const [localPage, setLocalPage] = useState(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 1, height: 1 });
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [showStudentViewport, setShowStudentViewport] = useState(true);
  const [studentPreviewMode, setStudentPreviewMode] = useState(false);

  const url = material?.openUrl || material?.url || "";
  const text = material?.contentText || material?.text || "";
  const kind = material?.type || material?.kind || "file";
  const isBoard =
    kind === "board"
    || Boolean(material?.boardId)
    || /\/cabinet\/boards\//i.test(String(url));
  const isSpreadsheet = kind === "spreadsheet" || /\.(xls|xlsx|ods|csv)(\?|$)/i.test(String(url).split("?")[0]);
  const capabilities = useMemo(() => getCapabilitiesForKind(isSpreadsheet ? "spreadsheet" : kind), [kind, isSpreadsheet]);

  const isCollaborative = interactionMode === "collaborative";
  const independent = followPolicy === "independent";
  // strict follow: навигация за учителем, ответы доступны.
  const followMode = !canManage && !independent && !isCollaborative && !localBrowsingAway;
  const locked = followMode;
  const contentLocked = !canManage && !canEditContent && !followMode && !independent && !localBrowsingAway;
  const canAnswer = canManage || canEditContent || followMode || independent || localBrowsingAway || isCollaborative;
  // На доске Excalidraw рисование — внутри iframe; overlay «Перо» только мешает стилусу.
  const showTools = (canManage || (isCollaborative && ["annotate", "edit_content", "full"].includes(collaborationPermission))) && !isBoard;
  const canNavigate = ((canManage && isController) || independent || isCollaborative || localBrowsingAway) && !isBoard;
  const sessionDriven = Boolean(annotation?.enabled && annotation.target === "material" && showTools);
  const tool = sessionDriven
    ? materialToolFromSession(annotation.tool)
    : (annotation ? "hand" : localTool);
  const penColor = sessionDriven ? annotation.color : localColor;
  const penWidth = sessionDriven ? annotation.width : localWidth;
  const drawToolActive = tool === "pen" || tool === "highlighter" || tool === "pointer" || tool === "eraser";
  const toolsCaptureInput = showTools && drawToolActive && (canManage || !contentLocked || tool === "pointer");
  const effectivelyFollowing = canManage || (!localBrowsingAway && followingTeacher && !independent);

  const annotations = useMemo(
    () => (Array.isArray(state?.annotations) ? state.annotations : []),
    [state],
  );
  const teacherPage = Number(state?.page || 1);
  const page = localBrowsingAway && localPage != null ? localPage : teacherPage;
  const zoom = Number(state?.zoom || 1);
  const scroll = Number(state?.scroll || 0);

  const showImage = isImageUrl(url, kind);
  const showPdf = isPdfUrl(url, kind) && !isSpreadsheet;
  const frameSrc = viewerSrc(url, { page: teacherPage, showPdf });
  const showInteractive = Boolean(material?.interactiveId);
  const isHtmlLesson = Boolean(
    !showInteractive && !showImage && !showPdf && !isBoard && !isSpreadsheet && url
    && (kind === "embed" || kind === "link" || material?.htmlLesson),
  );

  // Teacher page change while browsing away → auto-return to teacher.
  useEffect(() => {
    if (canManage || !localBrowsingAway) return;
    setLocalBrowsingAway(false);
    setLocalPage(null);
    onFollowStatusChange?.(true);
    onFollowReturn?.();
  }, [teacherPage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLocalBrowsingAway(false);
    setLocalPage(null);
  }, [material?.openUrl, material?.interactiveId]);

  // Update PDF page via hash without remounting iframe.
  useEffect(() => {
    if (!showPdf || !iframeRef.current) return;
    const base = frameBaseKey(url);
    if (!base) return;
    try {
      const win = iframeRef.current.contentWindow;
      if (win) {
        // Same-origin preview APIs can take hash; cross-origin may throw — then reload src.
        try {
          const next = `${base}#page=${page}`;
          if (iframeRef.current.src !== next) {
            iframeRef.current.src = next;
          }
        } catch {
          iframeRef.current.src = `${base}#page=${page}`;
        }
      }
    } catch {
      /* ignore */
    }
  }, [page, showPdf, url]);

  const breakFollowAndNavigate = useCallback((nextPage) => {
    if (canManage || isCollaborative || independent) {
      if (remoteApplyGuard?.isRemote?.()) return;
      onStatePatch?.({ action: "page_changed", payload: { page: nextPage } });
      return;
    }
    if (!localBrowsingAway) {
      setLocalBrowsingAway(true);
      onFollowStatusChange?.(false);
      onFollowBreak?.();
    }
    setLocalPage(nextPage);
  }, [canManage, isCollaborative, independent, localBrowsingAway, onFollowBreak, onFollowStatusChange, onStatePatch, remoteApplyGuard]);

  const returnToTeacher = useCallback(() => {
    setLocalBrowsingAway(false);
    setLocalPage(null);
    onFollowStatusChange?.(true);
    onFollowReturn?.();
  }, [onFollowReturn, onFollowStatusChange]);

  // HTML lesson postMessage bridge — attached after iframe mounts via frameSrc effect below.

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

  // HTML lesson postMessage bridge
  useEffect(() => {
    if (!isHtmlLesson) {
      htmlBridgeRef.current?.destroy?.();
      htmlBridgeRef.current = null;
      return undefined;
    }
    const frame = iframeRef.current;
    if (!frame) return undefined;
    const bridge = createHtmlLessonBridge({
      iframe: frame,
      onEvent: (msg) => {
        if (remoteApplyGuard?.isRemote?.()) return;
        const op = htmlEventToMaterialOp(msg);
        if (!op) return;
        if (op.action === "field_changed" || op.action === "answer_selected") {
          onInteractiveOp?.(op);
        } else if (canManage || isCollaborative) {
          patchState(op.action, op.payload);
        } else if (op.action === "page_changed") {
          breakFollowAndNavigate(Number(op.payload?.page) || 1);
        }
      },
    });
    htmlBridgeRef.current = bridge;
    bridge.requestState();
    return () => {
      bridge.destroy();
      htmlBridgeRef.current = null;
    };
  }, [isHtmlLesson, url, canManage, isCollaborative, onInteractiveOp, patchState, remoteApplyGuard, breakFollowAndNavigate]);

  useEffect(() => {
    if (!htmlBridgeRef.current || !effectivelyFollowing) return;
    htmlBridgeRef.current.applyRemote({
      page: teacherPage,
      zoom,
      scroll,
      mode: isCollaborative ? "collaborative" : "follow",
      permissions: collaborationPermission,
    });
  }, [teacherPage, zoom, scroll, effectivelyFollowing, isCollaborative, collaborationPermission]);

  const materialKindForTransform = showImage ? "image" : showPdf ? "pdf" : kind;

  const refreshTransform = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      transformRef.current = null;
      return null;
    }
    const media = mediaRef.current || iframeRef.current || null;
    const tx = getMaterialViewportTransform({
      surfaceEl: surface,
      mediaEl: media,
      kind: materialKindForTransform,
      zoom,
    });
    transformRef.current = tx;
    if (tx?.renderedWidth && tx?.renderedHeight) {
      setSurfaceSize((prev) => {
        const next = {
          width: tx.renderedWidth,
          height: tx.renderedHeight,
          offsetX: tx.offsetX || 0,
          offsetY: tx.offsetY || 0,
          surfaceW: tx.surfaceRect?.width || tx.renderedWidth,
          surfaceH: tx.surfaceRect?.height || tx.renderedHeight,
        };
        if (
          Math.abs(prev.width - next.width) < 0.5
          && Math.abs(prev.height - next.height) < 0.5
          && Math.abs((prev.offsetX || 0) - next.offsetX) < 0.5
          && Math.abs((prev.offsetY || 0) - next.offsetY) < 0.5
        ) {
          return prev;
        }
        return next;
      });
    }
    return tx;
  }, [materialKindForTransform, zoom]);

  useEffect(() => {
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!stage && !surface) return undefined;
    refreshTransform();
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => { refreshTransform(); })
      : null;
    if (ro) {
      if (stage) ro.observe(stage);
      if (surface) ro.observe(surface);
      const media = mediaRef.current || iframeRef.current;
      if (media) ro.observe(media);
    }
    const onWin = () => refreshTransform();
    window.addEventListener("resize", onWin);
    window.visualViewport?.addEventListener("resize", onWin);
    window.visualViewport?.addEventListener("scroll", onWin);
    document.addEventListener("fullscreenchange", onWin);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onWin);
      window.visualViewport?.removeEventListener("resize", onWin);
      window.visualViewport?.removeEventListener("scroll", onWin);
      document.removeEventListener("fullscreenchange", onWin);
    };
  }, [refreshTransform, url, showImage, showPdf, showInteractive, isSpreadsheet, text, page]);

  const toNorm = useCallback((clientX, clientY) => {
    const tx = transformRef.current || refreshTransform();
    if (!tx) return null;
    return clientToContentNorm(clientX, clientY, tx);
  }, [refreshTransform]);

  const contentWidthForStroke = surfaceSize.width || transformRef.current?.renderedWidth || 1000;

  const finishStroke = useCallback(() => {
    const stroke = drawingRef.current;
    drawingRef.current = null;
    activePointerRef.current = null;
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

  const handlePointerMove = useCallback((e) => {
    if (!toolsCaptureInput) return;
    if (tool === "pointer") {
      const p = toNorm(e.clientX, e.clientY);
      if (!p) return;
      setLocalPointer(p);
      if (canManage) onSendPointer?.(p.x, p.y);
      else onSendCursor?.(p.x, p.y);
      return;
    }
    if (!isMatchingActivePointer(e, activePointerRef.current)) return;
    if ((e.pointerType === "mouse" || e.pointerType === "pen") && !isStrokePointerHeld(e, activePointerRef.current)) {
      activePointerRef.current = null;
      finishStroke();
      return;
    }
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    if (tool === "pen" || tool === "highlighter" || tool === "eraser") {
      onSendCursor?.(p.x, p.y);
    }
    if (!drawingRef.current) return;
    if (tool === "eraser") return;
    const last = drawingRef.current.points[drawingRef.current.points.length - 1];
    if (last && last[0] === p.x && last[1] === p.y) return;
    drawingRef.current.points.push([p.x, p.y]);
    const stroke = {
      ...drawingRef.current,
      points: drawingRef.current.points.slice(),
    };
    setLocalStroke(stroke);
    onDrawPreview?.(stroke);
  }, [canManage, finishStroke, onDrawPreview, onSendCursor, onSendPointer, toNorm, tool, toolsCaptureInput]);

  const handlePointerDown = useCallback((e) => {
    if (!toolsCaptureInput) return;
    if (tool !== "pen" && tool !== "highlighter" && tool !== "pointer" && tool !== "eraser") return;
    if (shouldIgnorePointerDown(e)) return;
    if (activePointerRef.current != null) return;
    refreshTransform();
    const p = toNorm(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    activePointerRef.current = e.pointerId;
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
        const thresh = isContentCoordSpace(ann)
          ? Math.max(0.012, Number(ann.width) || 0.003)
          : Math.max(0.015, (Number(ann.width) || 3) / 400);
        return strokeNearPoint(ann, p.x, p.y, thresh);
      });
      if (hit?.id) {
        onEraseAnnotation?.(hit);
        undoStackRef.current.push({ type: "delete", annotation: hit });
        redoStackRef.current = [];
      }
      activePointerRef.current = null;
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }
    const uiWidth = tool === "highlighter" ? Math.max(12, penWidth * 3) : penWidth;
    const normWidth = pxWidthToNorm(uiWidth, contentWidthForStroke);
    const stroke = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tool: tool === "highlighter" ? "highlighter" : "pen",
      color: tool === "highlighter" ? "rgba(250, 204, 21, 0.55)" : penColor,
      width: normWidth,
      coordSpace: COORD_SPACE_CONTENT_V1,
      points: [[p.x, p.y]],
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
    contentWidthForStroke,
    currentUserId,
    onDrawPreview,
    onEraseAnnotation,
    onSendPointer,
    page,
    penColor,
    penWidth,
    refreshTransform,
    toNorm,
    tool,
    toolsCaptureInput,
  ]);

  const handlePointerUp = useCallback((e) => {
    if (activePointerRef.current != null && e?.pointerId !== activePointerRef.current) return;
    try {
      e?.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    finishStroke();
  }, [finishStroke]);

  useEffect(() => {
    if (!toolsCaptureInput) return undefined;
    const abortStroke = () => {
      if (!drawingRef.current && activePointerRef.current == null) return;
      finishStroke();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") abortStroke();
    };
    window.addEventListener("blur", abortStroke);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", abortStroke);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [finishStroke, toolsCaptureInput]);

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

  // Student → teacher: report visible content viewport (normalized).
  useEffect(() => {
    if (canManage || !onSendStudentViewport) return undefined;
    let timer = null;
    const emit = () => {
      const stage = stageRef.current;
      const surface = surfaceRef.current;
      if (!stage || !surface) return;
      refreshTransform();
      const viewport = getVisibleContentViewport(stage, surface);
      onSendStudentViewport({
        materialId: material?.id || material?.materialId || null,
        page,
        viewport,
        zoom,
        following: Boolean(effectivelyFollowing && !localBrowsingAway),
        scroll,
      });
    };
    const schedule = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = null;
        emit();
      }, VIEWPORT_THROTTLE_MS);
    };
    emit();
    const stage = stageRef.current;
    stage?.addEventListener("scroll", schedule, { passive: true });
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(schedule)
      : null;
    if (ro && stage) ro.observe(stage);
    if (ro && surfaceRef.current) ro.observe(surfaceRef.current);
    window.addEventListener("resize", schedule);
    return () => {
      if (timer) window.clearTimeout(timer);
      stage?.removeEventListener("scroll", schedule);
      ro?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [
    canManage,
    effectivelyFollowing,
    localBrowsingAway,
    material?.id,
    material?.materialId,
    onSendStudentViewport,
    page,
    refreshTransform,
    scroll,
    zoom,
    url,
    surfaceSize.width,
    surfaceSize.height,
  ]);

  const studentOptions = useMemo(() => {
    return (presence || [])
      .filter((p) => {
        const role = String(p.role || p.authorRole || p.author_role || "").toLowerCase();
        if (role === "teacher" || role === "staff" || role === "coteacher") return false;
        if (currentUserId != null && Number(p.userId ?? p.user_id) === Number(currentUserId)) return false;
        return role === "student" || !role;
      })
      .map((p) => ({
        id: String(p.userId ?? p.user_id ?? p.authorId ?? ""),
        name: p.displayName || p.display_name || "Ученик",
        following: p.following !== false,
      }))
      .filter((p) => p.id);
  }, [presence, currentUserId]);

  useEffect(() => {
    if (!canManage) return;
    if (selectedStudentId && studentOptions.some((s) => s.id === selectedStudentId)) return;
    if (studentOptions.length) setSelectedStudentId(studentOptions[0].id);
    else setSelectedStudentId("");
  }, [canManage, selectedStudentId, studentOptions]);

  const selectedStudentViewport = selectedStudentId
    ? studentViewports?.[selectedStudentId] || null
    : null;
  const selectedStudentMeta = studentOptions.find((s) => s.id === selectedStudentId) || null;
  const selectedFollowing = selectedStudentViewport?.following
    ?? selectedStudentMeta?.following
    ?? true;

  const studentPreviewStyle = useMemo(() => {
    if (!canManage || !studentPreviewMode || !selectedStudentViewport?.viewport) return undefined;
    const vp = selectedStudentViewport.viewport;
    const left = Number(vp.left) || 0;
    const top = Number(vp.top) || 0;
    const width = Math.max(0.05, Number(vp.width) || 1);
    const height = Math.max(0.05, Number(vp.height) || 1);
    const scale = Math.min(1 / width, 1 / height);
    return {
      transform: `scale(${scale}) translate(${-left * 100}%, ${-top * 100}%)`,
      transformOrigin: "top left",
    };
  }, [canManage, studentPreviewMode, selectedStudentViewport]);

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
      }, THROTTLE.ANSWER_DEBOUNCE_MS));
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
        typeLabel={resourceTypeLabel(isSpreadsheet ? "spreadsheet" : kind)}
        interactionMode={interactionMode}
        followPolicy={followPolicy}
        syncStatus={syncStatus}
        collaborative={isCollaborative}
        collaborationPermission={collaborationPermission}
        isController={isController}
        controllerLabel={controllerLabel}
        localBrowsingAway={localBrowsingAway}
        onToggleCollaborative={onToggleCollaborative}
        onConfigurePermissions={onConfigurePermissions}
        onAllowIndependent={onAllowIndependent}
        onReturnToLeader={canManage ? onReturnToLeader : returnToTeacher}
        onTransferControl={onTransferControl}
        onClose={onCloseForAll}
        notice={notice || (localBrowsingAway && !canManage ? "Вы временно не следуете за учителем" : "")}
        presenceLabel={presenceLabel}
        capabilities={capabilities}
        tools={(showTools && !annotation) || canNavigate ? (
          <div className="vl-collab-tools" role="toolbar" aria-label="Инструменты">
            {showTools && !annotation ? (
              <>
                <button type="button" className={tool === "hand" ? "is-active" : ""} onClick={() => setLocalTool("hand")} title="Курсор / просмотр">Курсор</button>
                <button type="button" className={tool === "pointer" ? "is-active" : ""} onClick={() => setLocalTool("pointer")} title="Указка">Указка</button>
                <button type="button" className={tool === "pen" ? "is-active" : ""} disabled={contentLocked && !canManage} onClick={() => setLocalTool("pen")} title="Перо">Перо</button>
                <button type="button" className={tool === "eraser" ? "is-active" : ""} disabled={contentLocked && !canManage} onClick={() => setLocalTool("eraser")} title="Ластик">Ластик</button>
                <label className="vl-collab-tools__color" title="Цвет">
                  <span className="vl-collab-tools__swatches">
                    {PEN_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`vl-swatch${penColor === c ? " is-active" : ""}`}
                        style={{ background: c }}
                        aria-label={c}
                        onClick={() => { setLocalColor(c); setCustomColor(c); setLocalTool("pen"); }}
                      />
                    ))}
                  </span>
                  <input
                    type="color"
                    value={customColor.startsWith("#") ? customColor : "#e11d48"}
                    onChange={(e) => {
                      setCustomColor(e.target.value);
                      setLocalColor(e.target.value);
                      setLocalTool("pen");
                    }}
                    aria-label="Свой цвет"
                  />
                </label>
                <label className="vl-collab-tools__width" title="Толщина">
                  <select
                    value={penWidth}
                    onChange={(e) => setLocalWidth(Number(e.target.value) || 3)}
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
              </>
            ) : null}
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
      {sessionDriven ? (
        <div className="ann-toolbar-slot">
          <AnnotationToolbar
            tool={annotation.tool}
            color={annotation.color}
            width={annotation.width}
            canAnnotate={!(contentLocked && !canManage)}
            canManage={canManage}
            canUndo={undoStackRef.current.length > 0}
            canRedo={redoStackRef.current.length > 0}
            compact={false}
            onToolChange={annotation.setTool}
            onColorChange={annotation.setColor}
            onWidthChange={annotation.setWidth}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onClearMine={onClearOwnAnnotations}
            showShapes={false}
          />
        </div>
      ) : null}
      {canManage && studentOptions.length > 0 ? (
        <div className="vl-student-viewport-bar" role="group" aria-label="Область просмотра ученика">
          <label className="vl-student-viewport-bar__select">
            Ученик:
            <select
              value={selectedStudentId}
              onChange={(e) => {
                setSelectedStudentId(e.target.value);
                setStudentPreviewMode(false);
              }}
            >
              {studentOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="vl-student-viewport-bar__check">
            <input
              type="checkbox"
              checked={showStudentViewport}
              onChange={(e) => setShowStudentViewport(e.target.checked)}
            />
            Показать область ученика
          </label>
          <button
            type="button"
            className={`vl-student-viewport-bar__preview${studentPreviewMode ? " is-active" : ""}`}
            onClick={() => setStudentPreviewMode((v) => !v)}
            disabled={!selectedStudentViewport?.viewport}
          >
            {studentPreviewMode ? "Обычный вид" : "Как видит ученик"}
          </button>
          {selectedStudentMeta ? (
            <span className="vl-student-viewport-bar__status">
              {selectedFollowing
                ? `${selectedStudentMeta.name} следует за вами`
                : `${selectedStudentMeta.name} смотрит самостоятельно`}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className={`video-lesson-workspace__stage${contentLocked ? " is-locked" : ""}${cursorClass}${isBoard ? " video-lesson-workspace__stage--board" : ""}${studentPreviewMode ? " is-student-preview" : ""}`}
        ref={stageRef}
      >
        <div
          className={`vl-synced-content${toolsCaptureInput ? " is-tools-active" : ""}`}
          style={
            studentPreviewStyle
              || (zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: "top center" } : undefined)
          }
          ref={interactiveRootRef}
        >
          <div
            className={`vl-material-surface${showImage ? " vl-material-surface--image" : " vl-material-surface--fill"}`}
            ref={surfaceRef}
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
            ) : isSpreadsheet ? (
              <SpreadsheetMaterialView
                url={url}
                state={state}
                canEdit={canManage || (isCollaborative && ["edit_content", "full"].includes(collaborationPermission))}
                onCellUpdate={(payload) => patchState("cell_updated", payload)}
                onSheetChange={(sheetId) => patchState("sheet_changed", { sheetId })}
                onSelectionChange={(payload) => patchState("selection_changed", payload)}
                remoteApplyGuard={remoteApplyGuard}
              />
            ) : text && !url ? (
              <div className="video-lesson-workspace__text">{text}</div>
            ) : showImage && url ? (
              <img
                ref={mediaRef}
                src={url}
                alt={material?.title || ""}
                className="vl-synced-image"
                draggable={false}
                onLoad={() => refreshTransform()}
              />
            ) : frameSrc ? (
              <iframe
                ref={(el) => {
                  iframeRef.current = el;
                  mediaRef.current = el;
                }}
                key={frameBaseKey(frameSrc)}
                title={material?.title || "Материал"}
                src={frameSrc}
                className={`video-lesson-workspace__frame${isBoard ? " video-lesson-workspace__frame--board" : ""}`}
                allow="camera; microphone; display-capture; autoplay; clipboard-read; clipboard-write; fullscreen"
              />
            ) : (
              <div className="vl-empty">
                <p className="vl-empty__title">Материал недоступен</p>
                <p className="vl-empty__text">Файл нельзя открыть напрямую. Закройте и откройте материал снова.</p>
              </div>
            )}

            <svg className="vl-synced-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
              {allStrokes
                .filter((a) => !a.page || Number(a.page) === page)
                .map((ann) => {
                  const tx = transformRef.current;
                  const pts = (ann.points || [])
                    .filter((p) => Array.isArray(p) && p.length >= 2)
                    .map((p) => {
                      const mapped = contentNormToSurfaceNorm(Number(p[0]), Number(p[1]), tx);
                      return `${mapped.x},${mapped.y}`;
                    })
                    .join(" ");
                  if (!pts) return null;
                  const px = resolveStrokeWidthPx(ann, surfaceSize.width);
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
              {canManage && showStudentViewport && selectedStudentViewport?.viewport
              && (!selectedStudentViewport.page || Number(selectedStudentViewport.page) === page) ? (
                <rect
                  className="vl-student-viewport-frame"
                  x={Number(selectedStudentViewport.viewport.left) || 0}
                  y={Number(selectedStudentViewport.viewport.top) || 0}
                  width={Math.max(0.02, Number(selectedStudentViewport.viewport.width) || 0)}
                  height={Math.max(0.02, Number(selectedStudentViewport.viewport.height) || 0)}
                  fill="none"
                  stroke="rgba(37, 99, 235, 0.85)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>

            {canManage && showStudentViewport && selectedStudentViewport?.viewport
            && (!selectedStudentViewport.page || Number(selectedStudentViewport.page) === page) ? (
              <div
                className="vl-student-viewport-label"
                style={{
                  left: `${(Number(selectedStudentViewport.viewport.left) || 0) * 100}%`,
                  top: `${(Number(selectedStudentViewport.viewport.top) || 0) * 100}%`,
                }}
              >
                Видимая область: {selectedStudentMeta?.name || "ученик"}
              </div>
            ) : null}

            {localPointer && tool === "pointer" ? (
              <div
                className="vl-local-pointer"
                style={(() => {
                  const mapped = contentNormToSurfaceNorm(localPointer.x, localPointer.y, transformRef.current);
                  return { left: `${mapped.x * 100}%`, top: `${mapped.y * 100}%` };
                })()}
                aria-hidden="true"
              />
            ) : null}
            {remoteCursors.map((cursor) => {
              const mapped = contentNormToSurfaceNorm(cursor.x, cursor.y, transformRef.current);
              return (
                <div
                  key={cursor.clientId || cursor.authorId || `${cursor.x}-${cursor.y}`}
                  className={`vl-remote-cursor ${roleCursorClass(cursor.authorRole || cursor.role)}`}
                  style={{ left: `${mapped.x * 100}%`, top: `${mapped.y * 100}%` }}
                  aria-hidden="true"
                >
                  <span className="vl-remote-cursor__dot" />
                  <span className="vl-remote-cursor__label">{cursor.displayName || "Участник"}</span>
                </div>
              );
            })}
            {toolsCaptureInput ? (
              <div
                ref={hitRef}
                className={`vl-synced-hit vl-synced-hit--${tool}`}
                style={{
                  left: surfaceSize.offsetX || 0,
                  top: surfaceSize.offsetY || 0,
                  width: surfaceSize.width,
                  height: surfaceSize.height,
                  right: "auto",
                  bottom: "auto",
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onLostPointerCapture={handlePointerUp}
                role="presentation"
              />
            ) : null}
          </div>
          {!canManage && localBrowsingAway ? (
            <div className="vl-follow-banner" role="status">
              <span>Вы временно не следуете за учителем</span>
              <button type="button" className="video-lesson-btn video-lesson-btn--primary" onClick={returnToTeacher}>
                Вернуться к учителю
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

