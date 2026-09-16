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

const LESSON_SLUG_RE = /^[A-Za-z0-9][-A-Za-z0-9_]{0,119}$/;

/** Slug каталожного урока из /lessons?preview=… или /lessons/:slug[/view]. */
export function catalogLessonSlugFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const abs = raw.startsWith("http")
      ? new URL(raw)
      : new URL(raw, "https://local.invalid");
    const preview = (abs.searchParams.get("preview") || "").trim();
    if (LESSON_SLUG_RE.test(preview)) return preview;
    const parts = abs.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("lessons");
    if (idx < 0 || idx + 1 >= parts.length) return "";
    const slug = parts[idx + 1];
    if (["view", "archive", "demo", "purchase", "purchases"].includes(slug)) return "";
    return LESSON_SLUG_RE.test(slug) ? slug : "";
  } catch {
    return "";
  }
}

/** В комнате открываем HTML урока, а не карточку каталога. */
export function meetingLessonContentUrl(url) {
  const raw = String(url || "").trim();
  const slug = catalogLessonSlugFromUrl(raw);
  if (!slug) return raw;
  return `/api/lessons/${encodeURIComponent(slug)}/view/`;
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

export function variantIdFromUrl(url) {
  const m = String(url || "").match(/\/variant\/(\d+)/i);
  return m ? m[1] : "";
}

export function homeworkIdFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const abs = raw.startsWith("http") ? new URL(raw) : new URL(raw, "https://local.invalid");
    return String(abs.searchParams.get("cabinet_assignment") || "").trim();
  } catch {
    return "";
  }
}

export function boardIdFromUrl(url) {
  const m = String(url || "").match(/\/cabinet\/boards\/([^/?#]+)/i);
  return m ? m[1] : "";
}

/** Стабильный ключ попытки/материала: без presentedAt и без lesson_token. */
export function presentedIdentityKey(presented) {
  if (!presented?.kind) return "";
  const id = presented.boardId
    || presented.homeworkId
    || presented.materialId
    || presented.variantId
    || variantIdFromUrl(presented.openUrl)
    || boardIdFromUrl(presented.openUrl)
    || "";
  return `${presented.kind}:${id}`;
}

export function presentedOpenKey(presented) {
  // Не включаем openUrl/presentedAt: повторный SHOW и poll с новым token не должны
  // считаться новым материалом.
  return presentedIdentityKey(presented);
}

export function workspaceMaterialIdentityKey(material) {
  if (!material?.kind) return "";
  if (material.kind === "board") {
    return `board:${material.boardId || boardIdFromUrl(material.url)}`;
  }
  if (material.kind === "variant") {
    const hw = material.homeworkId || homeworkIdFromUrl(material.url);
    const vid = material.variantId || variantIdFromUrl(material.url);
    return `variant:${hw || vid}`;
  }
  return `${material.kind}:${String(material.url || material.text || "").split("?")[0]}`;
}

export function materialRowIdentityKey(row, presented) {
  if (!row?.kind) return "";
  if (row.kind === "board") {
    return `board:${row.boardId || boardIdFromUrl(row.url)}`;
  }
  if (row.kind === "variant") {
    const hw = presented?.kind === "variant" ? presented.homeworkId : null;
    const vid = presented?.kind === "variant" ? presented.variantId : null;
    return `variant:${hw || vid || variantIdFromUrl(row.url || presented?.openUrl)}`;
  }
  return `${row.kind}:${String(row.url || row.text || "").split("?")[0]}`;
}

export function shouldReplaceWorkspaceMaterial(current, incoming) {
  if (!incoming) return false;
  if (!current) return true;
  const a = workspaceMaterialIdentityKey(current);
  const b = workspaceMaterialIdentityKey(incoming);
  if (!a || !b) return true;
  return a !== b;
}

export function workspaceMaterialFromPresented(presented, meetingUuid) {
  if (!presented?.kind) return null;
  const url = String(presented.openUrl || "").trim();
  if (!url) return null;
  return {
    kind: presented.kind,
    title: presented.title || "Материал",
    url,
    boardId: presented.boardId || null,
    homeworkId: presented.homeworkId || null,
    variantId: presented.variantId || null,
    embed: shouldEmbedMaterialInLesson(url, { meetingUuid }),
  };
}

export function logVariantLifecycle(event, extra) {
  try {
    if (import.meta.env?.DEV) {
      console.debug(`[variant] ${event}`, extra ?? "");
    }
  } catch {
    /* ignore */
  }
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
