import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CircleHelp, Maximize, MessageSquare, Minus, PanelLeft, Plus, X } from "lucide-react";
import { openMaterialPdf } from "../materials/collab/pdfjsLoader";
import EducationalLoading, { LOADING_MESSAGES } from "../../components/EducationalLoading";
import NotebookCanvas from "./NotebookCanvas";
import MathContent from "../../components/MathContent";
import NotebookPagesDrawer from "./NotebookPagesDrawer";
import NotebookReviewPanel from "./NotebookReviewPanel";
import NotebookToolbar from "./NotebookToolbar";
import { createHistory, pagesCommand, replaceAnnotationsCommand } from "./notebookHistory";
import {
  ERASER_MODE,
  TOOL,
  cloneAnnotation,
  createAnnotation,
  normalizeAnnotation,
  pageAnnotations,
  setPageAnnotations,
  toPersistedAnnotation,
} from "./notebookModel";
import { exportNotebookBlobs } from "./notebookExport";
import {
  addHomeworkNotebookPage,
  completeHomeworkNotebook,
  deleteHomeworkNotebookPage,
  fetchHomeworkNotebook,
  fetchPublishedNotebook,
  saveHomeworkNotebook,
  uploadNotebookPageBackground,
} from "./notebookApi";
import { hasMod, isTypingTarget, shortcutLabel, useEditorShortcuts } from "./useEditorShortcuts";
import { placeReviewContent } from "./notebookPlacement";
import {
  flushNotebookForPublish,
  localNotebookFile,
  NOTEBOOK_VERSION_CONFLICT,
  registerNotebookFlush,
  saveNotebookLatest,
  UNSAVED_CLOSE_WARNING,
} from "./notebookPublishGate";

const HINT_KEY = "itflux.notebook.hint.space";
const CLIP_KEY = "itflux.notebook.clipboard";
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

function pageSourceMeta(page) {
  const source = page?.source_attachment;
  const url = page?.background_url || source?.url || "";
  const mime = String(source?.mime_type || source?.content_type || "").toLowerCase();
  const filename = String(source?.filename || source?.name || "");
  const isPdf = page?.page_type === "pdf_page" || mime === "application/pdf" || /\.pdf($|\?)/i.test(filename);
  const isImage = Boolean(page?.background_url)
    || mime.startsWith("image/")
    || /\.(jpe?g|png|webp|gif|bmp|heic|heif)($|\?)/i.test(filename || url);
  return { url, mime, filename, isPdf, isImage };
}

function persistPages(pages) {
  return (pages || []).map((page) => ({
    ...page,
    state: {
      ...(page.state || {}),
      version: 1,
      objects: pageAnnotations(page).map((obj) => toPersistedAnnotation(normalizeAnnotation(obj, page.id))),
      viewport: page.state?.viewport || undefined,
    },
  }));
}

