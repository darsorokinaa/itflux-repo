import { useEffect, useRef, useState } from "react";
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

function teacherBoardTitle(board) {
  if (board?.kind === "group") return `Доска группы: ${board.group?.title || ""}`;
  if (board?.studentName) return `Доска ученика: ${board.studentName}`;
  return board?.title || "Доска";
}

function showStudentPicker(board, loading, error, students) {
  if (board || loading || error) return false;
  return Boolean(students);
}

function showStudentSelect(students, group) {
  if (!students) return false;
  return students.length > 1 || Boolean(group);
}

function panelClassName(isMobile, hidden) {
  const mobile = isMobile ? " vb-panel--mobile" : "";
  const off = hidden ? " vb-panel--hidden" : "";
  return `vb-panel${mobile}${off}`;
}

async function loadTeacherBoard(meetingUuid, reqKey, pickId, api) {
  if (!reqKey) return;
  api.setLoading(true);
  api.setError("");
  try {
    const data = await fetchVariantBoard(variantBoardPickBody(JSON.parse(reqKey), pickId));
    if (!data?.boardId) throw new Error("Доска недоступна");
    api.acceptBoard(data);
    publishSplit(meetingUuid, true, pickFromBoard(data));
  } catch (e) {
    const students = e?.data?.students;
    if (e?.status === 409 && Array.isArray(students)) {
      api.showPicker(students, e.data.group || null);
      return;
    }
    api.setError(e?.data?.detail || e?.message || "Не удалось открыть доску");
  } finally {
    api.setLoading(false);
  }
}

function useSplitWidth(panelOpen) {
  const [width, setWidth] = useState(readWidth);
  const [dragging, setDragging] = useState(false);
  const isMobile = useIsMobile();
  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);
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
  return { width, isMobile, dragging, startDrag };
}

function useTeacherBoard(meetingUuid, reqKey) {
  const [open, setOpen] = useState(false);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("board");
  const [students, setStudents] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const [group, setGroup] = useState(null);
  const [seenKey, setSeenKey] = useState(reqKey);
  if (seenKey !== reqKey) {
    setSeenKey(reqKey);
    setBoard(null);
    setStudents(null);
    setStudentId(null);
    setGroup(null);
  }
  const api = {
    setLoading,
    setError,
    acceptBoard(data) {
      setBoard(data);
      setStudentId(data.kind === "group" ? "group" : (data.studentId ?? null));
      if (Array.isArray(data.students)) setStudents(data.students);
      setGroup(data.group || null);
    },
    showPicker(list, nextGroup) {
      setBoard(null);
      setStudents(list);
      setGroup(nextGroup);
      setStudentId(null);
    },
  };
  const load = (pickId) => {
    loadTeacherBoard(meetingUuid, reqKey, pickId, api);
  };
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next) {
      publishSplit(meetingUuid, false, null);
      return;
    }
    setTab("board");
    if (!board) load();
    else publishSplit(meetingUuid, true, pickFromBoard(board));
  };
  return { open, board, error, loading, tab, setTab, students, studentId, group, load, toggle };
}

function TeacherSwitch({ board, group, students, load }) {
  if (!board || !group || students) return null;
  return (
    <span className="vb-switch" role="group" aria-label="Какая доска" data-testid="variant-board-switch">
      <button type="button" aria-pressed={board.kind !== "group"} className={board.kind !== "group" ? "is-active" : ""} onClick={() => load("mine")}>Моя доска</button>
      <button type="button" aria-pressed={board.kind === "group"} className={board.kind === "group" ? "is-active" : ""} onClick={() => load("group")}>Доска группы</button>
    </span>
  );
}

function TeacherPickList({ group, students, load }) {
  return (
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
  );
}

function TeacherBoardBody({ board, loading, error, students, group, isMobile, dragging, load }) {
  const picker = showStudentPicker(board, loading, error, students);
  return (
    <div className="vb-board-body">
      {isMobile && <TeacherSwitch board={board} group={group} students={students} load={load} />}
      {loading && <div className="vb-board-status">Открываем доску…</div>}
      {error && !loading && (
        <div className="vb-board-status vb-board-status--error">
          {error}{" "}
          <button type="button" className="vb-link" onClick={() => load()}>Повторить</button>
        </div>
      )}
      {picker && <TeacherPickList group={group} students={students} load={load} />}
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
}

function TeacherStudentSelect({ students, group, studentId, load }) {
  if (!showStudentSelect(students, group)) return null;
  return (
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
  );
}

function TeacherSplitPortal({ model, chrome }) {
  const { open, board, error, loading, tab, setTab, students, studentId, group, load, toggle } = model;
  const { width, isMobile, dragging, startDrag } = chrome;
  const hidden = isMobile && tab !== "board";
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
          className={panelClassName(isMobile, hidden)}
          style={isMobile ? undefined : { width: `${width}px` }}
          data-testid="variant-board-panel"
        >
          {!isMobile && (
            <div className="vb-divider" onPointerDown={startDrag} role="separator" aria-orientation="vertical" title="Потяните, чтобы изменить ширину" />
          )}
          {!isMobile && (
            <div className="vb-panel-head">
              <button type="button" className="vb-close" onClick={toggle} aria-label="Закрыть доску" title="Закрыть доску">✕ Закрыть</button>
              <span className="vb-panel-title">{teacherBoardTitle(board)}</span>
              <TeacherSwitch board={board} group={group} students={students} load={load} />
              <TeacherStudentSelect students={students} group={group} studentId={studentId} load={load} />
            </div>
          )}
          <TeacherBoardBody
            board={board}
            loading={loading}
            error={error}
            students={students}
            group={group}
            isMobile={isMobile}
            dragging={dragging}
            load={load}
          />
        </aside>
      )}
    </>,
    document.body,
  );
}

function readOnlyPanelOpen(split, collapsed) {
  return Boolean(split && !collapsed);
}

export default function VariantBoardSplit({
  meetingUuid, liveSessionId, homeworkId, readOnly = false, presented,
}) {
  const request = variantBoardRequest({ meetingUuid, liveSessionId, homeworkId });
  const reqKey = request ? JSON.stringify(request) : "";
  const followRemote = Boolean(readOnly && presented === undefined);
  const remotePresented = useRemotePresented(meetingUuid, followRemote);
  const shownPresented = followRemote ? remotePresented : presented;
  const split = readOnly ? visibleStudentSplit(shownPresented) : null;
  const stamp = studentSplitStamp(shownPresented);
  const [hiddenStamp, setHiddenStamp] = useState("");
  const collapsed = Boolean(readOnly && stamp && hiddenStamp === stamp);
  const teacher = useTeacherBoard(meetingUuid, reqKey);
  const panelOpen = readOnly ? readOnlyPanelOpen(split, collapsed) : teacher.open;
  const chrome = useSplitWidth(panelOpen);
  if (typeof document === "undefined") return null;
  if (!readOnly && request) return <TeacherSplitPortal model={teacher} chrome={chrome} />;
  if (!readOnly || !meetingUuid) return null;
  return createPortal(
    <StudentSplitChrome
      split={split}
      collapsed={collapsed}
      onCollapse={() => setHiddenStamp(stamp)}
      onExpand={() => setHiddenStamp("")}
      width={chrome.width}
      isMobile={chrome.isMobile}
      dragging={chrome.dragging}
      onDragStart={chrome.startDrag}
    />,
    document.body,
  );
}
