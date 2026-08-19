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
  if (lessonHasActiveDemo(lesson)) {
    return getLessonContentUrl(lesson.slug);
  }
  const fileExtLower = (lesson.file_url || "").toLowerCase().split("?")[0];
  const isReactViewer = Boolean(
    !lesson.archive_url && lesson.file_url && !fileExtLower.endsWith(".html"),
  );
  if (isReactViewer) {
    return `/lessons/${encodeURIComponent(lesson.slug)}/view`;
  }
  if (lesson.archive_url || lesson.file_url) {
    return getLessonContentUrl(lesson.slug);
  }
  return null;
}

export function getLessonCardActionLabel(lesson) {
  if (lessonHasActiveDemo(lesson)) return "Продолжить демо";
  if (lesson?.access?.can_view === false || lesson?.access?.allowed === false) return "Подробнее";
  if (lesson?.status === "draft") return "Редактировать";
  return "Открыть";
}
