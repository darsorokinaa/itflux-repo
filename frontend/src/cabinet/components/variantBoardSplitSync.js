/** r145: «Доска рядом» — общая tldraw-доска справа от варианта. */
export const VB_WIDTH_KEY = "variantBoardSplitWidth";
export const VB_MIN = 320;
export const VB_MOBILE_MAX = 768;

export function clampBoardWidth(width, viewport) {
  const vw = Number(viewport) || 1280;
  const max = Math.max(VB_MIN, vw - 360);
  const n =
    width === null || width === undefined || width === "" ? NaN : Number(width);
  if (!Number.isFinite(n))
    return Math.round(Math.min(max, Math.max(VB_MIN, vw * 0.45)));
  return Math.round(Math.min(max, Math.max(VB_MIN, n)));
}

export function variantBoardRequest({
  meetingUuid,
  liveSessionId,
  homeworkId,
}) {
  if (meetingUuid) return { meeting: meetingUuid };
  if (liveSessionId) return { live_session: liveSessionId };
  if (homeworkId) return { homework_id: homeworkId };
  return null;
}

/** r148: тело запроса с выбором — только 'group' или id ученика (учитель) / 'mine'|'group' (ученик). */
export function variantBoardPickBody(base, pick) {
  const body = { ...(base || {}) };
  if (pick === "group" || pick === "mine") body.target = pick;
  else if (pick !== null && pick !== undefined && pick !== "")
    body.student_id = pick;
  return body;
}

export function variantBoardFrameSrc(boardId) {
  return `/cabinet/boards/${encodeURIComponent(boardId)}?embed=variant`;
}

export function readWidth() {
  try {
    return clampBoardWidth(
      window.localStorage.getItem(VB_WIDTH_KEY),
      window.innerWidth,
    );
  } catch {
    return clampBoardWidth(
      null,
      typeof window !== "undefined" ? window.innerWidth : 1280,
    );
  }
}

/** Тело POST сплита: доску выбирает сервер, id доски клиент не передаёт. */
export function boardSplitSyncBody(open, pick) {
  const body = { open: Boolean(open) };
  if (!open) return body;
  if (pick === "group" || pick === "mine") body.target = pick;
  else if (pick !== null && pick !== undefined && pick !== "")
    body.studentId = pick;
  return body;
}

/** Сплит ученика: только если сервер отдал именно его доску. */
export function visibleStudentSplit(presented) {
  const split = presented?.boardSplit;
  if (!split || split.open !== true) return null;
  const boardId = String(split.boardId || "").trim();
  if (!boardId) return null;
  return {
    open: true,
    kind: split.kind === "group" ? "group" : "student",
    boardId,
    studentId: split.studentId ?? null,
  };
}

/** Новое действие учителя (другой presentedAt / доска) снова раскрывает панель. */
export function studentSplitStamp(presented) {
  const split = presented?.boardSplit || {};
  return [
    presented?.presentedAt || "",
    split.open ? "1" : "0",
    split.boardId || "",
    split.kind || "",
    split.studentId ?? "",
  ].join("|");
}
