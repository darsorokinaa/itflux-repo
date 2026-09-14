import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { openMaterialPdf } from "../materials/collab/pdfjsLoader";
import NotebookCanvas from "./NotebookCanvas";
import {
  addHomeworkNotebookPage,
  deleteHomeworkNotebookPage,
  fetchHomeworkNotebook,
  fetchPublishedNotebook,
  notebookExportUrl,
  saveHomeworkNotebook,
  submitHomeworkNotebook,
  uploadNotebookPageBackground,
} from "./notebookApi";

const TOOLS = [
  { id: "pen", label: "Ручка" },
  { id: "marker", label: "Маркер" },
  { id: "eraser", label: "Ластик" },
  { id: "text", label: "Текст" },
  { id: "line", label: "Линия" },
  { id: "arrow", label: "Стрелка" },
  { id: "rect", label: "Прямоугольник" },
  { id: "ellipse", label: "Круг" },
  { id: "select", label: "Выбор" },
];

const PEN_SIZES = [2, 4, 8];
const TEXT_SIZES = [18, 24, 36];
const COLORS = ["#d32f2f", "#1565c0", "#2e7d32", "#6a1b9a", "#000000", "#f9a825"];

function pageObjects(page) {
  return Array.isArray(page?.state?.objects) ? page.state.objects : [];
}

