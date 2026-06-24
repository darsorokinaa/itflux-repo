import { DEFAULT_APPEARANCE } from "./interactiveAppearance";

export const INTERACTIVE_COVER_THEMES = {
  oge: {
    id: "oge",
    gradient: "linear-gradient(135deg, #7B1226 0%, #C0284A 100%)",
  },
  ege: {
    id: "ege",
    gradient: "linear-gradient(135deg, #0B2F9F 0%, #1550D8 100%)",
  },
  school: {
    id: "school",
    gradient: "linear-gradient(135deg, #E05A00 0%, #FF8C38 100%)",
  },
};

const TYPE_COVER_THEME = {
  flashcards: "ege",
  matching: "oge",
  sequence: "school",
};

export function getInteractiveCoverTheme(interactive) {
  if (interactive?.exam === "ОГЭ") return "oge";
  if (interactive?.exam === "ЕГЭ") return "ege";
  return TYPE_COVER_THEME[interactive?.type] || "ege";
}

export const INTERACTIVE_TYPES = {
  flashcards: {
    id: "flashcards",
    label: "Карточки",
    shortLabel: "Карточки",
    description: "Термин → определение",
    longDescription: "Термин → определение",
    icon: "cards",
    accent: "ege",
    coverTheme: "ege",
    color: "#1550D8",
    createLabel: "Создать",
    examples: ["print() → вывод"],
  },
  matching: {
    id: "matching",
    label: "Сопоставление",
    shortLabel: "Сопоставление",
    description: "Понятие ↔ ответ",
    longDescription: "Понятие ↔ ответ",
    icon: "match",
    accent: "oge",
    coverTheme: "oge",
    color: "#C0284A",
    createLabel: "Создать",
    examples: ["AND ↔ лог. И"],
  },
  sequence: {
    id: "sequence",
    label: "Порядок",
    shortLabel: "Порядок",
    description: "Шаг 1 → Шаг 2 → Шаг 3",
    longDescription: "Шаг 1 → Шаг 2 → Шаг 3",
    icon: "order",
    accent: "school",
    coverTheme: "school",
    color: "#E05A00",
    createLabel: "Создать",
    examples: ["1 → 2 → 3"],
  },
};

export const INTERACTIVE_FILTERS = [
  { id: "all", label: "Все" },
  { id: "flashcards", label: "Карточки" },
  { id: "matching", label: "Сопоставление" },
  { id: "sequence", label: "Порядок" },
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
  { id: "python", label: "Python" },
  { id: "draft", label: "Черновики" },
  { id: "assigned", label: "Выданы" },
];

export const INTERACTIVE_STATUS = {
  draft: { label: "Черновик", tone: "gray", dot: "#64748B" },
  published: { label: "Опубликован", tone: "success", dot: "#10B981" },
  assigned: { label: "Выдан", tone: "info", dot: "#2563EB" },
  review: { label: "Требует проверки", tone: "warn", dot: "#F59E0B" },
};

export const EXAM_OPTIONS = ["ОГЭ", "ЕГЭ", "без экзамена"];
export const DIFFICULTY_OPTIONS = ["базовый", "средний", "продвинутый"];
export const ACCESS_OPTIONS = [
  { id: "private", label: "Только мне" },
  { id: "assignable", label: "Можно выдать ученикам" },
];

export const DEFAULT_PARAMS = {
  timerMode: "none",
  timerMinutes: 0,
  timerSeconds: 0,
  maxAttempts: 0,
  shuffleQuestions: true,
  showAnswersAtEnd: true,
  showExplanationAfterAnswer: true,
  allowRetry: true,
  recordInReport: true,
};

export const VISUAL_THEMES = [
  { id: "digital-flow", label: "Цифровой поток", backgroundSlug: "grid-blue", cardStyleSlug: "classic", preview: "linear-gradient(135deg, #2563EB, #4F46E5)" },
  { id: "sky", label: "Небо", backgroundSlug: "soft-blue", cardStyleSlug: "rounded", preview: "linear-gradient(135deg, #DBEAFE, #E0E7FF)" },
  { id: "space", label: "Космос", backgroundSlug: "navy-dark", cardStyleSlug: "glass", preview: "linear-gradient(135deg, #0F172A, #1E293B)" },
  { id: "classic", label: "Классика", backgroundSlug: "light-gray", cardStyleSlug: "classic", preview: "linear-gradient(135deg, #F8FAFC, #E2E8F0)" },
  { id: "pixel", label: "Пиксель", backgroundSlug: "grid-blue", cardStyleSlug: "bold", preview: "linear-gradient(135deg, #7C3AED, #2563EB)" },
  { id: "minimal", label: "Минимализм", backgroundSlug: "light-gray", cardStyleSlug: "flat", preview: "linear-gradient(135deg, #FFFFFF, #F1F5F9)" },
  { id: "summer", label: "Летний клуб", backgroundSlug: "warm-sand", cardStyleSlug: "rounded", preview: "linear-gradient(135deg, #FEF3C7, #FFEDD5)" },
];

