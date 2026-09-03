const STATUS_LABELS = {
  draft: "Черновик",
  published: "Опубликован",
  archived: "Архив",
};

const STATUS_TONES = {
  draft: "draft",
  published: "default",
  archived: "completed",
};

const DIFFICULTY_LABELS = {
  beginner: "Начальный",
  medium: "Средний",
  advanced: "Продвинутый",
};

const EXAM_LABELS = {
  oge: "ОГЭ",
  ege: "ЕГЭ",
};

export function lessonMediaUrl(url) {
  if (!url) return null;
  const idx = url.indexOf("/media/");
  if (idx >= 0) return url.slice(idx);
  return url;
}

export function lessonSubjectLine(lesson) {
  const parts = [];
  if (lesson.exam_type && EXAM_LABELS[lesson.exam_type]) {
    parts.push(EXAM_LABELS[lesson.exam_type]);
  } else if (lesson.level) {
    parts.push(lesson.level);
  }
  if (lesson.subject) parts.push(lesson.subject);
  if (lesson.grade) parts.push(`${lesson.grade} класс`);
  return parts.join(" · ") || "Урок";
}

export function lessonDescription(lesson) {
  if (lesson.short_description) return lesson.short_description;
  const parts = [];
  if (lesson.topic) parts.push(lesson.topic);
  if (lesson.subtopic) parts.push(lesson.subtopic);
  return parts.join(" · ");
}

export function lessonMetaLine(lesson) {
  const parts = [];
  if (lesson.duration_minutes) parts.push(`${lesson.duration_minutes} мин`);
  if (lesson.difficulty && DIFFICULTY_LABELS[lesson.difficulty]) {
    parts.push(DIFFICULTY_LABELS[lesson.difficulty]);
  }
  if (lesson.task_number) parts.push(`Задание ${lesson.task_number}`);
  return parts.join(" · ");
}

export function lessonCoverImageUrl(lesson) {
  return lessonMediaUrl(lesson.cover_image_url)
    || lessonMediaUrl(lesson.card_background_image_url);
}

export function mapLessonToHomeworkCard(lesson) {
  return {
    id: lesson.id,
    slug: lesson.slug,
    coverImageUrl: lessonCoverImageUrl(lesson),
    coverBgColor: lesson.card_background_color || undefined,
    deadlineLabel: STATUS_LABELS[lesson.status] || lesson.status,
    deadlineTone: STATUS_TONES[lesson.status] || "default",
    subject: lessonSubjectLine(lesson),
    title: lesson.title,
    description: lessonDescription(lesson),
    progressLabel: lessonMetaLine(lesson) || undefined,
    hideProgressBar: true,
    actionLabel: getLessonCardActionLabel(lesson),
    actionPrimary: true,
    lesson,
  };
}

export function libraryLessonMatchesFilter(lesson, filter) {
  if (filter === "all") return true;
  if (filter === "oge") return lesson.exam_type === "oge";
  if (filter === "ege") return lesson.exam_type === "ege";
  if (filter === "python") {
    const hay = `${lesson.subject || ""} ${lesson.level || ""} ${lesson.topic || ""}`.toLowerCase();
    return hay.includes("python");
  }
  if (filter === "fipi") {
    const hay = `${lesson.topic || ""} ${lesson.title || ""} ${lesson.subtopic || ""}`.toLowerCase();
    return hay.includes("фипи") || Boolean(lesson.task_number);
  }
  return true;
}

export function lessonMatchesFilter(lesson, filter) {
  return libraryLessonMatchesFilter(lesson, filter);
}

export function getLessonContentUrl(slug) {
  if (!slug) return null;
  return `/api/lessons/${encodeURIComponent(slug)}/view/`;
}

export function getLessonViewerUrl(slug) {
  if (!slug) return null;
  return `/lessons/${encodeURIComponent(slug)}/view`;
}

export function lessonPreviewUrl(slug, extra = {}) {
  if (!slug) return "/lessons";
  const params = new URLSearchParams({ preview: slug });
  Object.entries(extra).forEach(([key, value]) => {
    if (value != null && value !== "") params.set(key, String(value));
  });
  return `/lessons?${params.toString()}`;
}

