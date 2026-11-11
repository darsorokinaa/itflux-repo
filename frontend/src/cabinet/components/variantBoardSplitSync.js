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
