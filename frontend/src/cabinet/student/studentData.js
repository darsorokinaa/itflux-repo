const STUDENT_EMPTY = {
  dashboard: {
    greeting_name: "",
    summary: { lessons_today: 0, assignments_due: 0, interactives_new: 0 },
    metrics: {
      progress_percent: 0,
      assignments_left: 0,
      lessons_completed: 0,
      streak_days: 0,
      assignments_done: 0,
    },
    next_lesson: null,
    todo: [],
    recent_results: [],
    today_schedule: [],
    recent_materials: [],
    recent_lessons: [],
  },
  lessons: { items: [] },
  assignments: { items: [] },
  interactives: { items: [] },
  schedule: { items: [] },
  progress: {
    overall_percent: 0,
    lessons_completed: 0,
    assignments_done: 0,
    average_score: 0,
    weak_topics: [],
    weekly: [],
  },
  materials: { items: [] },
  profile: {
    name: "",
    surname: "",
    display_name: "",
    email: "",
    direction: "",
    grade: null,
    groups: [],
    teacher_name: "",
    teacher_email: "",
    notifications_enabled: true,
  },
};

export async function loadStudentData(fetcher, key) {
  try {
    const data = await fetcher();
    if (data == null) return STUDENT_EMPTY[key] ?? null;
    return data;
  } catch {
    return STUDENT_EMPTY[key] ?? null;
  }
}

export const LESSON_FILTERS = [
  { id: "all", label: "Все" },
  { id: "new", label: "Новые" },
  { id: "in_progress", label: "В процессе" },
  { id: "completed", label: "Пройденные" },
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
  { id: "python", label: "Python" },
];

export const ASSIGNMENT_FILTERS = [
  { id: "all", label: "Все" },
  { id: "new", label: "Новые" },
  { id: "in_progress", label: "В работе" },
  { id: "submitted", label: "Сданы" },
  { id: "checked", label: "Проверены" },
  { id: "overdue", label: "Просрочены" },
];

export const INTERACTIVE_FILTERS = [
  { id: "all", label: "Все" },
  { id: "flashcards", label: "Карточки" },
  { id: "matching", label: "Сопоставление" },
  { id: "sequence", label: "Порядок" },
  { id: "new", label: "Новые" },
  { id: "completed", label: "Пройденные" },
];

export const MATERIAL_FILTERS = [
  { id: "all", label: "Все" },
  { id: "theory", label: "Теория" },
  { id: "notebook", label: "Тетради" },
  { id: "presentation", label: "Презентации" },
  { id: "file", label: "Файлы" },
  { id: "link", label: "Ссылки" },
];

export function filterLessons(items, filterId) {
  if (filterId === "all") return items;
  if (["new", "in_progress", "completed", "repeat"].includes(filterId)) {
    return items.filter((i) => i.status === filterId);
  }
  if (filterId === "oge") return items.filter((i) => (i.direction || "").includes("ОГЭ"));
  if (filterId === "ege") return items.filter((i) => (i.direction || "").includes("ЕГЭ"));
  if (filterId === "python") return items.filter((i) => /python/i.test(`${i.direction} ${i.topic}`));
  return items;
}

export function filterAssignments(items, filterId) {
  if (filterId === "all") return items;
  return items.filter((i) => i.status === filterId);
}

export function filterInteractives(items, filterId) {
  if (filterId === "all") return items;
  if (filterId === "new" || filterId === "completed") {
    return items.filter((i) => i.status === filterId);
  }
  return items.filter((i) => i.type === filterId);
}

export function filterMaterials(items, filterId) {
  if (filterId === "all") return items;
  const map = { theory: "theory", notebook: "notebook", presentation: "presentation", file: "file", link: "link" };
  return items.filter((i) => i.type === map[filterId] || i.type === filterId);
}
