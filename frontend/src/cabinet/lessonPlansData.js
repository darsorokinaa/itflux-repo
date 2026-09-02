import { pickCoverVariant } from "./CabinetHomeworkCard";

export const PLAN_FILTERS = [
  { id: "all", label: "Все" },
  { id: "math", label: "Математика" },
  { id: "physics", label: "Физика" },
  { id: "informatics", label: "Информатика" },
  { id: "russian", label: "Русский язык" },
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
  { id: "draft", label: "Черновики" },
  { id: "published", label: "Опубликованные" },
];

export const PLAN_SCOPE_FILTERS = [
  { id: "mine", label: "Мои планы" },
  { id: "catalog", label: "Готовые планы" },
];

export const PLAN_CATALOG_FILTERS = PLAN_FILTERS.filter(
  (filter) => filter.id !== "draft" && filter.id !== "published",
);

export const PLAN_STATUS_LABELS = {
  draft: "Черновик",
  published: "Опубликован",
  archived: "В архиве",
};

export function planCanBeAttached(plan) {
  return plan?.status === "published";
}

export const ITEM_STATUS_LABELS = {
  not_started: "Не начато",
  planned: "Запланировано",
  completed: "Выполнено",
  skipped: "Пропущено",
  repeat_needed: "Нужно повторить",
};

export const ENROLLMENT_STATUS_LABELS = {
  active: "Активно",
  paused: "На паузе",
  completed: "Завершено",
  cancelled: "Отменено",
};

const PLAN_DIRECTION_LABELS = {
  vpr: "ВПР",
  oge: "ОГЭ",
  ege: "ЕГЭ",
  python: "Python",
  school: "Школьная программа",
  other: "Другое",
};

export const PLAN_LEVELS = [
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
  { id: "school", label: "Школьная программа" },
  { id: "vpr", label: "ВПР" },
];

export const PLAN_SUBJECTS = [
  { id: "inf", label: "Информатика" },
  { id: "math", label: "Математика" },
  { id: "phys", label: "Физика" },
  { id: "prog", label: "Программирование" },
  { id: "rus", label: "Русский язык" },
  { id: "other", label: "Другое" },
];

const PLAN_SUBJECT_LABELS = {
  inf: "Информатика",
  informatics: "Информатика",
  math: "Математика",
  math_base: "Математика базовая",
  phys: "Физика",
  physics: "Физика",
  prog: "Программирование",
  programming: "Программирование",
  rus: "Русский язык",
  russian: "Русский язык",
  other: "Другое",
};

const PLAN_SUBJECT_ALIASES = {
  informatics: "inf",
  inf: "inf",
  math: "math",
  math_base: "math",
  physics: "phys",
  phys: "phys",
  rus: "rus",
  russian: "rus",
  prog: "prog",
  programming: "prog",
};

export function canonicalPlanSubjectId(subjectId) {
  const id = String(subjectId || "").trim().toLowerCase();
  if (!id) return "";
  return PLAN_SUBJECT_ALIASES[id] || id;
}

export function canonicalizePlanSubjectId(value, optionIds = []) {
  const ids = new Set((optionIds || []).map(String));
  const current = String(value || "").trim();
  if (!current) return "";
  if (ids.has(current)) return current;

  const lower = current.toLowerCase();
  if (ids.has(lower)) return lower;

  const canonical = PLAN_SUBJECT_ALIASES[lower] || lower;
  if (ids.has(canonical)) return canonical;

  for (const [from, to] of Object.entries(PLAN_SUBJECT_ALIASES)) {
    if (to === canonical && ids.has(from)) return from;
  }

  return current;
}

export function resolvePlanSubjectSelection(value, options = PLAN_SUBJECTS) {
  const list = Array.isArray(options) && options.length ? options : PLAN_SUBJECTS;
  const current = String(value || "").trim();
  if (!current) return "";

  const byId = list.find((item) => String(item.id) === current || String(item.id).toLowerCase() === current.toLowerCase());
  if (byId) return byId.id;

  const byLabel = list.find((item) => String(item.label).toLowerCase() === current.toLowerCase());
  if (byLabel) return byLabel.id;

  return canonicalizePlanSubjectId(current, list.map((item) => item.id));
}

export function planSubjectLabelFromId(subjectId) {
  const id = String(subjectId || "").trim();
  if (!id) return "";
  if (PLAN_SUBJECT_LABELS[id]) return PLAN_SUBJECT_LABELS[id];
  const canonical = canonicalPlanSubjectId(id);
  return PLAN_SUBJECT_LABELS[canonical] || PLAN_SUBJECT_LABELS[id.toLowerCase()] || "";
}

export function planLevelLabelFromId(levelId) {
  return PLAN_DIRECTION_LABELS[levelId] || "";
}