export const TEMPLATE_SWITCHER = [
  { id: "flashcards", label: "Карточки", type: "flashcards", available: true },
  { id: "quiz", label: "Викторина", type: null, available: false },
  { id: "open-field", label: "Открой поле", type: null, available: false },
  { id: "wheel", label: "Случайное колесо", type: null, available: false },
  { id: "matching", label: "Найди пару", type: "matching", available: true },
  { id: "sequence", label: "Собери порядок", type: "sequence", available: true },
];

export const SORT_OPTIONS = [
  { id: "updated", label: "По дате изменения" },
  { id: "title", label: "По названию" },
  { id: "type", label: "По типу" },
  { id: "status", label: "По статусу" },
];

const STORAGE_KEY = "cabinet-interactives-v2";
const LEGACY_STORAGE_KEY = "cabinet-interactives-v1";
const LEGACY_SEED_IDS = new Set(["i1", "i2", "i3"]);

function readStorage() {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed)) {
          const withoutSeed = parsed.filter((item) => !LEGACY_SEED_IDS.has(item.id));
          localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutSeed));
          raw = localStorage.getItem(STORAGE_KEY);
        }
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStorage(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* ignore quota errors in mock mode */
  }
}

export function loadInteractives() {
  const stored = readStorage();
  const items = stored ?? [];
  const normalized = items.map((item) => ({
    ...DEFAULT_APPEARANCE,
    params: { ...DEFAULT_PARAMS, ...item.params },
    visualThemeId: item.visualThemeId || getVisualThemeId({ ...DEFAULT_APPEARANCE, ...item }),
    backgroundImage: item.backgroundImage || null,
    backgroundImageTone: item.backgroundImageTone || "light",
    ...item,
  }));
  if (stored === null) writeStorage(normalized);
  return normalized;
}

export function saveInteractives(items) {
  writeStorage(items);
  return items;
}

export function getInteractiveById(id) {
  return loadInteractives().find((item) => item.id === id) || null;
}

export function upsertInteractive(interactive) {
  const items = loadInteractives();
  const idx = items.findIndex((item) => item.id === interactive.id);
  const next = [...items];
  if (idx >= 0) next[idx] = interactive;
  else next.unshift(interactive);
  saveInteractives(next);
  return interactive;
}

export function deleteInteractive(id) {
  const items = loadInteractives().filter((item) => item.id !== id);
  saveInteractives(items);
  return items;
}

export function duplicateInteractive(id) {
  const source = getInteractiveById(id);
  if (!source) return null;
  const copy = {
    ...source,
    id: `i${Date.now()}`,
    title: source.title ? `${source.title} (копия)` : "Копия",
    status: "draft",
    usedIn: [],
    results: [],
    updatedAt: new Date().toISOString(),
  };
  upsertInteractive(copy);
  return copy;
}

