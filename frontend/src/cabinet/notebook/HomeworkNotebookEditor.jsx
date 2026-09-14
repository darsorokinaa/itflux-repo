import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CircleHelp, Maximize, Minus, Plus, X } from "lucide-react";
import { openMaterialPdf } from "../materials/collab/pdfjsLoader";
import NotebookCanvas from "./NotebookCanvas";
import NotebookPagesDrawer from "./NotebookPagesDrawer";
import NotebookToolbar from "./NotebookToolbar";
import { createHistory, pagesCommand, replaceAnnotationsCommand } from "./notebookHistory";
import {
  ERASER_MODE,
  TOOL,
  cloneAnnotation,
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

const HINT_KEY = "itflux.notebook.hint.space";
const CLIP_KEY = "itflux.notebook.clipboard";
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

function persistPages(pages) {
  return (pages || []).map((page) => ({
    ...page,
    state: {
      version: 1,
      objects: pageAnnotations(page).map((obj) => toPersistedAnnotation(normalizeAnnotation(obj, page.id))),
      viewport: page.state?.viewport || undefined,
    },
  }));
}

export default function HomeworkNotebookEditor({
  notebookId: notebookIdProp,
  publishedPayload,
  onClose,
  onComplete,
}) {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const notebookId = notebookIdProp || params.notebookId;
  const publishedMode = searchParams.get("published") === "1" || Boolean(publishedPayload);
  const [doc, setDoc] = useState(publishedPayload?.document || null);
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
  const [busy, setBusy] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
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
  const saveSeq = useRef(0);
  const saveAbort = useRef(null);
  const pdfCache = useRef(new Map());
  const stageRef = useRef(null);
  const prevToolRef = useRef(TOOL.PEN);
  const clipboardRef = useRef([]);

  docRef.current = doc;
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
      setDoc({ ...publishedPayload.document, readonly: true });
      return;
    }
    const data = await fetchHomeworkNotebook(notebookId);
    if (data.published && data.document) {
      setDoc({ ...data.document, readonly: true, published: true });
      return;
    }
    setDoc(data);
    setSaveState("saved");
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
    clearTimeout(saveTimer.current);
    const seq = ++saveSeq.current;
    saveAbort.current?.abort();
    const controller = new AbortController();
    saveAbort.current = controller;
    setSaveState("saving");
    try {
      const saved = await saveHomeworkNotebook(nextDoc.id, {
        version: nextDoc.version,
        pages: persistPages(nextDoc.pages),
        reason: snapshot ? "manual_save" : "autosave",
        snapshot,
      }, { signal: controller.signal });
      if (seq !== saveSeq.current) return saved;
      dirtyRef.current = false;
      setDoc((prev) => (prev ? { ...prev, version: saved.version } : saved));
      setSaveState("saved");
      setError("");
      return { ...nextDoc, version: saved.version };
    } catch (err) {
      if (err.name === "AbortError") return nextDoc;
      if (err.code === "version_conflict" && err.data?.document) {
        setDoc(err.data.document);
        setError("Тетрадь изменилась в другой вкладке. Загружена новая версия.");
        setSaveState("saved");
        dirtyRef.current = false;
        historyRef.current.clear();
        syncHistoryButtons();
        return err.data.document;
      }
      setSaveState("error");
      setError(err.message || "Ошибка сохранения");
      throw err;
    }
  }, [readOnly]);

  const scheduleSave = useCallback((nextDoc) => {
    if (readOnly || !nextDoc?.id) return;
    dirtyRef.current = true;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      flushSave(nextDoc).catch(() => {});
    }, 800);
  }, [flushSave, readOnly]);

  const applyDoc = (nextDoc, { history = null, save = true } = {}) => {
    if (history) historyRef.current.push(history);
    setDoc(nextDoc);
    docRef.current = nextDoc;
    syncHistoryButtons();
    if (save) scheduleSave(nextDoc);
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

  const handleClose = async () => {
    const current = docRef.current;
    if (!readOnly && dirtyRef.current && current?.id) {
      try {
        await flushSave(current);
      } catch {
        const leave = window.confirm("Не удалось сохранить изменения. Закрыть без сохранения?");
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

  const backgroundUrl = page?.background_url || page?.source_attachment?.url || "";
  const isPdf = page?.page_type === "pdf_page" || /\.pdf($|\?)/i.test(page?.source_attachment?.filename || "");
  const saveStatus = saveState === "saving" ? "Сохраняем…" : saveState === "error" ? "Ошибка сохранения" : "Сохранено";

  const onAddPage = async (kind, file) => {
    if (readOnly) return;
    setBusy(true);
    try {
      await flushSave().catch(() => {});
      const data = file
        ? await addHomeworkNotebookPage(doc.id, { page_type: "attachment" }, file)
        : await addHomeworkNotebookPage(doc.id, kind);
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
      const data = await deleteHomeworkNotebookPage(doc.id, page.id);
      setDoc(data.document);
      setPageIndex((idx) => Math.max(0, idx - 1));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const shortcuts = useMemo(() => ([
    ["Инструменты", [["P", "Ручка"], ["M", "Маркер"], ["E", "Ластик"], ["T", "Текст"], ["V", "Выбор"], ["H", "Рука"]]],
    ["Навигация", [["Space", "Перемещение"], [shortcutLabel("Mod +/-"), "Масштаб"], [shortcutLabel("Mod+0"), "По странице"]]],
    ["Редактирование", [[shortcutLabel("Mod+Z"), "Отмена"], [shortcutLabel("Mod+Shift+Z"), "Повтор"], ["Delete", "Удалить"], [shortcutLabel("Mod+D"), "Дублировать"]]],
  ]), []);

  if (!doc) {
    return createPortal(
      <div className="hw-notebook">
        <p className="hw-notebook__status">{error || "Загрузка…"}</p>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="hw-notebook">
      <header className="hw-notebook__bar">
        <button type="button" className="hw-nb-ghost" onClick={handleClose} aria-label="Закрыть">
          <X size={18} />
        </button>
        <strong className="hw-notebook__title">Тетрадь проверки</strong>
        <span className={`hw-notebook__status is-${saveState}`}>{saveStatus}</span>
        <div className="hw-notebook__bar-actions">
          <button type="button" className="hw-nb-ghost" onClick={() => setPagesOpen((v) => !v)}>
            Страницы {pages.length}
          </button>
          <button
            type="button"
            className={`hw-nb-ghost${helpOpen ? " is-active" : ""}`}
            aria-label="Горячие клавиши"
            aria-pressed={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
          >
            <CircleHelp size={18} />
          </button>
          {!readOnly ? (
            <button type="button" className="hw-nb-done" disabled={busy} onClick={handleDone}>
              {busy ? "Готовим…" : "Готово"}
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p className="hw-notebook__error" role="alert">{error}</p> : null}

      <div className="hw-notebook__workspace">
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
          <NotebookPageBackground page={page} url={backgroundUrl} isPdf={isPdf} pdfCache={pdfCache} />
          {page ? (
            <NotebookCanvas
              page={page}
              objects={objects}
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
              onPanDelta={({ dx, dy }) => {
                setFit(false);
                setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
              }}
            />
          ) : <p>Нет страниц</p>}
        </div>
        </div>
        {helpOpen ? (
          <div className="hw-nb-help" role="dialog" aria-label="Горячие клавиши">
            <header>
              <strong>Клавиши</strong>
              <button type="button" className="hw-nb-ghost" onClick={() => setHelpOpen(false)} aria-label="Закрыть">✕</button>
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
        ) : null}
      </div>

      {hint ? (
        <div className="hw-nb-hint">
          Совет: удерживайте Space, чтобы перемещать страницу
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

      <div className="hw-notebook__dock">
        {!readOnly ? (
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
        ) : null}
        <div className="hw-nb-zoom">
          <button type="button" className="hw-nb-ghost" aria-label="Уменьшить" onClick={() => zoomBy(0.9)}><Minus size={16} /></button>
          <button type="button" className="hw-nb-ghost" onClick={fitPage}>{Math.round((fit ? 1 : zoom) * 100)}%</button>
          <button type="button" className="hw-nb-ghost" aria-label="Увеличить" onClick={() => zoomBy(1.1)}><Plus size={16} /></button>
          <button type="button" className="hw-nb-ghost" aria-label="На весь экран" onClick={() => document.querySelector(".hw-notebook")?.requestFullscreen?.()}>
            <Maximize size={16} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function NotebookPageBackground({ page, url, isPdf, pdfCache }) {
  const canvasRef = useRef(null);
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
  if (url) return <img src={url} alt="" className="hw-notebook-bg" />;
  return <div className="hw-notebook-bg hw-notebook-bg--blank" />;
}

export function HomeworkPublishedNotebookPage() {
  const { submissionId, taskId } = useParams();
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetchPublishedNotebook(submissionId, taskId)
      .then(setPayload)
      .catch((err) => setError(err.message));
  }, [submissionId, taskId]);
  if (error) return <p className="hw-notebook__error">{error}</p>;
  if (!payload) return <p className="hw-notebook__status">Загрузка…</p>;
  return <HomeworkNotebookEditor publishedPayload={payload} />;
}