export default function HomeworkNotebookEditor({
  notebookId: notebookIdProp,
  publishedPayload,
  initialDocument,
  onClose,
  onComplete,
}) {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const notebookId = notebookIdProp || params.notebookId;
  const publishedMode = searchParams.get("published") === "1" || Boolean(publishedPayload);
  const [doc, setDoc] = useState(publishedPayload?.document || initialDocument || null);
  const [pageIndex, setPageIndex] = useState(0);
  const [tool, setTool] = useState(TOOL.PEN);
  const [color, setColor] = useState("#DC2626");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [opacity, setOpacity] = useState(1);
  const [fontSize, setFontSize] = useState(24);
  const [smoothing, setSmoothing] = useState(1);
  const [eraserMode, setEraserMode] = useState(ERASER_MODE.STROKE);
  const [selectedIds, setSelectedIds] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fit, setFit] = useState(true);
  const [saveState, setSaveState] = useState("saved");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [readyImages, setReadyImages] = useState({});
  const [helpOpen, setHelpOpen] = useState(false);
  const [hint, setHint] = useState(() => {
    try { return localStorage.getItem(HINT_KEY) !== "1"; } catch { return false; }
  });
  const [spacePan, setSpacePan] = useState(false);
  const [editingText, setEditingText] = useState(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const historyRef = useRef(createHistory());
  const dirtyRef = useRef(false);
  const docRef = useRef(doc);
  const saveTimer = useRef(null);
  const saveInFlight = useRef(false);
  const saveAgain = useRef(false);
  const saveWaiters = useRef([]);
  const saveSnapshot = useRef(false);
  const liveCommitRef = useRef(null);
  const conflictDocRef = useRef(null);
  const flushPendingRef = useRef(async () => docRef.current);
  const pdfCache = useRef(new Map());
  const stageRef = useRef(null);
  const prevToolRef = useRef(TOOL.PEN);
  const clipboardRef = useRef([]);
  const placedNotebookRef = useRef("");
  const placeLoadedRef = useRef(async () => {});

  const readOnly = Boolean(doc?.readonly || publishedMode || publishedPayload);
  const pages = doc?.pages || [];
  const page = pages[pageIndex] || pages[0];
  const objects = pageAnnotations(page).map((obj) => normalizeAnnotation(obj, page?.id));
  const selected = objects.find((obj) => obj.id === selectedIds[0]) || null;

  const syncHistoryButtons = () => {
    setCanUndo(historyRef.current.canUndo());
    setCanRedo(historyRef.current.canRedo());
  };

  const load = useCallback(async () => {
    if (publishedPayload?.document) {
      const next = { ...publishedPayload.document, readonly: true };
      docRef.current = next;
      setDoc(next);
      return;
    }
    const data = await fetchHomeworkNotebook(notebookId);
    if (data.published && data.document) {
      const next = { ...data.document, readonly: true, published: true };
      docRef.current = next;
      setDoc(next);
      return;
    }
    docRef.current = data;
    setDoc(data);
    setSaveState("saved");
    if (data?.owner_role !== "student" && !data.readonly && !data.published) {
      void placeLoadedRef.current(data);
    }
  }, [notebookId, publishedPayload]);

  useEffect(() => {
    load().catch((err) => setError(err.message || "Не удалось открыть тетрадь"));
  }, [load]);

  useEffect(() => {
    const { body } = document;
    body.classList.add("hw-notebook-open");
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.classList.remove("hw-notebook-open");
      body.style.overflow = prevOverflow;
    };
  }, []);

  const flushSave = useCallback(async (nextDoc = docRef.current, { snapshot = false } = {}) => {
    if (readOnly || !nextDoc?.id) return nextDoc;
    if (nextDoc) {
      docRef.current = {
        ...nextDoc,
        version: docRef.current?.version ?? nextDoc.version,
      };
    }
    saveAgain.current = true;
    if (snapshot) saveSnapshot.current = true;
    if (saveInFlight.current) {
      return new Promise((resolve, reject) => {
        saveWaiters.current.push({ resolve, reject });
      });
    }
    saveInFlight.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    setSaveState("saving");
    const finishWaiters = (ok, value) => {
      const waiters = saveWaiters.current.splice(0);
      waiters.forEach((waiter) => (ok ? waiter.resolve(value) : waiter.reject(value)));
    };
    const showSaveError = (err) => {
      setSaveState("error");
      if (err?.code === "version_conflict") {
        setConflict(true);
        setError(NOTEBOOK_VERSION_CONFLICT);
        return;
      }
      setError(err?.message || "Ошибка сохранения");
    };
    try {
      const saved = await saveNotebookLatest({
        readLatest: () => docRef.current,
        hasPending: () => Boolean(saveAgain.current || saveTimer.current),
        clearPending: () => {
          saveAgain.current = false;
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        },
        onConflict: (err) => {
          const serverDoc = err?.data?.document;
          if (serverDoc && Array.isArray(serverDoc.pages)) conflictDocRef.current = serverDoc;
        },
        save: async (payload) => {
          const result = await saveHomeworkNotebook(payload.id, {
            version: payload.version,
            pages: persistPages(payload.pages),
            reason: saveSnapshot.current ? "manual_save" : "autosave",
            snapshot: saveSnapshot.current,
          });
          const version = Number(result?.version);
          const merged = { ...(docRef.current || payload), version };
          docRef.current = merged;
          setDoc((prev) => (prev ? { ...prev, version } : merged));
          return merged;
        },
      });
      dirtyRef.current = Boolean(saveAgain.current || saveTimer.current);
      if (!dirtyRef.current) {
        saveSnapshot.current = false;
        setSaveState("saved");
        setConflict(false);
        conflictDocRef.current = null;
        setError("");
      }
      finishWaiters(true, saved);
      return saved;
    } catch (err) {
      showSaveError(err);
      finishWaiters(false, err);
      if (err?.code === "version_conflict") {
        saveAgain.current = false;
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      throw err;
    } finally {
      saveInFlight.current = false;
      if (saveAgain.current || saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          flushSave(docRef.current).catch(() => {});
        }, 0);
      }
    }
  }, [readOnly]);

  const scheduleSave = useCallback((nextDoc) => {
    if (readOnly || !nextDoc?.id) return;
    dirtyRef.current = true;
    docRef.current = {
      ...nextDoc,
      version: docRef.current?.version ?? nextDoc.version,
    };
    setSaveState("saving");
    if (saveInFlight.current) {
      saveAgain.current = true;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      return;
    }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      flushSave(docRef.current).catch(() => {});
    }, 800);
  }, [flushSave, readOnly]);

  const flushPending = useCallback(() => flushNotebookForPublish({
    commitLive: () => liveCommitRef.current?.(),
    save: async () => {
      const current = docRef.current;
      if (readOnly || !current?.id) return current;
      const pending = dirtyRef.current || saveInFlight.current || saveAgain.current || saveTimer.current;
      if (!pending) return current;
      return flushSave(current);
    },
  }), [flushSave, readOnly]);
  flushPendingRef.current = flushPending;

  useEffect(() => registerNotebookFlush(() => flushPendingRef.current()), []);

  const applyDoc = (nextDoc, { history = null, save = true } = {}) => {
    const stamped = {
      ...nextDoc,
      version: docRef.current?.version ?? nextDoc.version,
    };
    if (history) historyRef.current.push(history);
    docRef.current = stamped;
    setDoc(stamped);
    syncHistoryButtons();
    if (save) scheduleSave(stamped);
  };

  placeLoadedRef.current = async (next) => {
    if (!next?.id || next.readonly || next.owner_role === "student") return;
    if (placedNotebookRef.current === next.id) return;
    placedNotebookRef.current = next.id;
    setTool(TOOL.SELECT);
    let placed = null;
    try {
      placed = await placeReviewContent(docRef.current?.id === next.id ? docRef.current : next);
    } catch {
      placedNotebookRef.current = "";
      return;
    }
    if (!placed?.doc || docRef.current?.id !== next.id) return;
    const latest = docRef.current;
    const byId = new Map((latest.pages || []).map((item) => [item.id, item]));
    const pages = placed.doc.pages.map((page) => {
      const current = byId.get(page.id) || page;
      const currentObjects = pageAnnotations(current);
      const known = new Set(currentObjects.map((obj) => obj.id));
      const added = pageAnnotations(page).filter((obj) => (
        obj?.sourceKey
        && !known.has(obj.id)
        && !currentObjects.some((item) => item.sourceKey === obj.sourceKey)
      ));
      if (!added.length) return current;
      return {
        ...current,
        state: {
          ...(current.state || {}),
          contentPlaced: Boolean(page.state?.contentPlaced),
          objects: [...currentObjects, ...added],
        },
      };
    });
    if (pages.every((page, index) => page === (latest.pages || [])[index])) return;
    applyDoc({ ...latest, answer_text: latest.answer_text || next.answer_text || "", pages }, { save: true });
    if (placed.selectId) setSelectedIds([placed.selectId]);
  };

  const commitObjects = (nextObjects, historyType = "UPDATE_ANNOTATION") => {
    if (!doc || !page) return;
    const before = pageAnnotations(page);
    const nextDoc = setPageAnnotations(doc, page.id, nextObjects);
    applyDoc(nextDoc, { history: replaceAnnotationsCommand(page.id, before, nextObjects, historyType) });
  };

  const handleUndo = () => {
    const next = historyRef.current.undo(doc);
    applyDoc(next);
    setSelectedIds([]);
  };
  const handleRedo = () => {
    const next = historyRef.current.redo(doc);
    applyDoc(next);
  };

  const selectedObjects = () => objects.filter((obj) => selectedIds.includes(obj.id));

  const deleteSelected = () => {
    if (!selectedIds.length || editingText) return;
    commitObjects(objects.filter((obj) => !selectedIds.includes(obj.id)), "DELETE_ANNOTATION");
    setSelectedIds([]);
  };

  const copySelected = async () => {
    const items = selectedObjects().map((obj) => toPersistedAnnotation(obj));
    clipboardRef.current = items;
    try { sessionStorage.setItem(CLIP_KEY, JSON.stringify(items)); } catch { /* ignore */ }
  };

  const pasteClipboard = () => {
    let items = clipboardRef.current;
    try {
      const raw = sessionStorage.getItem(CLIP_KEY);
      if (raw) items = JSON.parse(raw);
    } catch { /* ignore */ }
    if (!items?.length) return;
    const cloned = items.map((obj) => cloneAnnotation({ ...obj, pageId: page.id }));
    commitObjects([...objects, ...cloned], "ADD_ANNOTATION");
    setSelectedIds(cloned.map((obj) => obj.id));
  };

  const duplicateSelected = () => {
    const cloned = selectedObjects().map((obj) => cloneAnnotation(obj));
    if (!cloned.length) return;
    commitObjects([...objects, ...cloned], "ADD_ANNOTATION");
    setSelectedIds(cloned.map((obj) => obj.id));
  };

  const nudge = (dx, dy) => {
    if (!selectedIds.length) return;
    commitObjects(objects.map((obj) => {
      if (!selectedIds.includes(obj.id)) return obj;
      const next = { ...obj };
      if (next.points) next.points = next.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy }));
      if (next.x != null) next.x += dx;
      if (next.y != null) next.y += dy;
      if (next.x1 != null) { next.x1 += dx; next.y1 += dy; next.x2 += dx; next.y2 += dy; }
      if (next.cx != null) { next.cx += dx; next.cy += dy; }
      return next;
    }), "MOVE_ANNOTATIONS");
  };

  const setToolSafe = (next) => {
    if (next !== TOOL.HAND) prevToolRef.current = next;
    setTool(next);
    if (next !== TOOL.SELECT) setSelectedIds([]);
    if (next === TOOL.MARKER && opacity > 0.35) setOpacity(0.28);
    if (next === TOOL.PEN && opacity < 0.5) setOpacity(1);
    if (next === TOOL.MARKER && strokeWidth < 8) setStrokeWidth(16);
  };

  const clampZoom = (value) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
  const zoomBy = (factor, origin) => {
    setFit(false);
    setZoom((current) => {
      const next = clampZoom(current * factor);
      if (origin && stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect();
        const cx = origin.x - rect.left - rect.width / 2;
        const cy = origin.y - rect.top - rect.height / 2;
        const k = next / current;
        setPan((p) => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
      }
      return next;
    });
  };

  const fitPage = () => {
    setFit(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleShortcut = (event, phase) => {
    if (phase === "up") {
      if (event.code === "Space") setSpacePan(false);
      return;
    }
    const typing = isTypingTarget(event.target) || Boolean(editingText);
    if (event.code === "Space" && !event.repeat && !typing) {
      event.preventDefault();
      setSpacePan(true);
      return;
    }
    if (event.key === "Escape") {
      setHelpOpen(false);
      setPagesOpen(false);
      setSelectedIds([]);
      setEditingText(null);
      return;
    }
    if (typing && !hasMod(event) && event.key !== "Escape") return;
    const key = event.key.toLowerCase();
    if (hasMod(event) && key === "s") {
      event.preventDefault();
      flushSave(docRef.current, { snapshot: true }).catch(() => {});
      return;
    }
    if (hasMod(event) && key === "z") {
      event.preventDefault();
      if (event.shiftKey) handleRedo();
      else handleUndo();
      return;
    }
    if (hasMod(event) && key === "y") {
      event.preventDefault();
      handleRedo();
      return;
    }
    if (hasMod(event) && key === "a") {
      event.preventDefault();
      setSelectedIds(objects.map((obj) => obj.id));
      setTool(TOOL.SELECT);
      return;
    }
    if (hasMod(event) && key === "c") { event.preventDefault(); copySelected(); return; }
    if (hasMod(event) && key === "x") { event.preventDefault(); copySelected(); deleteSelected(); return; }
    if (hasMod(event) && key === "v") { event.preventDefault(); pasteClipboard(); return; }
    if (hasMod(event) && key === "d") { event.preventDefault(); duplicateSelected(); return; }
    if (hasMod(event) && key === "0") { event.preventDefault(); fitPage(); return; }
    if (hasMod(event) && key === "1") { event.preventDefault(); setFit(false); setZoom(1); setPan({ x: 0, y: 0 }); return; }
    if (hasMod(event) && event.shiftKey && key === "f") {
      event.preventDefault();
      const el = document.querySelector(".hw-notebook");
      if (!document.fullscreenElement) el?.requestFullscreen?.();
      else document.exitFullscreen?.();
      return;
    }
    if (typing) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); return; }
    if (event.key === "[") { event.preventDefault(); setStrokeWidth((w) => Math.max(1, w - 1)); return; }
    if (event.key === "]") { event.preventDefault(); setStrokeWidth((w) => Math.min(36, w + 1)); return; }
    if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomBy(0.9); return; }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(1.1); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); nudge(event.shiftKey ? -10 : -1, 0); return; }
    if (event.key === "ArrowRight") { event.preventDefault(); nudge(event.shiftKey ? 10 : 1, 0); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); nudge(0, event.shiftKey ? -10 : -1); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); nudge(0, event.shiftKey ? 10 : 1); return; }
    const tools = { v: TOOL.SELECT, h: TOOL.HAND, p: TOOL.PEN, m: TOOL.MARKER, e: TOOL.ERASER, t: TOOL.TEXT, l: TOOL.LINE, a: TOOL.ARROW, r: TOOL.RECT, o: TOOL.ELLIPSE };
    if (tools[key] && !hasMod(event)) {
      event.preventDefault();
      setToolSafe(tools[key]);
    }
  };

  useEditorShortcuts(handleShortcut, { enabled: Boolean(doc) });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      zoomBy(event.deltaY > 0 ? 0.92 : 1.08, { x: event.clientX, y: event.clientY });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const saveLocalSeparately = () => {
    const file = localNotebookFile(docRef.current);
    const blob = new Blob([file.body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const reloadServerNotebook = async () => {
    setBusy(true);
    try {
      const cached = conflictDocRef.current;
      const next = cached?.pages
        ? cached
        : await fetchHomeworkNotebook(docRef.current?.id || notebookId);
      const document = next?.document?.pages ? next.document : next;
      docRef.current = document;
      setDoc(document);
      dirtyRef.current = false;
      saveAgain.current = false;
      conflictDocRef.current = null;
      historyRef.current = createHistory();
      syncHistoryButtons();
      setSelectedIds([]);
      setConflict(false);
      setError("");
      setSaveState("saved");
    } catch (err) {
      setError(err?.message || "Не удалось обновить тетрадь");
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async () => {
    if (!readOnly) {
      try {
        await flushPending();
      } catch {
        const leave = window.confirm(UNSAVED_CLOSE_WARNING);
        if (!leave) return;
      }
    }
    onClose?.();
    if (!onClose) navigate(-1);
  };

  const handleDone = async () => {
    if (readOnly || !doc) return;
    setBusy(true);
    setError("");
    try {
      liveCommitRef.current?.();
      const saved = await flushSave(docRef.current, { snapshot: true });
      const blobs = await exportNotebookBlobs(saved.pages || doc.pages, {
        backgroundUrlForPage: (item) => item.background_url || item.source_attachment?.url || "",
      });
      const fd = new FormData();
      fd.append("version", String(saved.version ?? doc.version));
      blobs.forEach((blob, index) => {
        fd.append("pages", blob, `page-${index + 1}.jpg`);
      });
      const result = await completeHomeworkNotebook(doc.id, fd);
      setSaveState("saved");
      dirtyRef.current = false;
      onComplete?.(result);
      if (!onComplete) {
        try {
          sessionStorage.setItem("homework-notebook-complete", JSON.stringify({
            submissionId: result.submission_id,
            taskId: result.task_id,
            attachment: result.attachment,
            task_attachments: result.task_attachments,
          }));
        } catch { /* ignore */ }
      }
      if (onClose) onClose();
      else navigate(-1);
    } catch (err) {
      setError(err.message || "Не удалось завершить проверку");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onLeave = (event) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const background = pageSourceMeta(page);
  const backgroundUrl = background.url;
  const isPdf = background.isPdf;
  const placedImageReady = objects.some((obj) => obj.type === "image" && readyImages[obj.id]);
  const isImage = background.isImage && !placedImageReady;
  const saveStatus = saveState === "saving" ? LOADING_MESSAGES.save : saveState === "error" ? "Ошибка сохранения" : "Сохранено";

  const onAddPage = async (kind, file) => {
    if (readOnly) return;
    setBusy(true);
    try {
      await flushSave().catch(() => {});
      const data = file
        ? await addHomeworkNotebookPage(docRef.current.id, { page_type: "attachment" }, file)
        : await addHomeworkNotebookPage(docRef.current.id, kind);
      docRef.current = data.document;
      setDoc(data.document);
      setPageIndex((data.document.pages || []).length - 1);
      setSaveState("saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onDeletePage = async () => {
    if (readOnly || !page || pages.length <= 1) return;
    setBusy(true);
    try {
      const data = await deleteHomeworkNotebookPage(docRef.current.id, page.id);
      docRef.current = data.document;
      setDoc(data.document);
      setPageIndex((idx) => Math.max(0, idx - 1));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const showReview = Boolean(doc && doc.owner_role !== "student");
  const [taskInfoOpen, setTaskInfoOpen] = useState(true);
  const taskConditionHtml = showReview ? String(doc?.task_condition_html || "") : "";
  const studentAnswerText = showReview ? String(doc?.answer_text || "").trim() : "";
  const pageFeedback = objects.find((obj) => obj?.type === "page_feedback") || null;
  const withPageMeta = (list, index) => (list || [])
    .filter((obj) => obj?.type === "comment")
    .map((obj) => ({ ...obj, pageIndex: index, pageLabel: `Страница ${index + 1}` }));
  const pageComments = withPageMeta(objects, pageIndex);
  const allComments = pages.flatMap((item, index) => withPageMeta(
    pageAnnotations(item).map((obj) => normalizeAnnotation(obj, item.id)).filter(Boolean),
    index,
  ));
  const objectsOn = (targetPage) => (
    targetPage?.id === page?.id
      ? objects
      : pageAnnotations(targetPage).map((obj) => normalizeAnnotation(obj, targetPage.id)).filter(Boolean)
  );
  const replacePageObjects = (targetPage, next, historyType) => {
    if (!targetPage) return;
    const current = objectsOn(targetPage);
    const nextDoc = setPageAnnotations(docRef.current || doc, targetPage.id, next);
    applyDoc(nextDoc, { history: replaceAnnotationsCommand(targetPage.id, current, next, historyType) });
  };
  const savePageFeedback = (text) => {
    if (readOnly || !page) return;
    const value = String(text || "");
    if (pageFeedback) {
      const next = value.trim()
        ? objects.map((obj) => (obj.id === pageFeedback.id ? { ...obj, text: value } : obj))
        : objects.filter((obj) => obj.id !== pageFeedback.id);
      commitObjects(next, "UPDATE_ANNOTATION");
      return;
    }
    if (!value.trim()) return;
    commitObjects([...objects, createAnnotation("page_feedback", { text: value }, page.id)], "ADD_ANNOTATION");
  };
  const addReviewComment = (text) => {
    if (readOnly || !page) return;
    const value = String(text || "").trim();
    if (!value) return;
    commitObjects([...objects, createAnnotation("comment", { text: value }, page.id)], "ADD_ANNOTATION");
  };
  const resolveReviewComment = (comment) => {
    if (readOnly || !comment) return;
    const targetPage = pages[comment.pageIndex] || page;
    const current = objectsOn(targetPage);
    replacePageObjects(
      targetPage,
      current.map((obj) => (obj.id === comment.id ? { ...obj, resolved: !obj.resolved } : obj)),
      "UPDATE_ANNOTATION",
    );
  };
  const deleteReviewComment = (comment) => {
    if (readOnly || !comment) return;
    const targetPage = pages[comment.pageIndex] || page;
    replacePageObjects(
      targetPage,
      objectsOn(targetPage).filter((obj) => obj.id !== comment.id),
      "DELETE_ANNOTATION",
    );
  };
  const addStamp = (kind) => {
    if (readOnly || !page) return;
    const mark = kind === "cross" ? "✗" : "✓";
    const ink = kind === "cross" ? "#E25E66" : "#28886A";
    const placed = objects.filter((obj) => obj.type === "text" && (obj.text === "✓" || obj.text === "✗")).length;
    commitObjects([
      ...objects,
      createAnnotation("text", {
        text: mark,
        x: 72 + (placed % 8) * 56,
        y: 72 + Math.floor(placed / 8) * 56,
        fontSize: 42,
        stroke: ink,
        color: ink,
      }, page.id),
    ], "ADD_ANNOTATION");
  };

  const shortcuts = useMemo(() => ([
    ["Инструменты", [["P", "Перо"], ["M", "Маркер"], ["E", "Ластик"], ["T", "Текст"], ["V", "Выделить"], ["H", "Перемещение"]]],
    ["Навигация", [["Space", "Перемещение"], [shortcutLabel("Mod +/-"), "Масштаб"], [shortcutLabel("Mod+0"), "По странице"]]],
    ["Редактирование", [[shortcutLabel("Mod+Z"), "Отмена"], [shortcutLabel("Mod+Shift+Z"), "Повтор"], ["Delete", "Удалить"], [shortcutLabel("Mod+D"), "Дублировать"]]],
  ]), []);

  if (!doc) {
    return createPortal(
      <div className="hw-notebook hw-notebook--loading">
        <button type="button" className="hw-nb-back" onClick={handleClose}>
          <ArrowLeft size={16} />
          Назад
        </button>
        {error ? (
          <p className="hw-notebook__status">{error}</p>
        ) : (
          <EducationalLoading message={LOADING_MESSAGES.material} />
        )}
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className={`hw-notebook${pagesOpen ? "" : " is-pages-hidden"}${showReview && commentsOpen ? "" : " is-comments-hidden"}`}>
      <button type="button" className="hw-nb-shade hw-nb-shade--pages" aria-label="Скрыть страницы" onClick={() => setPagesOpen(false)} />
      <button type="button" className="hw-nb-shade hw-nb-shade--comments" aria-label="Закрыть комментарии" onClick={() => setCommentsOpen(false)} />
      <NotebookPagesDrawer
        open={pagesOpen}
        onClose={() => setPagesOpen(false)}
        pages={pages}
        pageIndex={pageIndex}
        onSelect={setPageIndex}
        onAddBlank={() => onAddPage({ page_type: "blank" })}
        onAddFile={(file) => onAddPage({ page_type: "attachment" }, file)}
        onDuplicate={() => onAddPage({ page_type: "duplicate", page_id: page.id })}
        onDelete={onDeletePage}
        onReorder={(nextPages) => {
          applyDoc({ ...doc, pages: nextPages }, { history: pagesCommand(pages, nextPages, "REORDER_PAGE") });
        }}
        readOnly={readOnly}
        />
      <section className="hw-notebook__workspace" aria-label="Лист и инструменты">
        {error ? (
          <div className="hw-notebook__error" role="alert">
            <p>{error}</p>
            {conflict ? (
              <div className="hw-notebook__conflict-actions">
                <button type="button" onClick={saveLocalSeparately}>Сохранить пометки отдельно</button>
                <button type="button" onClick={reloadServerNotebook} disabled={busy}>Обновить тетрадь</button>
              </div>
            ) : null}
          </div>
        ) : null}
        {taskConditionHtml || studentAnswerText ? (
          <div className={`hw-nb-taskinfo${taskInfoOpen ? "" : " is-collapsed"}`} aria-label="Условие и ответ ученика">
            <button type="button" className="hw-nb-taskinfo__toggle" onClick={() => setTaskInfoOpen((v) => !v)}>
              {taskInfoOpen ? "Скрыть условие и ответ" : "Показать условие и ответ"}
            </button>
            {taskInfoOpen ? (
              <div className="hw-nb-taskinfo__body">
                {taskConditionHtml ? (
                  <div className="hw-nb-taskinfo__section">
                    <strong>Условие</strong>
                    <MathContent html={taskConditionHtml} className="task-text hw-nb-taskinfo__condition" />
                  </div>
                ) : null}
                <div className="hw-nb-taskinfo__section">
                  <strong>Ответ ученика</strong>
                  <p className="hw-nb-taskinfo__answer">{studentAnswerText || "—"}</p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div
        className="hw-notebook__stage"
        ref={stageRef}
        onPointerDown={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onTouchStart={(event) => {
          if (event.touches.length !== 2) return;
          const distance = Math.hypot(
            event.touches[0].clientX - event.touches[1].clientX,
            event.touches[0].clientY - event.touches[1].clientY,
          );
          event.currentTarget.dataset.pinch = String(distance);
          event.currentTarget.dataset.pinchZoom = String(fit ? 1 : zoom);
        }}
        onTouchMove={(event) => {
          if (event.touches.length !== 2) return;
          const start = Number(event.currentTarget.dataset.pinch || 0);
          const startZoom = Number(event.currentTarget.dataset.pinchZoom || zoom);
          if (!start) return;
          event.preventDefault();
          setFit(false);
          setZoom(clampZoom(startZoom * (Math.hypot(
            event.touches[0].clientX - event.touches[1].clientX,
            event.touches[0].clientY - event.touches[1].clientY,
          ) / start)));
        }}
      >
        <div
          className={`hw-notebook__page-wrap${fit ? " is-fit" : ""}`}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${fit ? 1 : zoom})` }}
        >
          <NotebookPageBackground page={page} url={backgroundUrl} isPdf={isPdf} isImage={isImage} pdfCache={pdfCache} />
          {page ? (
            <NotebookCanvas
              page={page}
              objects={objects}
              liveCommitRef={liveCommitRef}
              tool={spacePan ? TOOL.HAND : tool}
              color={color}
              strokeWidth={strokeWidth}
              opacity={tool === TOOL.MARKER ? opacity : 1}
              fontSize={fontSize}
              smoothing={smoothing}
              eraserMode={eraserMode}
              selectedIds={selectedIds}
              onSelectIds={setSelectedIds}
              onObjectsCommit={commitObjects}
              spacePan={spacePan}
              readOnly={readOnly}
              editingText={editingText}
              onEditingText={setEditingText}
              onImageReady={(id) => setReadyImages((prev) => (prev[id] ? prev : { ...prev, [id]: true }))}
              onPanDelta={({ dx, dy }) => {
                setFit(false);
                setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
              }}
            />
          ) : <p>Нет страниц</p>}
        </div>
        </div>
        <div className="hw-nb-float hw-nb-float--left">
          {!pagesOpen ? (
            <button type="button" className="hw-nb-icon-btn hw-nb-float-square" aria-label="Показать страницы" onClick={() => setPagesOpen(true)}>
              <PanelLeft size={18} />
            </button>
          ) : null}
          <button type="button" className="hw-nb-back" onClick={handleClose}>
            <ArrowLeft size={16} />
            Назад
          </button>
          <div className="hw-nb-capsule" aria-label="Текущая страница">
            <strong>Страница {pages.length ? pageIndex + 1 : 1}</strong>
            <span>А4</span>
          </div>
        </div>
        <div className="hw-nb-float hw-nb-float--right">
          <span className={`hw-nb-save is-${saveState}`}>{saveStatus}</span>
          {showReview && !commentsOpen ? (
            <button type="button" className="hw-nb-icon-btn hw-nb-float-square" aria-label="Комментарии" onClick={() => setCommentsOpen(true)}>
              <MessageSquare size={18} />
            </button>
          ) : null}
          <button
            type="button"
            className={`hw-nb-icon-btn hw-nb-float-square${helpOpen ? " is-active" : ""}`}
            aria-label="Горячие клавиши"
            aria-pressed={helpOpen}
            onClick={() => setHelpOpen((value) => !value)}
          >
            <CircleHelp size={18} />
          </button>
          {!readOnly ? (
            <button type="button" className="hw-nb-done" disabled={busy} onClick={handleDone}>
              {busy ? "Готовим…" : "Готово"}
            </button>
          ) : null}
        </div>
        <div className="hw-nb-zoom" aria-label="Масштаб страницы">
          <button type="button" className="hw-nb-icon-btn" aria-label="Уменьшить" onClick={() => zoomBy(0.9)}><Minus size={15} /></button>
          <button type="button" className="hw-nb-zoom-value" onClick={fitPage}>{Math.round((fit ? 1 : zoom) * 100)}%</button>
          <button type="button" className="hw-nb-icon-btn" aria-label="Увеличить" onClick={() => zoomBy(1.1)}><Plus size={15} /></button>
          <span className="hw-nb-zoom-sep" />
          <button type="button" className="hw-nb-icon-btn" aria-label="На весь экран" onClick={() => document.querySelector(".hw-notebook")?.requestFullscreen?.()}>
            <Maximize size={15} />
          </button>
        </div>
        {hint ? (
          <div className="hw-nb-hint">
            <span><kbd>Space</kbd> переместить лист</span>
            <button
              type="button"
              className="hw-nb-ghost"
              onClick={() => {
                localStorage.setItem(HINT_KEY, "1");
                setHint(false);
              }}
            >
              Понятно
            </button>
          </div>
        ) : null}
        {!readOnly ? (
        <div className="hw-notebook__dock">
        <NotebookToolbar
          tool={tool}
          onTool={setToolSafe}
          color={color}
          onColor={(value) => {
            setColor(value);
            if (selectedIds.length) {
              commitObjects(objects.map((obj) => (
                selectedIds.includes(obj.id) ? { ...obj, stroke: value, color: value } : obj
              )), "CHANGE_STYLE");
            }
          }}
          strokeWidth={strokeWidth}
          onStrokeWidth={(value) => {
            setStrokeWidth(value);
            if (selectedIds.length) {
              commitObjects(objects.map((obj) => (
                selectedIds.includes(obj.id) ? { ...obj, strokeWidth: value, width: value } : obj
              )), "CHANGE_STYLE");
            }
          }}
          opacity={opacity}
          onOpacity={setOpacity}
          fontSize={fontSize}
          onFontSize={(value) => {
            setFontSize(value);
            if (selectedIds.length) {
              commitObjects(objects.map((obj) => (
                selectedIds.includes(obj.id) && obj.type === "text" ? { ...obj, fontSize: value } : obj
              )), "CHANGE_STYLE");
            }
          }}
          smoothing={smoothing}
          onSmoothing={setSmoothing}
          eraserMode={eraserMode}
          onEraserMode={setEraserMode}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          readOnly={readOnly}
          selected={selected}
        />
        </div>
        ) : null}
        {helpOpen ? (
          <div className="hw-nb-help-backdrop" onClick={() => setHelpOpen(false)}>
            <div className="hw-nb-help" role="dialog" aria-label="Горячие клавиши" onClick={(event) => event.stopPropagation()}>
              <header>
                <strong>Клавиши</strong>
                <button type="button" className="hw-nb-icon-btn" onClick={() => setHelpOpen(false)} aria-label="Закрыть">
                  <X size={16} />
                </button>
              </header>
              {shortcuts.map(([title, rows]) => (
                <section key={title}>
                  <h3>{title}</h3>
                  {rows.map(([k, label]) => (
                    <p key={k}><kbd>{k}</kbd> {label}</p>
                  ))}
                </section>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      {showReview ? (
        <NotebookReviewPanel
          open={commentsOpen}
          onClose={() => setCommentsOpen(false)}
          readOnly={readOnly}
          pageLabel={`Страница ${pageIndex + 1}`}
          pageComments={pageComments}
          allComments={allComments}
          feedback={pageFeedback?.text || ""}
          onFeedback={savePageFeedback}
          onAddComment={addReviewComment}
          onResolve={resolveReviewComment}
          onDelete={deleteReviewComment}
          onOpenPage={setPageIndex}
          onStamp={addStamp}
        />
      ) : null}
    </div>,
    document.body,
  );
}

function NotebookPageBackground({ page, url, isPdf, isImage, pdfCache }) {
  const canvasRef = useRef(null);
  const sourceKey = `${page?.id || ""}:${url || ""}`;
  const [brokenKey, setBrokenKey] = useState("");
  const broken = Boolean(url) && brokenKey === sourceKey;
  useEffect(() => {
    if (!isPdf || !url || !page) return undefined;
    let cancelled = false;
    (async () => {
      try {
        let pdfDoc = pdfCache.current.get(url);
        if (!pdfDoc) {
          const loading = openMaterialPdf(url);
          pdfDoc = await loading.promise;
          pdfCache.current.set(url, pdfDoc);
        }
        const pdfPage = await pdfDoc.getPage(page.pdf_page_number || 1);
        const viewport = pdfPage.getViewport({ scale: 1.8 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        if (!page.background_url) {
          canvas.toBlob((blob) => {
            if (blob && page.id) uploadNotebookPageBackground(page.id, blob).catch(() => {});
          }, "image/jpeg", 0.9);
        }
      } catch {
        /* pdf render is best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, [isPdf, url, page, pdfCache]);

  if (isPdf) return <canvas ref={canvasRef} className="hw-notebook-bg" />;
  if (url && isImage && !broken) {
    return (
      <img
        src={url}
        alt=""
        className="hw-notebook-bg"
        onError={() => setBrokenKey(sourceKey)}
      />
    );
  }
  if (url || page?.source_attachment) {
    const name = page?.source_attachment?.filename || page?.source_attachment?.name || "Файл ученика";
    return (
      <div className="hw-notebook-bg hw-notebook-bg--file">
        <strong>{name}</strong>
        <span>Вложение ученика</span>
      </div>
    );
  }
  return <div className="hw-notebook-bg hw-notebook-bg--blank" />;
}

export function HomeworkPublishedNotebookPage() {
  const { submissionId, taskId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const revisionId = searchParams.get("revision") || "";
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetchPublishedNotebook(submissionId, taskId, revisionId)
      .then(setPayload)
      .catch((err) => setError(err.message));
  }, [submissionId, taskId, revisionId]);
  if (error) {
    const missingComments = error.includes("не отправлена");
    return createPortal(
      <div className="hw-nb-notice" role="dialog" aria-modal="true" aria-labelledby="hw-nb-notice-title">
        <div className="hw-nb-notice__card">
          <strong id="hw-nb-notice-title">
            {missingComments ? "Комментариев пока нет" : "Не удалось открыть работу"}
          </strong>
          <p>
            {missingComments
              ? "Учитель ещё не отправил комментарии к этой работе. Тетрадь откроется, когда проверка будет готова."
              : error}
          </p>
          <button type="button" onClick={() => navigate(-1)}>Назад</button>
        </div>
      </div>,
      document.body,
    );
  }
  if (!payload) return <EducationalLoading message={LOADING_MESSAGES.material} />;
  return <HomeworkNotebookEditor publishedPayload={payload} />;
}