export function sortInteractives(items, sortId) {
  const list = [...items];
  if (sortId === "title") {
    return list.sort((a, b) => (a.title || "").localeCompare(b.title || "", "ru"));
  }
  if (sortId === "type") {
    return list.sort((a, b) => a.type.localeCompare(b.type));
  }
  if (sortId === "status") {
    const order = { draft: 0, published: 1, assigned: 2, review: 3 };
    return list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }
  return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function applyVisualTheme(interactive, themeId) {
  const theme = VISUAL_THEMES.find((t) => t.id === themeId);
  if (!theme) return interactive;
  return {
    ...interactive,
    visualThemeId: themeId,
    backgroundSlug: theme.backgroundSlug,
    cardStyleSlug: theme.cardStyleSlug,
    backgroundImage: null,
  };
}

export function getVisualThemeId(interactive) {
  if (interactive.backgroundImage) return "custom";
  if (interactive.visualThemeId && interactive.visualThemeId !== "custom") {
    return interactive.visualThemeId;
  }
  const found = VISUAL_THEMES.find(
    (t) => t.backgroundSlug === interactive.backgroundSlug && t.cardStyleSlug === interactive.cardStyleSlug,
  );
  return found?.id || "digital-flow";
}

export function createEmptyInteractive(type) {
  const base = {
    id: `i${Date.now()}`,
    type,
    title: "",
    subject: "Информатика",
    exam: "без экзамена",
    topic: "",
    subtopic: "",
    taskNumber: "",
    difficulty: "средний",
    instruction: "",
    status: "draft",
    access: "assignable",
    updatedAt: new Date().toISOString(),
    usedIn: [],
    results: [],
    params: { ...DEFAULT_PARAMS },
    visualThemeId: "digital-flow",
    ...DEFAULT_APPEARANCE,
  };

  if (type === "flashcards") {
    return {
      ...base,
      cards: [{ front: "", back: "", hint: "", explanation: "" }],
    };
  }
  if (type === "matching") {
    return {
      ...base,
      shufflePairs: true,
      showResultImmediately: false,
      pairs: [{ left: "", right: "", explanation: "" }],
    };
  }
  return {
    ...base,
    allowMultipleAttempts: true,
    showAnswerOnError: true,
    steps: [{ text: "", explanation: "", position: 1 }],
  };
}

export function getItemCount(interactive) {
  if (interactive.type === "flashcards") return interactive.cards?.length || 0;
  if (interactive.type === "matching") return interactive.pairs?.length || 0;
  return interactive.steps?.length || 0;
}

export function getInteractiveFirstSlide(interactive) {
  if (!interactive) return null;

  if (interactive.type === "flashcards") {
    const card = (interactive.cards || []).find((c) => c.front || c.back);
    if (!card) return null;
    return { type: "flashcards", front: card.front, back: card.back, hint: card.hint };
  }

  if (interactive.type === "matching") {
    const pair = (interactive.pairs || []).find((p) => p.left || p.right);
    if (!pair) return null;
    return { type: "matching", left: pair.left, right: pair.right };
  }

  const step = (interactive.steps || []).find((s) => s.text) || interactive.steps?.[0];
  if (!step?.text) return null;
  return {
    type: "sequence",
    text: step.text,
    position: step.position ?? 1,
  };
}

export function formatUpdatedAt(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function filterInteractives(items, filterId) {
  if (filterId === "all") return items;
  if (filterId === "flashcards" || filterId === "matching" || filterId === "sequence") {
    return items.filter((item) => item.type === filterId);
  }
  if (filterId === "oge") return items.filter((item) => item.exam === "ОГЭ");
  if (filterId === "ege") return items.filter((item) => item.exam === "ЕГЭ");
  if (filterId === "python") {
    return items.filter((item) =>
      item.exam === "Python" || `${item.topic} ${item.subject}`.toLowerCase().includes("python"),
    );
  }
  if (filterId === "draft") return items.filter((item) => item.status === "draft");
  if (filterId === "assigned") return items.filter((item) => item.status === "assigned");
  if (filterId === "published") {
    return items.filter((item) => item.status === "published");
  }
  return items;
}

export function getTypeMeta(type) {
  return INTERACTIVE_TYPES[type] || INTERACTIVE_TYPES.flashcards;
}

export function getStatusMeta(status) {
  return INTERACTIVE_STATUS[status] || INTERACTIVE_STATUS.draft;
}

export function canShareInteractive(interactive) {
  const status = interactive?.status;
  return status === "published" || status === "assigned";
}

export function canAssignInteractive(interactive) {
  return canShareInteractive(interactive);
}

const INTERACTIVE_COVER_TYPE = {
  flashcards: "general",
  matching: "logic",
  sequence: "python",
};

const INTERACTIVE_COVER_COLOR = {
  oge: "#C0284A",
  ege: "#1550D8",
  school: "#E05A00",
};

const INTERACTIVE_STATUS_TONE = {
  draft: "draft",
  published: "completed",
  assigned: "review",
  review: "review",
};

export function mapInteractiveToHomeworkCard(interactive) {
  const typeMeta = getTypeMeta(interactive.type);
  const statusMeta = getStatusMeta(interactive.status);
  const count = getItemCount(interactive);
  const itemLabel = interactive.type === "flashcards"
    ? "карточек"
    : interactive.type === "matching"
      ? "пар"
      : "элементов";

  const examLabel = interactive.exam && interactive.exam !== "без экзамена"
    ? interactive.exam
    : typeMeta.shortLabel;

  let coverType = INTERACTIVE_COVER_TYPE[interactive.type] || "general";
  const coverTheme = getInteractiveCoverTheme(interactive);
  if (interactive.exam === "ОГЭ") coverType = "exam";
  if (interactive.exam === "ЕГЭ") coverType = "exam";
  if (interactive.exam === "Python") coverType = "python";

  const usedCount = interactive.usedIn?.length || 0;

  return {
    id: interactive.id,
    coverType,
    coverBgColor: INTERACTIVE_COVER_COLOR[coverTheme] || INTERACTIVE_COVER_COLOR.ege,
    deadlineLabel: statusMeta.label,
    deadlineTone: INTERACTIVE_STATUS_TONE[interactive.status] || "default",
    subject: `${examLabel} · ${typeMeta.shortLabel}`,
    title: interactive.title || "Без названия",
    description: [
      `${count} ${itemLabel}`,
      interactive.topic || null,
      usedCount > 0 ? `Выдано: ${usedCount}` : "Пока не выдан",
    ].filter(Boolean).join(" · "),
    progressLabel: `Изменён ${formatUpdatedAt(interactive.updatedAt)}`,
    hideProgressBar: true,
    actionLabel: "Просмотр",
    actionPrimary: true,
    secondaryActionLabel: "Редактировать",
    interactive,
  };
}
