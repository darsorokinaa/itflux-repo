/** Единое оформление типов материалов во всех кабинетах. Цвет = тип, не предмет. */

export const MATERIAL_TYPE_FALLBACK = {
  label: "Материал",
  icon: "note",
  color: "#667085",
  background: "#F3F4F6",
  cssColor: "gray",
};

export const MATERIAL_TYPE_CONFIG = {
  lesson: {
    label: "Урок",
    icon: "lessons",
    color: "#2F5EF5",
    background: "#EEF2FF",
    cssColor: "blue",
  },
  task_set: {
    label: "Вариант",
    icon: "tasks",
    color: "#C2410C",
    background: "#FFEDD5",
    cssColor: "orange",
  },
  worksheet: {
    label: "Рабочий лист",
    icon: "note",
    color: "#7C3AED",
    background: "#EDE9FE",
    cssColor: "purple",
  },
  presentation: {
    label: "Презентация",
    icon: "plan",
    color: "#D97706",
    background: "#FEF3C7",
    cssColor: "yellow",
  },
  methodic: {
    label: "Методичка",
    icon: "book",
    color: "#059669",
    background: "#D1FAE5",
    cssColor: "green",
  },
  link: {
    label: "Ссылка",
    icon: "arrow",
    color: "#2563EB",
    background: "#DBEAFE",
    cssColor: "blue",
  },
  file: {
    label: "Файл",
    icon: "folder",
    color: "#4B5563",
    background: "#F3F4F6",
    cssColor: "gray",
  },
  board: {
    label: "Доска",
    icon: "board",
    color: "#0D9488",
    background: "#CCFBF1",
    cssColor: "teal",
  },
  interactive: {
    label: "Интерактив",
    icon: "interactives",
    color: "#6D28D9",
    background: "#EDE9FE",
    cssColor: "purple",
  },
};

export function getMaterialTypeConfig(type) {
  if (!type) return MATERIAL_TYPE_FALLBACK;
  return MATERIAL_TYPE_CONFIG[type] || MATERIAL_TYPE_FALLBACK;
}

/** Человеческая подпись типа: не показываем английские slug вроде file/board. */
export function materialTypeLabel(type, typeLabel) {
  const raw = String(typeLabel || "").trim();
  if (raw && !/^[a-z][a-z0-9_]*$/i.test(raw)) return raw;
  const key = String(type || raw || "").toLowerCase();
  return getMaterialTypeConfig(key).label;
}

export const STUDENT_MATERIAL_TYPE_FILTERS = [
  { id: "all", label: "Все типы" },
  { id: "lesson", label: "Уроки" },
  { id: "presentation", label: "Презентации" },
  { id: "methodic", label: "Методички" },
  { id: "file", label: "Файлы" },
  { id: "link", label: "Ссылки" },
  { id: "task_set", label: "Варианты" },
  { id: "interactive", label: "Интерактивы" },
  { id: "board", label: "Доски" },
  { id: "worksheet", label: "Рабочие листы" },
];
