import { DEFAULT_APPEARANCE } from "./interactiveAppearance";
import { cloneQuestion, createEmptyQuestion } from "./quizUtils";
import { DEFAULT_WHEEL_SETTINGS, createEmptySegment } from "./wheelUtils";

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
  quiz: {
    id: "quiz",
    gradient: "linear-gradient(135deg, #059669 0%, #10B981 100%)",
  },
  wheel: {
    id: "wheel",
    gradient: "linear-gradient(135deg, #5B21B6 0%, #7C3AED 100%)",
  },
};

const TYPE_COVER_THEME = {
  flashcards: "ege",
  matching: "oge",
  sequence: "school",
  quiz: "quiz",
  wheel: "wheel",
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
    description: "Термин и определение",
    longDescription: "Термин и определение",
    useCase: "Подойдут для повторения понятий и формул.",
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
    description: "Соединение понятий и ответов",
    longDescription: "Соединение понятий и ответов",
    useCase: "Для закрепления связей между терминами.",
    icon: "match",
    accent: "oge",
    coverTheme: "oge",
    color: "#C0284A",
    createLabel: "Создать",
    examples: ["AND ↔ лог. И"],
    available: false,
  },
  sequence: {
    id: "sequence",
    label: "Порядок",
    shortLabel: "Порядок",
    description: "Шаги в правильной последовательности",
    longDescription: "Шаги в правильной последовательности",
    useCase: "Удобно для алгоритмов и разборов задач.",
    icon: "order",
    accent: "school",
    coverTheme: "school",
    color: "#E05A00",
    createLabel: "Создать",
    examples: ["1 → 2 → 3"],
  },
  quiz: {
    id: "quiz",
    label: "Викторина",
    shortLabel: "Викторина",
    description: "Один или несколько правильных ответов",
    longDescription: "Вопросы с вариантами ответов",
    useCase: "Проверка понимания темы на уроке.",
    icon: "quiz",
    accent: "quiz",
    coverTheme: "quiz",
    color: "#10B981",
    createLabel: "Создать",
    examples: ["Выберите правильный ответ"],
  },
  wheel: {
    id: "wheel",
    label: "Колесо фортуны",
    shortLabel: "Колесо",
    description: "Случайный выбор вопроса, ученика или темы",
    longDescription: "Случайный выбор вопроса, ученика или темы",
    useCase: "Оживит опрос и разминку на уроке.",
    icon: "wheel",
    accent: "wheel",
    coverTheme: "wheel",
    color: "#7C3AED",
    createLabel: "Создать",
    examples: [],
  },
};

export const INTERACTIVE_TYPE_LIST = ["flashcards", "matching", "sequence", "quiz", "wheel"];

export const INTERACTIVE_FILTERS = [
  { id: "all", label: "Все" },
  { id: "flashcards", label: "Карточки" },
  { id: "matching", label: "Сопоставление" },
  { id: "sequence", label: "Порядок" },
  { id: "quiz", label: "Викторина" },
  { id: "wheel", label: "Колесо" },
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
  shuffleOptions: true,
  showAnswersAtEnd: true,
  showCorrectImmediately: false,
  showExplanationAfterAnswer: true,
  allowRetry: true,
  recordInReport: true,
};

export function applyBackgroundSlug(interactive, backgroundSlug) {
  if (!backgroundSlug || backgroundSlug === "custom") return interactive;
  return {
    ...interactive,
    backgroundSlug,
    backgroundImage: null,
  };
}

export function getActiveBackgroundSlug(interactive) {
  if (interactive?.backgroundImage) return "custom";
  return interactive?.backgroundSlug || "";
}

/** @deprecated используйте applyBackgroundSlug */
export function applyVisualTheme(interactive, backgroundSlug) {
  return applyBackgroundSlug(interactive, backgroundSlug);
}

/** @deprecated используйте getActiveBackgroundSlug */
export function getVisualThemeId(interactive) {
  return getActiveBackgroundSlug(interactive);
}

