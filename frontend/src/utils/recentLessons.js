/** Last viewed lessons/variants in localStorage. Not a new backend history model. */

const LESSONS_KEY = "itflux_recent_lessons";
const VARIANT_KEY = "itflux_last_variant";
const PAYWALL_VIEWS_KEY = "itflux_paywall_views";
const MAX_LESSONS = 8;

function readJson(key, fallback) {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function rememberRecentLesson(lesson) {
  if (!lesson?.slug) return;
  const item = {
    slug: lesson.slug,
    title: String(lesson.title || "").slice(0, 160),
    subject: String(lesson.subject || "").slice(0, 80),
    viewedAt: Date.now(),
  };
  const prev = readJson(LESSONS_KEY, []);
  const next = [item, ...prev.filter((row) => row?.slug !== item.slug)].slice(0, MAX_LESSONS);
  writeJson(LESSONS_KEY, next);
}

export function readRecentLessons() {
  const rows = readJson(LESSONS_KEY, []);
  return Array.isArray(rows) ? rows.filter((row) => row?.slug) : [];
}

export function rememberLastVariant(payload) {
  if (!payload?.variantId) return;
  writeJson(VARIANT_KEY, {
    level: String(payload.level || ""),
    subject: String(payload.subject || ""),
    variantId: payload.variantId,
    viewedAt: Date.now(),
  });
}

export function readLastVariant() {
  const row = readJson(VARIANT_KEY, null);
  if (!row?.variantId || !row.level || !row.subject) return null;
  return row;
}

export function bumpPaywallViews(scope = "lesson") {
  const all = readJson(PAYWALL_VIEWS_KEY, {});
  const key = String(scope || "lesson");
  const next = { ...all, [key]: Number(all[key] || 0) + 1 };
  writeJson(PAYWALL_VIEWS_KEY, next);
  return next[key];
}

export function readPaywallViews(scope = "lesson") {
  const all = readJson(PAYWALL_VIEWS_KEY, {});
  return Number(all[String(scope || "lesson")] || 0);
}

export function pickTryNowLessons(lessons, { subject = "", limit = 6 } = {}) {
  const list = Array.isArray(lessons) ? lessons : [];
  const ready = list.filter((lesson) => (
    lesson?.slug
    && (lesson.archive_url || lesson.file_url || lesson.access?.demo_available || lesson.access?.can_view)
  ));
  const pool = subject
    ? ready.filter((lesson) => String(lesson.subject || "") === subject)
    : ready;
  const source = pool.length >= 3 ? pool : ready;
  const score = (lesson) => {
    let value = 0;
    if (lesson.is_new) value += 8;
    if (lesson.access?.demo_available || lesson.access?.can_start_demo) value += 4;
    if (lesson.archive_url || lesson.file_url) value += 3;
    value += Math.min(Number(lesson.views_count) || 0, 200) / 40;
    value += Math.min(Number(lesson.likes_count) || 0, 50) / 10;
    return value;
  };
  return [...source].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

export function similarLessons(lessons, current, limit = 4) {
  if (!current?.slug) return [];
  const list = Array.isArray(lessons) ? lessons : [];
  const scored = list
    .filter((lesson) => lesson?.slug && lesson.slug !== current.slug)
    .filter((lesson) => !current.subject || lesson.subject === current.subject)
    .map((lesson) => {
      let value = 0;
      if (lesson.subject && lesson.subject === current.subject) value += 4;
      if (lesson.grade && lesson.grade === current.grade) value += 3;
      if (lesson.topic && lesson.topic === current.topic) value += 5;
      if (lesson.subtopic && lesson.subtopic === current.subtopic) value += 4;
      if (lesson.exam_type && lesson.exam_type === current.exam_type) value += 2;
      if (lesson.task_number && lesson.task_number === current.task_number) value += 3;
      return { lesson, value };
    })
    .filter((row) => row.value >= 5)
    .sort((a, b) => b.value - a.value);
  return scored.slice(0, limit).map((row) => row.lesson);
}

export function subscriptionBreakEven(lessonPrice, planPrice) {
  const lesson = Number(lessonPrice);
  const plan = Number(planPrice);
  if (!lesson || !plan || lesson <= 0 || plan <= 0) return null;
  return Math.max(2, Math.ceil(plan / lesson));
}
