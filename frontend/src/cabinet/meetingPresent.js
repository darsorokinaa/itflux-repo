/** Хелперы показа материала во время видеоурока. */

/** Не встраивать страницу самого звонка — получится двойной Jitsi в iframe. */
export function isLessonWorkspaceSelfMeetingUrl(url, meetingUuid) {
  const raw = String(url || "").trim();
  if (!raw || !meetingUuid) return false;
  return /\/cabinet\/meetings\//i.test(raw) && String(raw).includes(String(meetingUuid));
}

/**
 * Любой материал с URL показываем в рабочей области урока.
 * Внешняя вкладка / Safari не используются.
 */
export function shouldEmbedMaterialInLesson(url, { meetingUuid } = {}) {
  const raw = String(url || "").trim();
  if (!raw) return false;
  if (isLessonWorkspaceSelfMeetingUrl(raw, meetingUuid)) return false;
  return true;
}

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
 * @deprecated Материалы урока открываются в рабочей области, не во внешней вкладке.
 * Нельзя location.assign — на iOS PWA это выкидывает из комнаты в Safari.
 */
export function openPresentedMaterial() {
  return "in-room";
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
