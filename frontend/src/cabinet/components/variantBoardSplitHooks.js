import { useEffect, useRef, useState } from "react";
import {
  fetchVariantBoard,
  postVariantBoardSplit,
} from "../../utils/cabinetAuth";
import { boardSplitSyncBody } from "./variantBoardSplitSync";
import {
  clampBoardWidth,
  readWidth,
  variantBoardPickBody,
  VB_MOBILE_MAX,
  VB_WIDTH_KEY,
} from "./variantBoardSplitSync";

export function useIsMobile() {
  const q = `(max-width: ${VB_MOBILE_MAX}px)`;
  const [m, setM] = useState(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return false;
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

function publishSplit(meetingUuid, open, pick) {
  if (!meetingUuid) return;
  postVariantBoardSplit(meetingUuid, boardSplitSyncBody(open, pick)).catch(
    (e) => {
      if (e?.status === 409) return;
    },
  );
}

function pickFromBoard(board) {
  if (!board) return null;
  if (board.kind === "group") return "group";
  return board.studentId ?? null;
}

export function teacherBoardTitle(board) {
  if (board?.kind === "group")
    return `Доска группы: ${board.group?.title || ""}`;
  if (board?.studentName) return `Доска ученика: ${board.studentName}`;
  return board?.title || "Доска";
}

export function showStudentPicker(board, loading, error, students) {
  if (board || loading || error) return false;
  return Boolean(students);
}

export function showStudentSelect(students, group) {
  if (!students) return false;
  return students.length > 1 || Boolean(group);
}

export function panelClassName(isMobile, hidden) {
  const mobile = isMobile ? " vb-panel--mobile" : "";
  const off = hidden ? " vb-panel--hidden" : "";
  return `vb-panel${mobile}${off}`;
}

async function loadTeacherBoard(meetingUuid, reqKey, pickId, api) {
  if (!reqKey) return;
  api.setLoading(true);
  api.setError("");
  try {
    const data = await fetchVariantBoard(
      variantBoardPickBody(JSON.parse(reqKey), pickId),
    );
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

export function useSplitWidth(panelOpen) {
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
    const onResize = () =>
      setWidth((w) => clampBoardWidth(w, window.innerWidth));
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

export function useTeacherBoard(meetingUuid, reqKey) {
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
  return {
    open,
    board,
    error,
    loading,
    tab,
    setTab,
    students,
    studentId,
    group,
    load,
    toggle,
  };
}