export function lessonHasActiveDemo(lesson) {
  const access = lesson?.access;
  return access?.demo_active === true || access?.can_continue_demo === true;
}

export function lessonCanPurchase(lesson) {
  const access = lesson?.access || {};
  return Boolean(
    access.can_purchase
    && access.standalone_purchase_available
    && access.standalone_price != null,
  );
}

export function formatLessonPrice(amount, currency = "RUB") {
  if (amount == null) return "";
  const number = Number(amount);
  if (Number.isNaN(number)) return String(amount);
  const formatted = Number.isInteger(number)
    ? number.toLocaleString("ru-RU")
    : number.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "RUB" ? `${formatted} ₽` : `${formatted} ${currency}`;
}

export function lessonPurchaseLabel(lesson) {
  const access = lesson?.access || {};
  return `Купить за ${formatLessonPrice(access.standalone_price, access.standalone_currency)}`;
}

export function getLessonOpenUrl(lesson) {
  if (!lesson?.slug) return null;
  const locked = lesson?.access?.can_view === false || lesson?.access?.allowed === false;
  if (lessonHasActiveDemo(lesson) || locked || lesson.archive_url || lesson.file_url) {
    return lessonPreviewUrl(lesson.slug);
  }
  return null;
}

export function getLessonCardActionLabel(lesson) {
  if (lessonHasActiveDemo(lesson)) return "Продолжить урок";
  if (lesson?.access?.can_view === false || lesson?.access?.allowed === false) return "Открыть урок";
  if (lesson?.status === "draft") return "Редактировать";
  return "Открыть урок";
}

const INCLUDE_DEFS = [
  { id: "theory", label: "Теория", test: /теор|объяснен|презентац/i },
  { id: "practice", label: "Практика", test: /практик|пример|упражнен|тренир/i },
  { id: "interactive", label: "Интерактив", test: /интерактив/i },
  { id: "homework", label: "Домашнее задание", test: /домашн|\bдз\b|рабоч(?:ий|его)\s+лист/i },
  { id: "notes", label: "Материалы для преподавателя", test: /заметк|преподавател|учитель/i },
];

export function inferLessonIncludes(lesson) {
  const text = [
    lesson?.short_description,
    lesson?.teacher_goal,
    lesson?.student_result,
  ]
    .filter(Boolean)
    .join(" ");
  const items = INCLUDE_DEFS.filter((item) => item.test.test(text)).map((item) => ({
    id: item.id,
    label: item.label,
  }));
  const hasInteractiveFile = Boolean(lesson?.archive_url || lesson?.file_url);
  if (hasInteractiveFile && !items.some((item) => item.id === "interactive")) {
    items.splice(Math.min(2, items.length), 0, { id: "interactive", label: "Интерактив" });
  }
  return items;
}

export function lessonExamLabel(lesson) {
  if (lesson?.exam_type === "oge") return "ОГЭ";
  if (lesson?.exam_type === "ege") return "ЕГЭ";
  return "";
}

export function lessonIsReadyToRun(lesson) {
  const access = lesson?.access || {};
  return Boolean(
    lesson?.archive_url
    || lesson?.file_url
    || access.can_view
    || access.demo_available
    || access.can_start_demo
    || access.demo_active
    || access.can_continue_demo,
  );
}

export function userFacingAccessCtaLabel(cta, { demoActive = false } = {}) {
  if (!cta) return "Открыть урок";
  if (cta.type === "demo") return demoActive ? "Продолжить урок" : "Открыть урок";
  if (cta.type === "register") return "Создать аккаунт и открыть урок";
  if (cta.type === "open") return cta.label && cta.label !== "Открыть" ? cta.label : "Открыть урок";
  if (cta.type === "purchase") {
    const price = String(cta.label || "").replace(/^Купить за\s+/i, "").trim();
    return price ? `Открыть этот урок отдельно · ${price}` : "Открыть этот урок отдельно";
  }
  if (cta.type === "upgrade") return "Получить доступ ко всем материалам";
  return cta.label;
}

export function lessonFormatLabel(lesson) {
  if (lesson?.archive_url || lesson?.file_url) return "Интерактивный урок";
  const access = lesson?.access || {};
  if (access.demo_available || access.can_start_demo || access.demo_active) return "Интерактивный урок";
  return "";
}
