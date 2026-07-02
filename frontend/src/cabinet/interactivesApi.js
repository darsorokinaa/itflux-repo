import { DEFAULT_APPEARANCE } from "./interactiveAppearance";
import { DEFAULT_PARAMS } from "./interactivesData";
import { DEFAULT_WHEEL_SETTINGS } from "./wheelUtils";

const EXAM_TO_API = {
  ОГЭ: { exam_type: "oge", direction: "oge" },
  ЕГЭ: { exam_type: "ege", direction: "ege" },
  "без экзамена": { exam_type: "none", direction: "other" },
  Python: { exam_type: "none", direction: "python" },
};

const SUBJECT_TO_DIRECTION = {
  Информатика: "other",
  Математика: "school",
  Другое: "other",
};

function examLabelFromApi(examType, direction) {
  if (examType === "oge" || direction === "oge") return "ОГЭ";
  if (examType === "ege" || direction === "ege") return "ЕГЭ";
  if (direction === "python") return "Python";
  return "без экзамена";
}

function subjectLabelFromDirection(direction) {
  if (direction === "school") return "Математика";
  return "Информатика";
}

function frontendTypeFromApi(type) {
  return type === "ordering" ? "sequence" : type;
}

function apiTypeFromFrontend(type) {
  return type === "sequence" ? "ordering" : type;
}

function mapFlashcardsFromApi(items) {
  return (items || []).map((card) => ({
    front: card.front_text || "",
    back: card.back_text || "",
    hint: card.hint || "",
    explanation: card.explanation || "",
  }));
}

function mapMatchingFromApi(items) {
  return (items || []).map((pair) => ({
    left: pair.left_text || "",
    right: pair.right_text || "",
    explanation: pair.explanation || "",
  }));
}

function mapOrderingFromApi(items) {
  return (items || []).map((step) => ({
    text: step.text || "",
    explanation: step.explanation || "",
    position: step.correct_order ?? 1,
  }));
}

function mapQuizFromApi(items) {
  return (items || []).map((question) => ({
    id: String(question.id),
    text: question.question_text || "",
    answer_type: question.answer_type || "single",
    answers: question.answers || [],
    explanation: question.explanation || "",
    points: question.points ?? 1,
  }));
}

function mapWheelFromApi(items) {
  return (items || []).map((segment) => ({
    id: segment.id || String(segment.order ?? ""),
    title: segment.title || "",
    description: segment.description || "",
    color: segment.color || "",
    points: segment.points ?? 0,
    order: segment.order ?? 0,
  }));
}

function appearanceFromApi(api) {
  return {
    backgroundSlug: api.background?.slug || "light-gray",
    cardStyleSlug: api.card_style?.slug || DEFAULT_APPEARANCE.cardStyleSlug,
    soundPackSlug: api.sound_pack?.slug || DEFAULT_APPEARANCE.soundPackSlug,
    soundEnabled: api.sound_enabled !== false,
    backgroundImage: null,
    backgroundImageTone: "light",
  };
}

function baseInteractiveFromApi(api) {
  const type = frontendTypeFromApi(api.interactive_type);
  const exam = examLabelFromApi(api.exam_type, api.direction);
  return {
    id: api.id,
    type,
    title: api.title || "",
    subject: subjectLabelFromDirection(api.direction),
    exam,
    topic: api.topic || "",
    subtopic: api.subtopic || "",
    taskNumber: api.task_number || "",
    difficulty: api.difficulty || "средний",
    instruction: api.instruction || "",
    status: api.status || "draft",
    access: "assignable",
    updatedAt: api.updated_at || api.created_at || new Date().toISOString(),
    usedIn: [],
    results: [],
    params: { ...DEFAULT_PARAMS },
    ...appearanceFromApi(api),
    direction: api.direction,
    examType: api.exam_type,
    itemsCount: api.items_count ?? 0,
    interactiveTypeLabel: api.interactive_type_label || "",
    statusLabel: api.status_label || "",
    raw: api,
  };
}

export function mapApiInteractiveListItem(api) {
  const base = baseInteractiveFromApi(api);
  if (base.type === "flashcards") base.cards = [];
  if (base.type === "matching") base.pairs = [];
  if (base.type === "sequence") base.steps = [];
  if (base.type === "quiz") base.questions = [];
  if (base.type === "wheel") {
    base.segments = [];
    base.wheelSettings = { ...DEFAULT_WHEEL_SETTINGS };
  }
  return base;
}

