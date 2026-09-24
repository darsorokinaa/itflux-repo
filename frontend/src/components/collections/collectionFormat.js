export function lessonHref(collectionSlug, lesson) {
  if (lesson?.url) return lesson.url;
  if (!collectionSlug || !lesson?.slug) return "/lessons";
  const path = lesson.kind === "trainer"
    ? `/interesting/${encodeURIComponent(lesson.slug)}/view`
    : `/lessons/${encodeURIComponent(lesson.slug)}/view`;
  return `${path}?collection=${encodeURIComponent(collectionSlug)}`;
}

export function isDirectFileHref(href) {
  return typeof href === "string" && href.includes("/files/");
}

export function hoursLabel(count) {
  const value = Math.abs(Number(count) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "час";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "часа";
  return "часов";
}

export function lessonsLabel(count) {
  const value = Math.abs(Number(count) || 0);
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "урок";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "урока";
  return "уроков";
}

export function formatDuration(minutes) {
  const value = Number(minutes);
  if (!value) return "";
  if (value < 60) return `${value} мин`;
  const hours = Math.max(1, Math.round(value / 60));
  return `около ${hours} ${hoursLabel(hours)}`;
}

export function formatLessonDuration(minutes) {
  const value = Number(minutes);
  if (!value) return "";
  return `${value} мин`;
}

export function collectionMetaLine(collection) {
  return [
    collection?.subject || null,
    collection?.grade ? `${collection.grade} класс` : null,
  ].filter(Boolean).join(" · ");
}

export function lockReason(access) {
  const plan = access?.plans?.[0]?.name || access?.required_plan_name || "";
  if (access?.can_purchase && plan) {
    return plan ? `Доступен после покупки набора или на тарифе «${plan}»` : "Доступен после покупки набора";
  }
  if (access?.can_purchase) return "Доступен после покупки набора";
  if (plan) return `Доступен на тарифе «${plan}»`;
  return "Урок пока закрыт";
}

export function continueLabel(collection) {
  const lesson = collection?.continue_lesson;
  const viewed = collection?.progress?.viewed || 0;
  if (lesson?.number && viewed > 0) return `Продолжить с урока ${lesson.number}`;
  if (viewed > 0 || collection?.has_started) return "Продолжить";
  return "Начать";
}
