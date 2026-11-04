import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchVariantBoard } from "../../utils/cabinetAuth";
import "../styles/variant-board-split.css";

/** r145: «Доска рядом» — общая tldraw-доска справа от варианта. */
export const VB_WIDTH_KEY = "variantBoardSplitWidth";
export const VB_MIN = 320;
export const VB_MOBILE_MAX = 768;

export function clampBoardWidth(width, viewport) {
  const vw = Number(viewport) || 1280;
  const max = Math.max(VB_MIN, vw - 360);
  const n = width === null || width === undefined || width === "" ? NaN : Number(width);
  if (!Number.isFinite(n)) return Math.round(Math.min(max, Math.max(VB_MIN, vw * 0.45)));
  return Math.round(Math.min(max, Math.max(VB_MIN, n)));
}

export function variantBoardRequest({ meetingUuid, liveSessionId, homeworkId }) {
  if (meetingUuid) return { meeting: meetingUuid };
  if (liveSessionId) return { live_session: liveSessionId };
  if (homeworkId) return { homework_id: homeworkId };
  return null;
}

function readWidth() {
  try {
    return clampBoardWidth(window.localStorage.getItem(VB_WIDTH_KEY), window.innerWidth);
  } catch {
    return clampBoardWidth(null, typeof window !== "undefined" ? window.innerWidth : 1280);
  }
}

function useIsMobile() {
  const q = `(max-width: ${VB_MOBILE_MAX}px)`;
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return undefined;
    const on = () => setM(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [q]);
  return Boolean(m);
}

export default function VariantBoardSplit({ meetingUuid, liveSessionId, homeworkId }) {
  const request = variantBoardRequest({ meetingUuid, liveSessionId, homeworkId });
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(readWidth);
  const [tab, setTab] = useState("board");
  const [dragging, setDragging] = useState(false);
  const isMobile = useIsMobile();
  const reqKey = request ? JSON.stringify(request) : "";
  const widthRef = useRef(width);
  widthRef.current = width;

  const load = useCallback(async () => {
    if (!reqKey) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchVariantBoard(JSON.parse(reqKey));
      if (!data?.boardId) throw new Error("Доска недоступна");
      setBoard(data);
    } catch (e) {
      setError(e?.message || "Не удалось открыть доску");
    } finally {
      setLoading(false);
    }
  }, [reqKey]);

  useEffect(() => {
    setBoard(null);
  }, [reqKey]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next) {
        setTab("board");
        if (!board) load();
      }
      return next;
    });
  };

  useEffect(() => {
    const root = document.documentElement;
    if (open && !isMobile) {
      root.classList.add("vb-split-open");
      root.style.setProperty("--vb-board-width", `${width}px`);
    } else {
      root.classList.remove("vb-split-open");
    }
    root.classList.toggle("vb-split-mobile", open && isMobile);
    return () => {
      root.classList.remove("vb-split-open", "vb-split-mobile");
    };
  }, [open, isMobile, width]);

  useEffect(() => {
    const onResize = () => setWidth((w) => clampBoardWidth(w, window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startDrag = (e) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev) => {
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
      setWidth(clampBoardWidth(window.innerWidth - x, window.innerWidth));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        window.localStorage.setItem(VB_WIDTH_KEY, String(widthRef.current));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!request || typeof document === "undefined") return null;

  const boardBody = (
    <div className="vb-board-body">
      {loading && <div className="vb-board-status">Открываем доску…</div>}
      {error && !loading && (
        <div className="vb-board-status vb-board-status--error">
          {error}{" "}
          <button type="button" className="vb-link" onClick={load}>Повторить</button>
        </div>
      )}
      {board && !loading && (
        <iframe
          className="vb-board-frame"
          title={board.title || "Доска"}
          src={`/cabinet/boards/${encodeURIComponent(board.boardId)}`}
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      )}
      {dragging && <div className="vb-drag-shield" />}
    </div>
  );

  return createPortal(
    <>
      {!open && (
        <button type="button" className="vb-toggle" onClick={toggle} data-testid="variant-board-toggle">
          <span aria-hidden="true">🖊</span> Доска рядом
        </button>
      )}
      {open && isMobile && (
        <div className="vb-tabs" role="tablist" data-testid="variant-board-tabs">
          <button type="button" role="tab" aria-selected={tab === "variant"} className={tab === "variant" ? "is-active" : ""} onClick={() => setTab("variant")}>Вариант</button>
          <button type="button" role="tab" aria-selected={tab === "board"} className={tab === "board" ? "is-active" : ""} onClick={() => setTab("board")}>Доска</button>
          <button type="button" className="vb-tabs-close" aria-label="Закрыть доску" onClick={toggle}>✕</button>
        </div>
      )}
      {open && (
        <aside
          className={`vb-panel${isMobile ? " vb-panel--mobile" : ""}${isMobile && tab !== "board" ? " vb-panel--hidden" : ""}`}
          style={isMobile ? undefined : { width: `${width}px` }}
          data-testid="variant-board-panel"
        >
          {!isMobile && (
            <div className="vb-divider" onPointerDown={startDrag} role="separator" aria-orientation="vertical" title="Потяните, чтобы изменить ширину" />
          )}
          {!isMobile && (
            <div className="vb-panel-head">
              <button type="button" className="vb-close" onClick={toggle} aria-label="Закрыть доску" title="Закрыть доску">✕ Закрыть</button>
              <span className="vb-panel-title">{board?.title || "Доска"}</span>
              {board && (
                <a className="vb-link" href={`/cabinet/boards/${encodeURIComponent(board.boardId)}`} target="_blank" rel="noreferrer">В новой вкладке</a>
              )}
            </div>
          )}
          {boardBody}
        </aside>
      )}
    </>,
    document.body,
  );
}
