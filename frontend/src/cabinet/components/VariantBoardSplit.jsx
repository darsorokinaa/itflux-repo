import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createMeetingMaterialCollab } from "../meetingMaterialCollab";
import { fetchVariantBoard, fetchVideoMeetingStatus, postVariantBoardSplit } from "../../utils/cabinetAuth";
import { boardSplitSyncBody, studentSplitStamp, visibleStudentSplit } from "./variantBoardSplitSync";
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

/** r147: доска во встроенном режиме — без «Назад»/«Поделиться», без перехода к списку досок. */
/** r148: тело запроса с выбором — только 'group' или id ученика (учитель) / 'mine'|'group' (ученик). */
export function variantBoardPickBody(base, pick) {
  const body = { ...(base || {}) };
  if (pick === "group" || pick === "mine") body.target = pick;
  else if (pick !== null && pick !== undefined && pick !== "") body.student_id = pick;
  return body;
}

export function variantBoardFrameSrc(boardId) {
  return `/cabinet/boards/${encodeURIComponent(boardId)}?embed=variant`;
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
  const [m, setM] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(q).matches;
  });
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [q]);
  return Boolean(m);
}

function useRemotePresented(meetingUuid, enabled) {
  const [presented, setPresented] = useState(null);
  useEffect(() => {
    if (!enabled || !meetingUuid) return undefined;
    let cancelled = false;
    const pull = () => {
      fetchVideoMeetingStatus(meetingUuid)
        .then((st) => {
          if (!cancelled) setPresented(st?.presented ?? null);
        })
        .catch(() => {});
    };
    pull();
    if (typeof WebSocket !== "function") {
      return () => {
        cancelled = true;
      };
    }
    const collab = createMeetingMaterialCollab(meetingUuid, {
      onSyncState: (payload) => {
        if (payload && Object.prototype.hasOwnProperty.call(payload, "presented")) pull();
      },
      onPresented: () => pull(),
    });
    return () => {
      cancelled = true;
      collab.close();
    };
  }, [meetingUuid, enabled]);
  return presented;
}

function publishSplit(meetingUuid, open, pick) {
  if (!meetingUuid) return;
  postVariantBoardSplit(meetingUuid, boardSplitSyncBody(open, pick)).catch((e) => {
    if (e?.status === 409) return;
  });
}

function pickFromBoard(board) {
  if (!board) return null;
  if (board.kind === "group") return "group";
  return board.studentId ?? null;
}

function StudentSplitChrome({
  split, collapsed, onCollapse, onExpand, width, isMobile, dragging, onDragStart,
}) {
  const boardId = split?.boardId || "";
  const [tabState, setTabState] = useState({ boardId, tab: "board" });
  const tab = tabState.boardId === boardId ? tabState.tab : "board";
  const setTab = (next) => setTabState({ boardId, tab: next });
  if (!split) return null;
  if (collapsed) {
    return (
      <button type="button" className="vb-toggle" onClick={onExpand} data-testid="variant-board-show">
        Показать доску
      </button>
    );
  }
  const title = split.kind === "group" ? "Доска группы" : "Доска";
  const hidePanel = isMobile && tab !== "board";
  return (
    <>
      {isMobile && (
        <div className="vb-tabs" role="tablist" data-testid="variant-board-tabs">
          <button type="button" role="tab" aria-selected={tab === "variant"} className={tab === "variant" ? "is-active" : ""} onClick={() => setTab("variant")}>Вариант</button>
          <button type="button" role="tab" aria-selected={tab === "board"} className={tab === "board" ? "is-active" : ""} onClick={() => setTab("board")}>Доска</button>
          <button type="button" className="vb-tabs-close" aria-label="Скрыть доску" onClick={onCollapse}>✕</button>
        </div>
      )}
      <aside
        className={`vb-panel${isMobile ? " vb-panel--mobile" : ""}${hidePanel ? " vb-panel--hidden" : ""}`}
        style={isMobile ? undefined : { width: `${width}px` }}
        data-testid="variant-board-panel"
      >
        {!isMobile && (
          <div className="vb-divider" onPointerDown={onDragStart} role="separator" aria-orientation="vertical" title="Потяните, чтобы изменить ширину" />
        )}
        {!isMobile && (
          <div className="vb-panel-head">
            <button type="button" className="vb-close" onClick={onCollapse} aria-label="Скрыть доску" title="Скрыть доску">✕ Скрыть</button>
            <span className="vb-panel-title">{title}</span>
          </div>
        )}
        <div className="vb-board-body">
          <iframe
            key={split.boardId}
            className="vb-board-frame"
            title={title}
            src={variantBoardFrameSrc(split.boardId)}
            data-testid="variant-board-frame"
            allow="clipboard-read; clipboard-write; fullscreen"
          />
          {dragging && <div className="vb-drag-shield" />}
        </div>
      </aside>
    </>
  );
}