export default function HomeworkNotebookEditor({
  notebookId: notebookIdProp,
  publishedPayload,
  onClose,
}) {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const notebookId = notebookIdProp || params.notebookId;
  const publishedMode = searchParams.get("published") === "1" || Boolean(publishedPayload);
  const [doc, setDoc] = useState(publishedPayload?.document || null);
  const [pageIndex, setPageIndex] = useState(0);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#d32f2f");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fontSize, setFontSize] = useState(24);
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [saveState, setSaveState] = useState("saved");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const dirtyRef = useRef(false);
  const saveTimer = useRef(null);
  const pdfCache = useRef(new Map());

  const readOnly = Boolean(doc?.readonly || publishedMode || publishedPayload);

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
  }, [notebookId, publishedPayload]);

  useEffect(() => {
    load().catch((err) => setError(err.message || "Не удалось открыть тетрадь"));
  }, [load]);

  const pages = doc?.pages || [];
  const page = pages[pageIndex] || pages[0];

  const scheduleSave = useCallback((nextDoc) => {
    if (readOnly || !nextDoc?.id) return;
    dirtyRef.current = true;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const saved = await saveHomeworkNotebook(nextDoc.id, {
          version: nextDoc.version,
          pages: nextDoc.pages,
          reason: "autosave",
        });
        dirtyRef.current = false;
        setDoc(saved);
        setSaveState("saved");
      } catch (err) {
        if (err.code === "version_conflict" && err.data?.document) {
          setDoc(err.data.document);
          setError("Тетрадь изменилась в другой вкладке. Загружена новая версия.");
          setSaveState("saved");
          dirtyRef.current = false;
          return;
        }
        setSaveState("error");
        setError(err.message || "Ошибка сохранения");
      }
    }, 700);
  }, [readOnly]);

  const updatePageObjects = (nextObjectsOrFn) => {
    if (!doc || !page) return;
    undoRef.current = [...undoRef.current, pageObjects(page)].slice(-50);
    redoRef.current = [];
    const objects = typeof nextObjectsOrFn === "function"
      ? nextObjectsOrFn(pageObjects(page))
      : nextObjectsOrFn;
    const pagesNext = doc.pages.map((item, index) => (
      index === pageIndex
        ? { ...item, state: { version: 1, objects } }
        : item
    ));
    const nextDoc = { ...doc, pages: pagesNext };
    setDoc(nextDoc);
    scheduleSave(nextDoc);
  };

  const applyDocument = (nextDoc) => {
    setDoc(nextDoc);
    scheduleSave(nextDoc);
  };

  const handleUndo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(pageObjects(page));
    const pagesNext = doc.pages.map((item, index) => (
      index === pageIndex ? { ...item, state: { version: 1, objects: prev } } : item
    ));
    applyDocument({ ...doc, pages: pagesNext });
  };

  const handleRedo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(pageObjects(page));
    const pagesNext = doc.pages.map((item, index) => (
      index === pageIndex ? { ...item, state: { version: 1, objects: next } } : item
    ));
    applyDocument({ ...doc, pages: pagesNext });
  };

  const handleDeleteSelected = () => {
    if (!selectedId) return;
    updatePageObjects((objects) => objects.filter((obj) => obj.id !== selectedId));
    setSelectedId(null);
  };

  const handleAddBlank = async () => {
    if (readOnly) return;
    setBusy(true);
    try {
      const data = await addHomeworkNotebookPage(doc.id, { page_type: "blank" });
      setDoc(data.document);
      setPageIndex((data.document.pages || []).length - 1);
      setSaveState("saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = async () => {
    if (readOnly || !page) return;
    setBusy(true);
    try {
      const data = await addHomeworkNotebookPage(doc.id, { page_type: "duplicate", page_id: page.id });
      setDoc(data.document);
      setPageIndex((data.document.pages || []).length - 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePage = async () => {
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

  const docRef = useRef(doc);
  docRef.current = doc;

  const handleClose = async () => {
    const current = docRef.current;
    if (!readOnly && dirtyRef.current && current?.id) {
      setSaveState("saving");
      try {
        await saveHomeworkNotebook(current.id, {
          version: current.version,
          pages: current.pages,
          reason: "manual_save",
        });
        dirtyRef.current = false;
        setSaveState("saved");
      } catch (err) {
        setSaveState("error");
        const leave = window.confirm("Не удалось сохранить изменения. Закрыть без сохранения?");
        if (!leave) {
          setError(err.message || "Ошибка сохранения");
          return;
        }
      }
    }
    onClose?.();
    if (!onClose) navigate(-1);
  };

  const handleSubmit = async () => {
    if (readOnly) return;
    setBusy(true);
    try {
      if (dirtyRef.current) {
        await saveHomeworkNotebook(doc.id, { version: doc.version, pages: doc.pages, snapshot: true, reason: "manual_save" });
      }
      await submitHomeworkNotebook(doc.id);
      setSaveState("saved");
      setError("");
      onClose?.();
      if (!onClose) navigate(-1);
    } catch (err) {
      setError(err.message);
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

  const saveStatus = saveState === "saving"
    ? "Сохранение…"
    : saveState === "error"
      ? "Ошибка сохранения"
      : "Сохранено";

  const backgroundUrl = page?.background_url || page?.source_attachment?.url || "";
  const isPdf = page?.page_type === "pdf_page" || /\.pdf($|\?)/i.test(page?.source_attachment?.filename || "");

  return (
    <div className="hw-notebook">
      <header className="hw-notebook__bar">
        <button type="button" className="hw-notebook__icon-btn" onClick={handleClose}>
          Закрыть
        </button>
        <strong className="hw-notebook__title">Тетрадь проверки</strong>
        <span className={`hw-notebook__status is-${saveState}`}>{saveStatus}</span>
        <button type="button" className="hw-notebook__icon-btn" onClick={() => setToolbarOpen((v) => !v)}>
          {toolbarOpen ? "Скрыть панель" : "Панель"}
        </button>
      </header>

      {toolbarOpen ? (
        <aside className="hw-notebook__tools">
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tool === item.id ? "is-active" : ""}
              disabled={readOnly && item.id !== "select"}
              onClick={() => setTool(item.id)}
            >
              {item.label}
            </button>
          ))}
          <div className="hw-notebook__tool-group">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                className={`hw-notebook__swatch${color === value ? " is-active" : ""}`}
                style={{ background: value }}
                onClick={() => setColor(value)}
                aria-label={value}
              />
            ))}
          </div>
          <div className="hw-notebook__tool-group">
            {(tool === "text" ? TEXT_SIZES : PEN_SIZES).map((value) => (
              <button
                key={value}
                type="button"
                className={(tool === "text" ? fontSize : strokeWidth) === value ? "is-active" : ""}
                onClick={() => (tool === "text" ? setFontSize(value) : setStrokeWidth(value))}
              >
                {value}
              </button>
            ))}
          </div>
          <button type="button" onClick={handleUndo} disabled={readOnly}>Отмена</button>
          <button type="button" onClick={handleRedo} disabled={readOnly}>Повтор</button>
          <button type="button" onClick={handleDeleteSelected} disabled={readOnly || !selectedId}>Удалить объект</button>
          <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.15))}>+</button>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>−</button>
          <button type="button" onClick={() => { setFit(true); setZoom(1); }}>В экран</button>
        </aside>
      ) : null}

      <div className="hw-notebook__stage">
        <div
          className="hw-notebook__page-wrap"
          style={{ transform: fit ? "none" : `scale(${zoom})`, width: fit ? "min(100%, calc(100vh * 0.68))" : undefined }}
          onTouchStart={(event) => {
            if (event.touches.length === 2) {
              const distance = Math.hypot(
                event.touches[0].clientX - event.touches[1].clientX,
                event.touches[0].clientY - event.touches[1].clientY,
              );
              event.currentTarget.dataset.pinch = String(distance);
              event.currentTarget.dataset.pinchZoom = String(zoom);
              setFit(false);
            }
          }}
          onTouchMove={(event) => {
            if (event.touches.length !== 2) return;
            const start = Number(event.currentTarget.dataset.pinch || 0);
            const startZoom = Number(event.currentTarget.dataset.pinchZoom || zoom);
            if (!start) return;
            event.preventDefault();
            const distance = Math.hypot(
              event.touches[0].clientX - event.touches[1].clientX,
              event.touches[0].clientY - event.touches[1].clientY,
            );
            setZoom(Math.max(0.4, Math.min(3, startZoom * (distance / start))));
          }}
        >
          <NotebookPageBackground page={page} url={backgroundUrl} isPdf={isPdf} pdfCache={pdfCache} />
          {page ? (
            <NotebookCanvas
              page={page}
              objects={pageObjects(page)}
              tool={tool}
              color={color}
              strokeWidth={strokeWidth}
              fontSize={fontSize}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChangeObjects={updatePageObjects}
              readOnly={readOnly}
            />
          ) : (
            <p>Нет страниц</p>
          )}
        </div>
      </div>

      <footer className="hw-notebook__footer">
        <button type="button" disabled={pageIndex <= 0} onClick={() => setPageIndex((i) => i - 1)}>‹</button>
        <span>Страница {pages.length ? pageIndex + 1 : 0} / {pages.length}</span>
        <button type="button" disabled={pageIndex >= pages.length - 1} onClick={() => setPageIndex((i) => i + 1)}>›</button>
        {!readOnly ? (
          <>
            <button type="button" disabled={busy} onClick={handleAddBlank}>+ Страница</button>
            <button type="button" disabled={busy} onClick={handleDuplicate}>Дублировать страницу</button>
            <button type="button" disabled={busy || pages.length <= 1} onClick={handleDeletePage}>Удалить страницу</button>
            <button type="button" disabled={busy} onClick={() => applyDocument(doc)}>Сохранить</button>
            <button type="button" className="is-primary" disabled={busy} onClick={handleSubmit}>
              {doc?.owner_role === "teacher" ? "Отправить ученику" : "Сохранить сдачу"}
            </button>
          </>
        ) : null}
        {doc?.id ? (
          <a className="hw-notebook__download" href={notebookExportUrl(doc.id)}>Скачать PDF</a>
        ) : null}
      </footer>
      {error ? <p className="hw-notebook__error" role="alert">{error}</p> : null}
    </div>
  );
}

function NotebookPageBackground({ page, url, isPdf, pdfCache }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!isPdf || !url || !page) return undefined;
    let cancelled = false;
    (async () => {
      try {
        let doc = pdfCache.current.get(url);
        if (!doc) {
          const loading = openMaterialPdf(url);
          doc = await loading.promise;
          pdfCache.current.set(url, doc);
        }
        const pdfPage = await doc.getPage(page.pdf_page_number || 1);
        const viewport = pdfPage.getViewport({ scale: 1.4 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        if (!page.background_url) {
          canvas.toBlob((blob) => {
            if (blob && page.id) uploadNotebookPageBackground(page.id, blob).catch(() => {});
          }, "image/jpeg", 0.86);
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