const PLAN_LEVEL_ALIASES = {
  "огэ": "oge",
  "егэ": "ege",
  "ёгэ": "ege",
  "впр": "vpr",
  "школа": "school",
  "школьная программа": "school",
  "школьная база": "school",
};

export function resolvePlanLevelSelection(value, options = PLAN_LEVELS) {
  const list = Array.isArray(options) && options.length ? options : PLAN_LEVELS;
  const current = String(value || "").trim();
  if (!current) return "";

  const lower = current.toLowerCase();
  const canonical = PLAN_LEVEL_ALIASES[lower] || lower;
  const match = list.find((item) => {
    const id = String(item.id).toLowerCase();
    return id === lower || id === canonical;
  });
  return match ? match.id : current;
}

export function planSubjectsMatch(planSubject, studentSubject) {
  const a = canonicalPlanSubjectId(planSubject);
  const b = canonicalPlanSubjectId(studentSubject);
  if (!a || !b) return true;
  return a === b;
}

export function defaultSubjectForDirection(direction) {
  if (direction === "school") return "prog";
  if (direction === "vpr") return "math";
  return "inf";
}

const PLAN_STATUS_TONES = {
  draft: "draft",
  published: "default",
  archived: "completed",
};

export function planStatusTone(status) {
  if (status === "published") return "info";
  if (status === "archived") return "gray";
  return "draft";
}

export function planSubjectLine(plan) {
  const parts = [];
  const subject = plan.subjectLabel || planSubjectLabelFromId(plan.subject);
  if (subject) parts.push(subject);
  const direction = PLAN_DIRECTION_LABELS[plan.direction] || plan.directionLabel;
  if (direction) parts.push(direction);
  if (plan.grade) parts.push(`${plan.grade} класс`);
  return parts.join(" · ") || "План уроков";
}

export function planDescription(plan) {
  if (plan.description) return plan.description;
  if (plan.goal) return plan.goal;
  if (plan.isPublic) return "Публичный шаблон";
  return "";
}

function planLessonsWord(n) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return "занятие";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "занятия";
  return "занятий";
}

export function planProgressTotal(plan) {
  return plan.itemsCount || plan.lessonsCount || plan.items?.length || 0;
}

function parsePlanDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePlanDateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return parsePlanDateTime(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Тема пройдена по дате занятия; будущее не считаем, даже если статус completed. */
export function planItemIsPassed(item, now = new Date()) {
  if (item?.status === "skipped") return false;

  const eventAt = parsePlanDateTime(item?.scheduledEventStartsAt);
  if (eventAt) return eventAt.getTime() <= now.getTime();

  const scheduled = parsePlanDateOnly(item?.scheduledDate);
  if (scheduled) {
    const today = startOfLocalDay(now);
    const day = startOfLocalDay(scheduled);
    if (day < today) return true;
    if (day > today) return false;
    return item.status === "completed";
  }

  return item?.status === "completed";
}

export function planProgressCompleted(plan, now = new Date()) {
  const items = Array.isArray(plan.items) ? plan.items : [];
  if (items.length) {
    return items.filter((item) => planItemIsPassed(item, now)).length;
  }
  if (Number.isFinite(plan.completedCount)) return plan.completedCount;
  const total = planProgressTotal(plan);
  if (!total || !plan.progressPercent) return 0;
  return Math.round((total * plan.progressPercent) / 100);
}

export function planProgressLabel(plan, options = {}) {
  const total = planProgressTotal(plan);
  if (!total) return undefined;
  const isCatalog = options.isCatalog ?? Boolean(plan.isPublic);
  if (isCatalog) {
    return `${total} ${planLessonsWord(total)}`;
  }
  const done = planProgressCompleted(plan);
  return `${done} из ${total} занятий`;
}

const PLAN_COVER_VARIANT_POOLS = {
  oge: ["ocean", "sky", "indigo", "lavender"],
  ege: ["lavender", "indigo", "violet", "rose"],
  python: ["mint", "forest", "amber", "sky"],
  school: ["coral", "sunset", "rose", "amber"],
  other: ["ocean", "sunset", "forest", "lavender", "coral", "mint", "amber", "sky", "rose", "indigo"],
};

export function planCoverVariant(plan) {
  const pool = PLAN_COVER_VARIANT_POOLS[plan?.direction] || PLAN_COVER_VARIANT_POOLS.other;
  return pickCoverVariant(plan?.id ?? plan?.title, pool);
}

export function mapPlanToHomeworkCard(plan, options = {}) {
  const scope = options.scope || (plan.isPublic ? "catalog" : "mine");
  const isCatalog = scope === "catalog" || plan.isPublic;
  const statusLabel = isCatalog
    ? "Готовый шаблон"
    : (plan.statusLabel || PLAN_STATUS_LABELS[plan.status]);
  const statusTone = isCatalog ? "info" : (PLAN_STATUS_TONES[plan.status] || "default");

  return {
    id: plan.id,
    deadlineLabel: statusLabel,
    deadlineTone: statusTone,
    subject: planSubjectLine(plan),
    title: plan.title,
    description: planDescription(plan),
    progressLabel: planProgressLabel(plan, { isCatalog }),
    progressPercent: plan.progressPercent || 0,
    progressTone: plan.progressPercent >= 100 ? "completed" : "default",
    hideProgressBar: isCatalog,
    actionLabel: isCatalog ? "Использовать план" : "Редактировать",
    secondaryActionLabel: isCatalog ? "Открыть" : undefined,
    actionPrimary: true,
    coverVariant: planCoverVariant(plan),
    plan,
  };
}

export function planSubjectLabel(planOrDirection) {
  if (planOrDirection && typeof planOrDirection === "object") {
    return planOrDirection.subjectLabel
      || planSubjectLabelFromId(planOrDirection.subject)
      || "";
  }
  return planSubjectLabelFromId(planOrDirection);
}

export function planExamLabel(plan) {
  const examType = String(plan?.examType || plan?.exam_type || "").toLowerCase();
  const direction = String(plan?.direction || "").toLowerCase();
  if (examType === "oge" || direction === "oge") return "ОГЭ";
  if (examType === "ege" || direction === "ege") return "ЕГЭ";
  const label = PLAN_DIRECTION_LABELS[plan?.direction] || planLevelLabelFromId(direction);
  if (label && !["Другое", "Школьная база", "Python"].includes(label)) return label;
  return null;
}

export function itemStatusTone(status) {
  const map = {
    completed: "success",
    planned: "lav",
    not_started: "gray",
    skipped: "gray",
    repeat_needed: "warn",
  };
  return map[status] || "gray";
}

const INFORMATICS_KEYWORDS = /информат|логик|алгоритм|python|программ|булев|систем.*счисл|компьютер/i;
const MATH_KEYWORDS = /математ|алгебр|геометр|уравнен|функци|график|теорем|тригоном/i;
const PHYSICS_KEYWORDS = /физик|механик|электрич|оптик|кинемат/i;
const RUSSIAN_KEYWORDS = /русск(ий|ого)|орфограф|пунктуац|сочинен/i;

function planSubjectKind(plan) {
  const subjectId = canonicalPlanSubjectId(plan.subject);
  if (subjectId && subjectId !== "other") {
    if (subjectId === "inf") return "informatics";
    if (subjectId === "math") return "math";
    if (subjectId === "phys") return "physics";
    if (subjectId === "rus") return "russian";
    return subjectId;
  }
  const hay = `${plan.title || ""} ${plan.description || ""} ${plan.goal || ""}`;
  if (MATH_KEYWORDS.test(hay)) return "math";
  if (PHYSICS_KEYWORDS.test(hay)) return "physics";
  if (RUSSIAN_KEYWORDS.test(hay)) return "russian";
  if (INFORMATICS_KEYWORDS.test(hay)) return "informatics";
  return null;
}

export function filterPlans(plans, filterId) {
  const visible = plans.filter((p) => p.status !== "archived");
  if (filterId === "all") return visible;
  if (filterId === "draft") return visible.filter((p) => p.status === "draft");
  if (filterId === "published") return visible.filter((p) => p.status === "published");
  if (filterId === "math" || filterId === "informatics" || filterId === "physics" || filterId === "russian") {
    return visible.filter((p) => planSubjectKind(p) === filterId);
  }
  const dirMap = { oge: "oge", ege: "ege" };
  if (dirMap[filterId]) return visible.filter((p) => p.direction === dirMap[filterId]);
  return visible;
}

export function mapApiPlan(plan) {
  return {
    id: plan.id,
    title: plan.title,
    description: plan.description || "",
    goal: plan.goal || "",
    direction: plan.direction,
    directionLabel: plan.direction_label || planLevelLabelFromId(plan.direction) || plan.direction,
    subject: plan.subject || "",
    subjectLabel: plan.subject_label || planSubjectLabelFromId(plan.subject),
    examType: plan.exam_type,
    grade: plan.grade || "",
    lessonsCount: plan.lessons_count || 0,
    itemsCount: plan.items_count || 0,
    completedCount: typeof plan.completed_count === "number" ? plan.completed_count : undefined,
    status: plan.status,
    statusLabel: PLAN_STATUS_LABELS[plan.status] || plan.status,
    progressPercent: plan.progress_percent || 0,
    isPublic: plan.is_public || false,
    items: (plan.items || []).map(mapApiPlanItem),
    updatedAt: plan.updated_at,
    raw: plan,
  };
}

export function mapApiMaterial(material) {
  return {
    id: material.id,
    title: material.title,
    description: material.description || "",
    materialType: material.material_type || material.materialType,
    materialTypeLabel: material.material_type_label || material.materialTypeLabel || "",
    topic: material.topic || "",
    subtopic: material.subtopic || "",
    externalUrl: material.external_url || material.externalUrl || "",
    fileUrl: material.file_url || material.fileUrl || "",
    previewUrl: material.preview_url || material.previewUrl || "",
    cabinetFileId: material.cabinet_file_id || material.cabinetFileId || null,
    isOwn: material.is_own || material.isOwn || false,
    isPublic: material.is_public || material.isPublic || false,
  };
}

export function mapApiPlanItem(item) {
  return {
    id: item.id,
    order: item.order,
    title: item.title,
    topic: item.topic || "",
    subtopic: item.subtopic || "",
    taskNumber: item.task_number || "",
    goal: item.goal || "",
    plannedResults: item.planned_results || "",
    description: item.description || "",
    materialsNotes: item.lesson_materials_notes || "",
    homeworkDescription: item.homework_description || "",
    teacherComment: item.teacher_comment || "",
    linkedLessonId: item.linked_lesson || null,
    linkedLessonTitle: item.linked_lesson_title || "",
    materials: (item.materials || []).map(mapApiMaterial),
    attachedInteractives: (item.attached_interactives || []).map((interactive) => ({
      id: interactive.id,
      title: interactive.title,
      interactiveType: interactive.interactive_type || interactive.interactiveType,
      interactiveTypeLabel: interactive.interactive_type_label || interactive.interactiveTypeLabel,
      topic: interactive.topic || "",
      subtopic: interactive.subtopic || "",
    })),
    homeworkMaterials: (item.homework_materials || []).map(mapApiMaterial),
    homeworkInteractives: (item.homework_interactives || []).map((interactive) => ({
      id: interactive.id,
      title: interactive.title,
      interactiveType: interactive.interactive_type || interactive.interactiveType,
      interactiveTypeLabel: interactive.interactive_type_label || interactive.interactiveTypeLabel,
      topic: interactive.topic || "",
      subtopic: interactive.subtopic || "",
    })),
    scheduledEventId: item.scheduled_event || null,
    scheduledEventTitle: item.scheduled_event_title || "",
    scheduledEventStartsAt: item.scheduled_event_starts_at || null,
    status: item.status,
    statusLabel: ITEM_STATUS_LABELS[item.status] || item.status,
    scheduledDate: item.scheduled_date || null,
    completedAt: item.completed_at || null,
    createdAt: item.created_at || null,
    updatedAt: item.updated_at || null,
    raw: item,
  };
}

export function mapApiEnrollment(enrollment) {
  return {
    id: enrollment.id,
    planId: enrollment.plan,
    planTitle: enrollment.plan_title || "",
    studentId: enrollment.student != null ? String(enrollment.student) : null,
    studentSubjectId: enrollment.student_subject != null ? String(enrollment.student_subject) : null,
    studentSubjectLabel: enrollment.student_subject_label || "",
    groupId: enrollment.group != null ? String(enrollment.group) : null,
    status: enrollment.status,
    statusLabel: enrollment.status_label || enrollment.status,
    format: enrollment.format,
    startDate: enrollment.start_date || null,
    endDate: enrollment.end_date || null,
    frequency: enrollment.frequency || "",
    raw: enrollment,
  };
}

export function formatStudentPlansMeta(enrollments) {
  const list = Array.isArray(enrollments)
    ? enrollments
    : enrollments
      ? [enrollments]
      : [];
  const withPlan = list.filter((item) => item?.planTitle);
  if (!withPlan.length) return "План не назначен";
  if (withPlan.length === 1) {
    const item = withPlan[0];
    return item.studentSubjectLabel
      ? `${item.studentSubjectLabel}: ${item.planTitle}`
      : `План: ${item.planTitle}`;
  }
  return withPlan
    .map((item) => (
      item.studentSubjectLabel
        ? `${item.studentSubjectLabel}: ${item.planTitle}`
        : item.planTitle
    ))
    .join(" · ");
}

const TARGET_DIRECTION_MAP = {
  ОГЭ: "oge",
  ЕГЭ: "ege",
  Python: "python",
};

export function targetDirectionSlug(target) {
  if (target?.raw?.direction) return target.raw.direction;
  if (target?.direction && TARGET_DIRECTION_MAP[target.direction]) {
    return TARGET_DIRECTION_MAP[target.direction];
  }
  return null;
}
