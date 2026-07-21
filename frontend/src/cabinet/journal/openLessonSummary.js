/** Schedule event id may be `local-50` on the frontend — journal API needs numeric pk. */
export function journalEventPk(eventId) {
  const text = String(eventId || "").trim();
  if (!text) return null;
  if (text.startsWith("local-")) {
    const n = Number(text.slice(6));
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function lessonSummaryPath(eventId) {
  const pk = journalEventPk(eventId);
  return pk ? `/cabinet/journal/lesson/${pk}` : null;
}

/** Opens detailed lesson summary in a new browser tab. */
export function openLessonSummaryTab(eventId) {
  const path = lessonSummaryPath(eventId);
  if (!path) return false;
  window.open(path, "_blank", "noopener,noreferrer");
  return true;
}
