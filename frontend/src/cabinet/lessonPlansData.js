import { pickCoverVariant } from "./CabinetHomeworkCard";

export const PLAN_FILTERS = [
  { id: "all", label: "Все" },
  { id: "math", label: "Математика" },
  { id: "informatics", label: "Информатика" },
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
  { id: "draft", label: "Черновики" },
  { id: "published", label: "Опубликованные" },
];

export const PLAN_SCOPE_FILTERS = [
  { id: "mine", label: "Мои планы" },
  { id: "catalog", label: "Готовые" },
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
  { id: "prog", label: "Программирование" },
  { id: "rus", label: "Русский язык" },
  { id: "other", label: "Другое" },
];

const PLAN_SUBJECT_LABELS = {
  inf: "Информатика",
  informatics: "Информатика",
  math: "Математика",
  math_base: "Математика базовая",
  prog: "Программирование",
  rus: "Русский язык",
  other: "Другое",
};

export function planSubjectLabelFromId(subjectId) {
  return PLAN_SUBJECT_LABELS[subjectId] || "";
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

export function planProgressLabel(plan) {
  const total = plan.lessonsCount || plan.itemsCount || 0;
  if (!total) return undefined;
  if (plan.progressPercent > 0) {
    const done = Math.round((total * plan.progressPercent) / 100);
    return `${done} из ${total} занятий`;
  }
  return `${total} ${total === 1 ? "занятие" : total >= 2 && total <= 4 ? "занятия" : "занятий"}`;
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
    progressLabel: planProgressLabel(plan),
    progressPercent: plan.progressPercent || 0,
    progressTone: plan.progressPercent >= 100 ? "completed" : "default",
    hideProgressBar: isCatalog || !plan.progressPercent,
    actionLabel: isCatalog ? "Открыть" : "Редактировать",
    secondaryActionLabel: isCatalog ? "Сохранить себе" : undefined,
    actionPrimary: true,
    coverVariant: planCoverVariant(plan),
    plan,
  };
}

export function planSubjectLabel(planOrDirection) {
  if (planOrDirection && typeof planOrDirection === "object") {
    const explicit = planOrDirection.subjectLabel
      || planSubjectLabelFromId(planOrDirection.subject);
    if (explicit) return explicit;
    return planSubjectLabel(planOrDirection.direction);
  }
  if (planOrDirection === "school") return "Математика";
  return "Информатика";
}

export function planExamLabel(plan) {
  const examType = plan?.examType || plan?.exam_type;
  if (examType === "oge" || plan?.direction === "oge") return "ОГЭ";
  if (examType === "ege" || plan?.direction === "ege") return "ЕГЭ";
  const label = PLAN_DIRECTION_LABELS[plan?.direction];
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

const INFORMATICS_DIRECTIONS = new Set(["oge", "ege", "python", "school"]);
const MATH_DIRECTIONS = new Set(["vpr"]);

const INFORMATICS_KEYWORDS = /информат|логик|алгоритм|python|программ|булев|систем.*счисл|компьютер/i;
const MATH_KEYWORDS = /математ|алгебр|геометр|уравнен|функци|график|теорем|тригоном/i;

function planSubjectKind(plan) {
  if (plan.subject && plan.subject !== "other") {
    const subjectId = String(plan.subject).toLowerCase();
    if (subjectId === "inf" || subjectId === "informatics") return "informatics";
    if (subjectId === "math" || subjectId === "math_base") return "math";
    return subjectId;
  }
  const hay = `${plan.title || ""} ${plan.description || ""} ${plan.goal || ""}`;

  if (MATH_DIRECTIONS.has(plan.direction) || MATH_KEYWORDS.test(hay)) {
    return "math";
  }
  if (INFORMATICS_DIRECTIONS.has(plan.direction) || INFORMATICS_KEYWORDS.test(hay)) {
    return "informatics";
  }
  return null;
}

export function filterPlans(plans, filterId) {
  if (filterId === "all") return plans;
  if (filterId === "draft") return plans.filter((p) => p.status === "draft");
  if (filterId === "published") return plans.filter((p) => p.status === "published");
  if (filterId === "math" || filterId === "informatics") {
    return plans.filter((p) => planSubjectKind(p) === filterId);
  }
  const dirMap = { oge: "oge", ege: "ege" };
  if (dirMap[filterId]) return plans.filter((p) => p.direction === dirMap[filterId]);
  return plans;
}

export function mapApiPlan(plan) {
  return {
    id: plan.id,
    title: plan.title,
    description: plan.description || "",
    goal: plan.goal || "",
    direction: plan.direction,
    directionLabel: plan.direction_label || plan.direction,
    subject: plan.subject || defaultSubjectForDirection(plan.direction),
    subjectLabel: plan.subject_label || planSubjectLabelFromId(plan.subject),
    examType: plan.exam_type,
    grade: plan.grade || "",
    lessonsCount: plan.lessons_count || 0,
    itemsCount: plan.items_count || 0,
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
    materialTypeLabel: material.material_type_label || material.materialTypeLabel || material.material_type || material.materialType,
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
