/** Demo data when API has no linked roster student yet. */

export const STUDENT_SEED = {
  dashboard: {
    greeting_name: "Ученик",
    summary: { lessons_today: 1, assignments_due: 2, interactives_new: 1 },
    metrics: { progress_percent: 64, assignments_left: 2, lessons_completed: 8, streak_days: 5 },
    next_lesson: {
      id: 1,
      title: "Алгебра логики + IF",
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      teacher_name: "Дарья Сорокина",
      format: "онлайн",
      meeting_url: "",
      lesson_id: 1,
    },
    todo: [
      { kind: "assignment", id: 1, title: "Логические выражения", type: "homework", status: "new", status_label: "Новый", due_at: null, cover_theme: "oge" },
      { kind: "assignment", id: 2, title: "Таблица истинности", type: "homework", status: "in_progress", status_label: "В работе", due_at: null, cover_theme: "ege" },
    ],
    recent_results: [
      { title: "Python: циклы", score_percent: 82, completed_at: new Date().toISOString() },
    ],
    today_schedule: [
      {
        id: 1,
        title: "Алгебра логики",
        starts_at: new Date(Date.now() + 3600000).toISOString(),
        teacher_name: "Дарья Сорокина",
        format: "онлайн",
        meeting_url: "",
      },
    ],
  },
  lessons: {
    items: [
      {
        id: 1, lesson_id: 1,
        title: "Алгебра логики + IF",
        topic: "Логика", direction: "ОГЭ",
        status: "in_progress", status_label: "В процессе",
        progress_percent: 45, cover_theme: "oge",
        scheduled_at: new Date(Date.now() + 3600000).toISOString(),
        materials_count: 2,
      },
      {
        id: 2, lesson_id: 2,
        title: "Системы счисления",
        topic: "Числа", direction: "ОГЭ",
        status: "new", status_label: "Новый",
        progress_percent: 0, cover_theme: "oge",
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        materials_count: 0,
      },
      {
        id: 3, lesson_id: 3,
        title: "Списки в Python",
        topic: "Python", direction: "Python",
        status: "completed", status_label: "Пройден",
        progress_percent: 100, cover_theme: "python",
        scheduled_at: new Date(Date.now() - 86400000).toISOString(),
        materials_count: 1,
      },
    ],
  },
  assignments: {
    items: [],
  },
  interactives: {
    items: [],
  },
  schedule: {
    items: [
      {
        id: 1, lesson_id: 1,
        title: "Алгебра логики",
        starts_at: new Date(Date.now() + 3600000).toISOString(),
        teacher_name: "Дарья Сорокина",
        format: "онлайн",
        meeting_url: "",
      },
      {
        id: 2, lesson_id: 2,
        title: "Python: списки",
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        teacher_name: "Дарья Сорокина",
        format: "онлайн",
        meeting_url: "",
      },
    ],
  },
  progress: {
    overall_percent: 64,
    lessons_completed: 8,
    assignments_done: 18,
    average_score: 76,
    weak_topics: [
      { title: "Логика", percent: 58, status: "repeat" },
      { title: "Системы счисления", percent: 62, status: "repeat" },
    ],
    weekly: [40, 52, 48, 60, 64, 70, 76],
  },
  materials: {
    items: [
      { id: 1, title: "Тетрадь: логика", type: "notebook", type_label: "Тетрадь", topic: "ОГЭ", lesson_topic: "Логика и таблицы", cover_theme: "material" },
      { id: 2, title: "Презентация IF", type: "presentation", type_label: "Презентация", topic: "Python", lesson_topic: "Условный оператор", cover_theme: "ege" },
      { id: 3, title: "Разбор задания 13", type: "file", type_label: "Файл", topic: "ОГЭ", lesson_topic: "Системы счисления", cover_theme: "material" },
      { id: 4, title: "Шпаргалка по Python", type: "file", type_label: "Файл", topic: "Python", lesson_topic: "Циклы", cover_theme: "material" },
      { id: 5, title: "Демо-вариант", type: "notebook", type_label: "Тетрадь", topic: "ОГЭ", lesson_topic: "Практикум", cover_theme: "material" },
    ],
  },
  profile: {
    name: "Иван",
    surname: "Петров",
    display_name: "Иван Петров",
    email: "",
    direction: "ОГЭ",
    grade: 9,
    groups: ["ОГЭ · Информатика"],
    teacher_name: "Дарья Сорокина",
    teacher_email: "",
    notifications_enabled: true,
  },
};

export async function loadStudentData(fetcher, seedKey, mergeSeed = true) {
  try {
    const data = await fetcher();
    const seed = STUDENT_SEED[seedKey];
    if (!seed) return data;
    if (mergeSeed && isEmptyPayload(data, seedKey)) {
      return seed;
    }
    return data;
  } catch {
    return STUDENT_SEED[seedKey] || null;
  }
}

function isEmptyPayload(data, seedKey) {
  if (!data) return true;
  if (seedKey === "dashboard") return !data.next_lesson && !(data.todo?.length);
  if (data.items) return data.items.length === 0;
  return false;
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