export function mapApiInteractiveDetail(api) {
  const base = baseInteractiveFromApi(api);
  const type = base.type;

  if (type === "flashcards") {
    base.cards = mapFlashcardsFromApi(api.flashcards);
    if (!base.cards.length) {
      base.cards = [{ front: "", back: "", hint: "", explanation: "" }];
    }
  }
  if (type === "matching") {
    base.pairs = mapMatchingFromApi(api.matching_pairs);
    base.shufflePairs = true;
    base.showResultImmediately = false;
    if (!base.pairs.length) {
      base.pairs = [{ left: "", right: "", explanation: "" }];
    }
  }
  if (type === "sequence") {
    base.steps = mapOrderingFromApi(api.ordering_items);
    base.allowMultipleAttempts = true;
    base.showAnswerOnError = true;
    if (!base.steps.length) {
      base.steps = [{ text: "", explanation: "", position: 1 }];
    }
  }
  if (type === "quiz") {
    base.questions = mapQuizFromApi(api.quiz_questions);
    if (!base.questions.length) {
      base.questions = [{
        id: `q${Date.now()}`,
        text: "",
        answer_type: "single",
        answers: [],
        explanation: "",
        points: 1,
      }];
    }
  }
  if (type === "wheel") {
    base.segments = mapWheelFromApi(api.wheel_segments);
    base.wheelSettings = { ...(api.wheel_settings || DEFAULT_WHEEL_SETTINGS) };
  }

  return base;
}

function resolveExamAndDirection(interactive) {
  const mapped = EXAM_TO_API[interactive.exam];
  if (mapped) return mapped;
  const direction = SUBJECT_TO_DIRECTION[interactive.subject] || interactive.direction || "other";
  return { exam_type: "none", direction };
}

export function buildInteractiveWritePayload(interactive, statusOverride) {
  const { exam_type, direction } = resolveExamAndDirection(interactive);
  const payload = {
    title: interactive.title || "",
    description: interactive.description || "",
    interactive_type: apiTypeFromFrontend(interactive.type),
    direction,
    exam_type,
    topic: interactive.topic || "",
    subtopic: interactive.subtopic || "",
    task_number: interactive.taskNumber || interactive.task_number || "",
    difficulty: interactive.difficulty || "",
    instruction: interactive.instruction || "",
    background_slug: interactive.backgroundSlug || null,
    card_style_slug: interactive.cardStyleSlug || null,
    sound_pack_slug: interactive.soundPackSlug || null,
    sound_enabled: interactive.soundEnabled !== false,
    status: statusOverride || interactive.status || "draft",
  };

  if (interactive.type === "wheel") {
    payload.wheel_settings = interactive.wheelSettings || DEFAULT_WHEEL_SETTINGS;
    payload.wheel_segments = (interactive.segments || []).map((segment, index) => ({
      id: segment.id || undefined,
      title: segment.title || "",
      description: segment.description || "",
      color: segment.color || "",
      points: segment.points ?? 0,
      order: segment.order ?? index,
    }));
  }

  if (interactive.type === "flashcards") {
    payload.flashcards = (interactive.cards || []).map((card, index) => ({
      front_text: card.front || "",
      back_text: card.back || "",
      hint: card.hint || "",
      explanation: card.explanation || "",
      order: index,
    }));
  }

  if (interactive.type === "matching") {
    payload.matching_pairs = (interactive.pairs || []).map((pair, index) => ({
      left_text: pair.left || "",
      right_text: pair.right || "",
      explanation: pair.explanation || "",
      order: index,
    }));
  }

  if (interactive.type === "sequence") {
    payload.ordering_items = (interactive.steps || []).map((step, index) => ({
      text: step.text || "",
      explanation: step.explanation || "",
      correct_order: step.position ?? (index + 1),
    }));
  }

  if (interactive.type === "quiz") {
    payload.quiz_questions = (interactive.questions || []).map((question, index) => ({
      question_text: question.text || "",
      answer_type: question.answer_type || "single",
      answers: question.answers || [],
      explanation: question.explanation || "",
      points: question.points ?? 1,
      order: index,
    }));
  }

  if (payload.status === "assigned") {
    payload.status = "published";
  }

  return payload;
}

export function normalizeInteractivesList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}
