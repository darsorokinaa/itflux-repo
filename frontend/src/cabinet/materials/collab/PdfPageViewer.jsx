import { useEffect, useRef, useState } from "react";
import { openMaterialPdf } from "./pdfjsLoader";

const MAX_CANVAS_EDGE = 4096;

/**
 * Page-based PDF renderer: fit-to-container (contain), no synced zoom/scrollTop.
 * Falls back to the parent iframe if the file cannot be fetched (CORS).
 */
export default function PdfPageViewer({
  url,
  page = 1,
  rotation = 0,
  onPageCount,
  onReady,
  onError,
  onRendered,
  canvasRef,
}) {
  const containerRef = useRef(null);
  const localCanvasRef = useRef(null);
  const docRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [pageCount, setPageCount] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const setCanvasNode = (node) => {
    localCanvasRef.current = node;
    if (typeof canvasRef === "function") canvasRef(node);
    else if (canvasRef) canvasRef.current = node;
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const obs = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: rect.width, height: rect.height });
    });
    obs.observe(el);
    const rect = el.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const src = String(url || "").split("#")[0];
    if (!src) {
      onError?.(new Error("empty-pdf-url"));
      return undefined;
    }
    setStatus("loading");
    docRef.current = null;
    const loadingTask = openMaterialPdf(src);
    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        const count = Number(doc.numPages) || 1;
        setPageCount(count);
        onPageCount?.(count);
        setStatus("ready");
        onReady?.();
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        onError?.(err);
      });
    return () => {
      cancelled = true;
      loadingTask.destroy?.();
      const doc = docRef.current;
      docRef.current = null;
      doc?.destroy?.();
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const doc = docRef.current;
    const canvas = localCanvasRef.current;
    const container = containerRef.current;
    if (status !== "ready" || !doc || !canvas || !container) return undefined;
    const cw = size.width || container.clientWidth;
    const ch = size.height || container.clientHeight;
    if (!cw || !ch) return undefined;

    let cancelled = false;
    const targetPage = Math.min(Math.max(1, Number(page) || 1), pageCount || doc.numPages || 1);
    const rot = Number(rotation) || 0;

    (async () => {
      try {
        renderTaskRef.current?.cancel?.();
        const pdfPage = await doc.getPage(targetPage);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1, rotation: rot });
        const fit = Math.min(cw / base.width, ch / base.height);
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        let scale = fit * dpr;
        if (base.width * scale > MAX_CANVAS_EDGE || base.height * scale > MAX_CANVAS_EDGE) {
          scale = MAX_CANVAS_EDGE / Math.max(base.width, base.height);
        }
        const viewport = pdfPage.getViewport({ scale, rotation: rot });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (!cancelled) onRendered?.();
      } catch (err) {
        if (cancelled || err?.name === "RenderingCancelledException") return;
        setStatus("error");
        onError?.(err);
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
    };
  }, [status, page, rotation, size.width, size.height, pageCount, onError]);

  return (
    <div ref={containerRef} className="vl-pdf-page" data-page={page} data-page-count={pageCount}>
      {status === "loading" ? (
        <p className="vl-pdf-page__status">Загружаем страницу…</p>
      ) : null}
      <canvas ref={setCanvasNode} className="vl-pdf-page__canvas" />
    </div>
  );
}