export const TEMPLATE_SWITCHER = [
  { id: "flashcards", label: "Карточки", type: "flashcards", available: true },
  { id: "quiz", label: "Викторина", type: "quiz", available: true },
  { id: "open-field", label: "Открой поле", type: null, available: false },
  { id: "wheel", label: "Случайное колесо", type: "wheel", available: true },
  { id: "matching", label: "Найди пару", type: "matching", available: false },
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
    visualThemeId: item.visualThemeId,
    backgroundSlug: item.backgroundSlug || DEFAULT_APPEARANCE.backgroundSlug,
    backgroundImage: item.backgroundImage || null,
    backgroundImageTone: item.backgroundImageTone || "light",
    customSounds: item.customSounds || {},
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
  if (source.type === "quiz" && source.questions) {
    copy.questions = source.questions.map((q) => cloneQuestion(q));
  }
  if (source.type === "wheel" && source.segments) {
    copy.segments = source.segments.map((segment) => ({
      ...segment,
      id: createEmptySegment().id,
    }));
    copy.wheelSettings = { ...(source.wheelSettings || DEFAULT_WHEEL_SETTINGS) };
  }
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
    ...DEFAULT_APPEARANCE,
  };

  if (type === "flashcards") {
    return {
      ...base,
      cards: [{
        front: "",
        back: "",
        front_image_url: "",
        back_image_url: "",
        hint: "",
        explanation: "",
      }],
    };
  }
  if (type === "matching") {
    return {
      ...base,
      shufflePairs: true,
      showResultImmediately: false,
      pairs: [{
        left: "",
        right: "",
        left_image_url: "",
        right_image_url: "",
        explanation: "",
      }],
    };
  }
  if (type === "quiz") {
    return {
      ...base,
      instruction: "Выберите правильный ответ",
      questions: [createEmptyQuestion()],
    };
  }
  if (type === "wheel") {
    return {
      ...base,
      segments: [],
      wheelSettings: { ...DEFAULT_WHEEL_SETTINGS },
    };
  }
  return {
    ...base,
    allowMultipleAttempts: true,
    showAnswerOnError: true,
    steps: [{ text: "", image_url: "", explanation: "", position: 1 }],
  };
}

export function getItemCount(interactive) {
  if (typeof interactive?.itemsCount === "number" && interactive.itemsCount > 0) {
    return interactive.itemsCount;
  }
  if (interactive.type === "flashcards") return interactive.cards?.length || 0;
  if (interactive.type === "matching") return interactive.pairs?.length || 0;
  if (interactive.type === "quiz") return interactive.questions?.length || 0;
  if (interactive.type === "wheel") return interactive.segments?.length || 0;
  return interactive.steps?.length || interactive.itemsCount || 0;
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

  if (interactive.type === "quiz") {
    const question = (interactive.questions || []).find((q) => q.text);
    if (!question) return null;
    return {
      type: "quiz",
      text: question.text,
      answers: (question.answers || []).slice(0, 3).map((a) => a.text).filter(Boolean),
    };
  }

  if (interactive.type === "wheel") {
    const segment = (interactive.segments || []).find((s) => s.title?.trim());
    if (!segment) return null;
    return { type: "wheel", title: segment.title, color: segment.color };
  }

  const step = (interactive.steps || []).find((s) => s.text) || interactive.steps?.[0];
  if (!step?.text) return null;
  return {
    type: "sequence",
    text: step.text,
    position: step.position ?? 1,
  };
}

function normalizeInteractiveTitleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function getInteractiveTaskTitle(interactive) {
  if (!interactive) return "";

  const slide = getInteractiveFirstSlide(interactive);
  if (slide) {
    if (slide.type === "flashcards") {
      return normalizeInteractiveTitleText(slide.front) || normalizeInteractiveTitleText(slide.back);
    }
    if (slide.type === "matching") {
      return normalizeInteractiveTitleText(slide.left) || normalizeInteractiveTitleText(slide.right);
    }
    if (slide.type === "quiz" || slide.type === "sequence") {
      return normalizeInteractiveTitleText(slide.text);
    }
    if (slide.type === "wheel") {
      return normalizeInteractiveTitleText(slide.title);
    }
  }

  if (interactive.type === "flashcards") {
    const card = interactive.cards?.[0];
    return normalizeInteractiveTitleText(card?.front) || normalizeInteractiveTitleText(card?.back);
  }
  if (interactive.type === "matching") {
    const pair = interactive.pairs?.[0];
    return normalizeInteractiveTitleText(pair?.left) || normalizeInteractiveTitleText(pair?.right);
  }
  if (interactive.type === "quiz") {
    return normalizeInteractiveTitleText(interactive.questions?.[0]?.text);
  }
  if (interactive.type === "wheel") {
    return normalizeInteractiveTitleText(interactive.segments?.[0]?.title);
  }
  return normalizeInteractiveTitleText(interactive.steps?.[0]?.text);
}

export function getInteractiveDisplayTitle(interactive, fallback = "Без названия") {
  const explicit = normalizeInteractiveTitleText(interactive?.title);
  if (explicit) return explicit;
  return getInteractiveTaskTitle(interactive) || fallback;
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
  if (filterId === "flashcards" || filterId === "matching" || filterId === "sequence" || filterId === "quiz" || filterId === "wheel") {
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

export function isInteractiveTypeAvailable(type) {
  return getTypeMeta(type).available !== false;
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
  quiz: "general",
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
      : interactive.type === "quiz"
        ? "вопросов"
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
    title: getInteractiveDisplayTitle(interactive),
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
