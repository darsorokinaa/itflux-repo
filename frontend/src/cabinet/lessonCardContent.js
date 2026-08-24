/**
 * Единое разрешение темы/курса для карточки урока.
 * Нельзя подставлять имя ученика, audience или «Материалы: …» вместо темы.
 */

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

export function eventAudienceNames(event) {
  const names = new Set();
  const add = (value) => {
    const n = normalizeName(value);
    if (n) names.add(n);
  };
  add(event?.title);
  add(event?.audience);
  const participants = Array.isArray(event?.participants) ? event.participants : [];
  participants.forEach((p) => {
    if (p?.role !== "organizer") add(p?.name);
  });
  return names;
}

function looksLikeAutoMaterialsTitle(title) {
  const t = String(title || "").trim();
  return /^материалы\s*:/i.test(t);
}

function isPoisonTopic(candidate, audienceNames) {
  const n = normalizeName(candidate);
  if (!n) return true;
  if (audienceNames.has(n)) return true;
  if (looksLikeAutoMaterialsTitle(candidate)) return true;
  return false;
}

/**
 * Тема урока: для будущего занятия — планируемая тема из плана на эту дату.
 * Для проведённого можно показать фактическую (event.topic).
 * Никогда не возвращает event.title / audience.
 */
export function resolveLessonTopic(event) {
  if (!event) return "";
  const audienceNames = eventAudienceNames(event);
  const planItem = event.planItem || (Array.isArray(event.planItems) ? event.planItems[0] : null);
  const isDone = event.status === "done" || event.status === "completed";

  const planned = String(event.plannedTopic || planItem?.topic || "").trim();
  const planTitle = String(planItem?.title || "").trim();
  const fromPlan = planned && !isPoisonTopic(planned, audienceNames)
    ? planned
    : (planTitle && !isPoisonTopic(planTitle, audienceNames) ? planTitle : "");

  if (!isDone && fromPlan) return fromPlan;

  const direct = String(event.topic || "").trim();
  if (direct && !isPoisonTopic(direct, audienceNames)) return direct;

  return fromPlan;
}

export function resolveLessonTopicOrPlaceholder(event) {
  return resolveLessonTopic(event) || "Тема урока не указана";
}

/** Курс/план: скрываем авто-план «Материалы: …». */
export function resolveLessonCourseTitle(event) {
  if (!event) return "";
  if (event.isAutoMaterialsPlan) return "";
  const planItem = event.planItem || (Array.isArray(event.planItems) ? event.planItems[0] : null);
  const title = String(planItem?.planTitle || event.linkedPlanTitle || "").trim();
  if (!title || looksLikeAutoMaterialsTitle(title)) return "";
  return title;
}

export function resolveLessonSubjectLabel(event) {
  return String(event?.studentSubjectLabel || "").trim();
}

export function resolveLessonDescription(event) {
  if (!event) return "";
  const planItem = event.planItem || (Array.isArray(event.planItems) ? event.planItems[0] : null);
  const fromEvent = String(event.description || "").trim();
  if (fromEvent) return fromEvent;
  return String(planItem?.description || "").trim();
}