export default function VariantBoardSplit({
  meetingUuid, liveSessionId, homeworkId, readOnly = false, presented,
}) {
  const request = variantBoardRequest({ meetingUuid, liveSessionId, homeworkId });
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(readWidth);
  const [tab, setTab] = useState("board");
  const [dragging, setDragging] = useState(false);
  const [students, setStudents] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const [group, setGroup] = useState(null);
  const [hiddenStamp, setHiddenStamp] = useState("");
  const isMobile = useIsMobile();
  const followRemote = Boolean(readOnly && presented === undefined);
  const remotePresented = useRemotePresented(meetingUuid, followRemote);
  const shownPresented = followRemote ? remotePresented : presented;
  const split = readOnly ? visibleStudentSplit(shownPresented) : null;
  const stamp = studentSplitStamp(shownPresented);
  const collapsed = Boolean(readOnly && stamp && hiddenStamp === stamp);
  const reqKey = request ? JSON.stringify(request) : "";
  const [seenKey, setSeenKey] = useState(reqKey);
  if (seenKey !== reqKey) {
    setSeenKey(reqKey);
    setBoard(null);
    setStudents(null);
    setStudentId(null);
    setGroup(null);
  }
  const widthRef = useRef(width);
  widthRef.current = width;
  const boardRef = useRef(board);
  boardRef.current = board;

  const load = useCallback(async (pickId) => {
    if (!reqKey) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchVariantBoard(variantBoardPickBody(JSON.parse(reqKey), pickId));
      if (!data?.boardId) throw new Error("Доска недоступна");
      setBoard(data);
      setStudentId(data.kind === "group" ? "group" : (data.studentId ?? null));
      if (Array.isArray(data.students)) setStudents(data.students);
      setGroup(data.group || null);
      publishSplit(meetingUuid, true, pickFromBoard(data));
    } catch (e) {
      if (e?.status === 409 && Array.isArray(e?.data?.students)) {
        setBoard(null);
        setStudents(e.data.students);
        setGroup(e.data.group || null);
        setStudentId(null);
        return;
      }
      setError(e?.data?.detail || e?.message || "Не удалось открыть доску");
    } finally {
      setLoading(false);
    }
  }, [reqKey, meetingUuid]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setTab("board");
      const current = boardRef.current;
      if (!current) load();
      else publishSplit(meetingUuid, true, pickFromBoard(current));
      return;
    }
    publishSplit(meetingUuid, false, null);
  };

  const panelOpen = readOnly ? Boolean(split && !collapsed) : open;

  useEffect(() => {
    const root = document.documentElement;
    if (panelOpen && !isMobile) {
      root.classList.add("vb-split-open");
      root.style.setProperty("--vb-board-width", `${width}px`);
    } else {
      root.classList.remove("vb-split-open");
    }
    root.classList.toggle("vb-split-mobile", panelOpen && isMobile);
    return () => {
      root.classList.remove("vb-split-open", "vb-split-mobile");
    };
  }, [panelOpen, isMobile, width]);

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

  if (typeof document === "undefined") return null;
  if (readOnly) {
    if (!meetingUuid) return null;
    return createPortal(
      <StudentSplitChrome
        split={split}
        collapsed={collapsed}
        onCollapse={() => setHiddenStamp(stamp)}
        onExpand={() => setHiddenStamp("")}
        width={width}
        isMobile={isMobile}
        dragging={dragging}
        onDragStart={startDrag}
      />,
      document.body,
    );
  }

  if (!request) return null;

  const switchEl = board && group && !students ? (
                <span className="vb-switch" role="group" aria-label="Какая доска" data-testid="variant-board-switch">
                  <button type="button" aria-pressed={board.kind !== "group"} className={board.kind !== "group" ? "is-active" : ""} onClick={() => load("mine")}>Моя доска</button>
                  <button type="button" aria-pressed={board.kind === "group"} className={board.kind === "group" ? "is-active" : ""} onClick={() => load("group")}>Доска группы</button>
                </span>
                ) : null;

  const boardBody = (
    <div className="vb-board-body">
      {isMobile && switchEl}
      {loading && <div className="vb-board-status">Открываем доску…</div>}
      {error && !loading && (
        <div className="vb-board-status vb-board-status--error">
          {error}{" "}
          <button type="button" className="vb-link" onClick={load}>Повторить</button>
        </div>
      )}
      {!board && !loading && !error && students && (
        <div className="vb-board-status" data-testid="variant-board-pick">
          Чью доску открыть?
          <div className="vb-pick-list">
            {group && (
              <button type="button" className="vb-link vb-pick-group" onClick={() => load("group")}>Общая доска группы</button>
            )}
            {students.map((s) => (
              <button key={s.id} type="button" className="vb-link" onClick={() => load(s.id)}>{s.name}</button>
            ))}
          </div>
        </div>
      )}
      {board && !loading && (
        <iframe
          key={board.boardId}
          className="vb-board-frame"
          title={board.title || "Доска"}
          src={variantBoardFrameSrc(board.boardId)}
          data-testid="variant-board-frame"
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
              <span className="vb-panel-title">
                {board?.kind === "group" ? `Доска группы: ${board.group?.title || ""}` : board?.studentName ? `Доска ученика: ${board.studentName}` : (board?.title || "Доска")}
              </span>
              {switchEl}
              {students && (students.length > 1 || group) && (
                <select
                  className="vb-student-select"
                  aria-label="Ученик"
                  data-testid="variant-board-student"
                  value={studentId ?? ""}
                  onChange={(e) => e.target.value && load(e.target.value)}
                >
                  <option value="" disabled>Ученик…</option>
                  {group && <option value="group">Общая доска группы</option>}
                  {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
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
