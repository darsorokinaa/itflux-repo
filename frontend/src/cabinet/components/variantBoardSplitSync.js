import { ensureCsrfCookie, getCsrfToken } from "../../utils/cabinetAuth";
import { getAppVersion } from "../../utils/appVersion";

/** «Доска рядом» на живом уроке: сервер сам выбирает доску и рассылает сплит. */
export async function postVariantBoardSplit(meetingUuid, body) {
  await ensureCsrfCookie();
  const version = getAppVersion();
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(version && version !== "dev" ? { "X-Client-Version": version } : {}),
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;
  const res = await fetch(
    `/api/video-meetings/${meetingUuid}/variant-board-split/`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: JSON.stringify(body || {}),
    },
  );
  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const message =
      (typeof data?.detail === "string" && data.detail) ||
      (typeof data?.error === "string" && data.error) ||
      "Ошибка видеоконференции";
    const err = new Error(message);
    err.code = data?.code;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
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
