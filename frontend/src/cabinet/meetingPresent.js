/** Хелперы показа материала во время видеоурока. */

export const MEETING_CALL_CHANNEL = "itflux-meeting-call";

export function appendMeetingParam(url, meetingUuid) {
  const raw = String(url || "").trim();
  if (!raw || !meetingUuid) return raw;
  try {
    const abs = raw.startsWith("http")
      ? new URL(raw)
      : new URL(raw, window.location.origin);
    abs.searchParams.set("meeting", String(meetingUuid));
    if (raw.startsWith("http")) return abs.toString();
    return `${abs.pathname}${abs.search}${abs.hash}`;
  } catch {
    const sep = raw.includes("?") ? "&" : "?";
    return `${raw}${sep}meeting=${encodeURIComponent(String(meetingUuid))}`;
  }
}

/** Параметры live-варианта для учителя/ученика на SPA-странице. */
export function appendLiveVariantParams(url, { homeworkId, meetingUuid } = {}) {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  try {
    const abs = raw.startsWith("http")
      ? new URL(raw)
      : new URL(raw, window.location.origin);
    if (homeworkId) {
      abs.searchParams.set("cabinet_assignment", String(homeworkId));
      abs.searchParams.set("homework_mode", "1");
      abs.searchParams.set("live_meeting", "1");
    }
    if (meetingUuid) {
      abs.searchParams.set("meeting", String(meetingUuid));
    }
    if (raw.startsWith("http")) return abs.toString();
    return `${abs.pathname}${abs.search}${abs.hash}`;
  } catch {
    return appendMeetingParam(raw, meetingUuid);
  }
}

export function presentedOpenKey(presented) {
  if (!presented?.kind) return "";
  // Не включаем openUrl: у ученика в ссылку каждый раз попадает новый lesson_token.
  const id = presented.boardId
    || presented.homeworkId
    || presented.materialId
    || presented.variantId
    || "";
  return `${presented.kind}:${id}:${presented.presentedAt || ""}`;
}

/**
 * Открыть материал в новой вкладке.
 * Каждый материал — отдельная вкладка (_blank).
 * При блокировке попапа — переход в этой же вкладке.
 * @returns {"tab"|"same"|"failed"}
 */
export function openPresentedMaterial(url) {
  const target = String(url || "").trim();
  if (!target) return "failed";
  try {
    // Не передаём "noopener" в features: иначе window.open часто возвращает null,
    // и мы ошибочно уходим location.assign на вкладке звонка.
    const popup = window.open(target, "_blank");
    if (popup && !popup.closed) {
      try {
        popup.opener = null;
      } catch {
        /* ignore */
      }
      return "tab";
    }
  } catch {
    /* fallback below */
  }
  try {
    window.location.assign(target);
    return "same";
  } catch {
    return "failed";
  }
}

export function postMeetingCallMessage(payload) {
  try {
    const channel = new BroadcastChannel(MEETING_CALL_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  } catch {
    /* BroadcastChannel может быть недоступен */
  }
}

/** Учитель скрыл материал — все вкладки возвращаются к звонку. */
export function postMeetingUnpresent(meetingUuid) {
  if (!meetingUuid) return;
  postMeetingCallMessage({ type: "unpresent", meetingUuid: String(meetingUuid) });
}
