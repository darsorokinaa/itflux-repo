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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function mapFlashcardsFromApi(items) {
  return asArray(items).map((card) => ({
    front: card.front_text || "",
    back: card.back_text || "",
    front_image_url: card.front_image_url || "",
    back_image_url: card.back_image_url || "",
    hint: card.hint || "",
    explanation: card.explanation || "",
  }));
}

function mapMatchingFromApi(items) {
  return asArray(items).map((pair) => ({
    left: pair.left_text || "",
    right: pair.right_text || "",
    left_image_url: pair.left_image_url || "",
    right_image_url: pair.right_image_url || "",
    explanation: pair.explanation || "",
  }));
}

function mapOrderingFromApi(items) {
  return asArray(items).map((step) => ({
    text: step.text || "",
    image_url: step.image_url || "",
    explanation: step.explanation || "",
    position: step.correct_order ?? 1,
  }));
}

function mapQuizFromApi(items) {
  return asArray(items).map((question) => ({
    id: String(question.id),
    text: question.question_text || "",
    image_url: question.image_url || "",
    answer_type: question.answer_type || "single",
    answers: asArray(question.answers).map((answer) => ({
      ...answer,
      image_url: answer?.image_url || "",
    })),
    explanation: question.explanation || "",
    points: question.points ?? 1,
  }));
}

function mapWheelFromApi(items) {
  return asArray(items).map((segment) => ({
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
    backgroundSlug: api.background?.slug || api.background_slug || DEFAULT_APPEARANCE.backgroundSlug || "light-gray",
    cardStyleSlug: api.card_style?.slug || api.card_style_slug || DEFAULT_APPEARANCE.cardStyleSlug,
    soundPackSlug: api.sound_pack?.slug || api.sound_pack_slug || DEFAULT_APPEARANCE.soundPackSlug,
    soundEnabled: api.sound_enabled !== false,
    backgroundImage: null,
    backgroundImageTone: "light",
  };
}

function emptyContentForType(type) {
  if (type === "flashcards") {
    return {
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
      pairs: [{
        left: "",
        right: "",
        left_image_url: "",
        right_image_url: "",
        explanation: "",
      }],
      shufflePairs: true,
      showResultImmediately: false,
    };
  }
  if (type === "sequence") {
    return {
      steps: [{ text: "", image_url: "", explanation: "", position: 1 }],
      allowMultipleAttempts: true,
      showAnswerOnError: true,
    };
  }
  if (type === "quiz") {
    return {
      questions: [{
        id: `q${Date.now()}`,
        text: "",
        image_url: "",
        answer_type: "single",
        answers: [],
        explanation: "",
        points: 1,
      }],
    };
  }
  if (type === "wheel") {
    return {
      segments: [],
      wheelSettings: { ...DEFAULT_WHEEL_SETTINGS },
    };
  }
  return {};
}

/**
 * Unified adapter: API Interactive → frontend interactive object.
 * Handles both Detail and Write-shaped responses.
 */
function baseInteractiveFromApi(api) {
  const type = frontendTypeFromApi(api.interactive_type || api.type);
  const exam = examLabelFromApi(api.exam_type, api.direction);
  const id = api.id ?? api.pk ?? null;
  return {
    id,
    type,
    title: api.title || api.name || "",
    description: api.description || "",
    subject: subjectLabelFromDirection(api.direction),
    exam,
    topic: api.topic || "",
    subtopic: api.subtopic || "",
    taskNumber: api.task_number || "",
    difficulty: api.difficulty || "средний",
    instruction: api.instruction || "",
    status: api.status || (api.is_published ? "published" : "draft"),
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
  if (!api || typeof api !== "object") {
    return null;
  }
  const base = baseInteractiveFromApi(api);
  if (base.type === "flashcards") base.cards = [];
  else if (base.type === "matching") base.pairs = [];
  else if (base.type === "sequence") base.steps = [];
  else if (base.type === "quiz") base.questions = [];
  else if (base.type === "wheel") {
    base.segments = [];
    base.wheelSettings = { ...DEFAULT_WHEEL_SETTINGS };
  }
  return base;
}

export function mapApiInteractiveDetail(api) {
  if (!api || typeof api !== "object") {
    throw new Error("Некорректный ответ API интерактива");
  }
  const base = baseInteractiveFromApi(api);
  const type = base.type;

  if (type === "flashcards") {
    base.cards = mapFlashcardsFromApi(api.flashcards);
    if (!base.cards.length) {
      Object.assign(base, emptyContentForType("flashcards"));
    }
  } else if (type === "matching") {
    base.pairs = mapMatchingFromApi(api.matching_pairs);
    base.shufflePairs = true;
    base.showResultImmediately = false;
    if (!base.pairs.length) {
      Object.assign(base, emptyContentForType("matching"));
    }
  } else if (type === "sequence") {
    base.steps = mapOrderingFromApi(api.ordering_items);
    base.allowMultipleAttempts = true;
    base.showAnswerOnError = true;
    if (!base.steps.length) {
      Object.assign(base, emptyContentForType("sequence"));
    }
  } else if (type === "quiz") {
    base.questions = mapQuizFromApi(api.quiz_questions);
    if (!base.questions.length) {
      Object.assign(base, emptyContentForType("quiz"));
    }
  } else if (type === "wheel") {
    base.segments = mapWheelFromApi(api.wheel_segments);
    base.wheelSettings = { ...(api.wheel_settings || DEFAULT_WHEEL_SETTINGS) };
  } else {
    Object.assign(base, emptyContentForType("flashcards"));
    base.type = "flashcards";
  }

  return base;
}

/**
 * Merge save response into current editor state without losing id/type content
 * if the response is partial.
 */
export function mergeInteractiveAfterSave(current, apiData) {
  const mapped = mapApiInteractiveDetail(apiData);
  if (!mapped.id && current?.id) {
    mapped.id = current.id;
  }
  if (!mapped.type && current?.type) {
    mapped.type = current.type;
  }
  // Preserve local-only fields not returned by API.
  if (current?.params) mapped.params = current.params;
  if (current?.backgroundImage) {
    mapped.backgroundImage = current.backgroundImage;
    mapped.backgroundImageTone = current.backgroundImageTone || mapped.backgroundImageTone;
  }
  return mapped;
}

function resolveExamAndDirection(interactive) {
  const mapped = EXAM_TO_API[interactive.exam];
  if (mapped) return mapped;
  const direction = SUBJECT_TO_DIRECTION[interactive.subject] || interactive.direction || "other";
  return { exam_type: "none", direction };
}

function normalizeImageUrl(url) {
  const value = String(url || "").trim();
  return value;
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
      front_image_url: normalizeImageUrl(card.front_image_url),
      back_image_url: normalizeImageUrl(card.back_image_url),
      hint: card.hint || "",
      explanation: card.explanation || "",
      order: index,
    }));
  }

  if (interactive.type === "matching") {
    payload.matching_pairs = (interactive.pairs || []).map((pair, index) => ({
      left_text: pair.left || "",
      right_text: pair.right || "",
      left_image_url: normalizeImageUrl(pair.left_image_url),
      right_image_url: normalizeImageUrl(pair.right_image_url),
      explanation: pair.explanation || "",
      order: index,
    }));
  }

  if (interactive.type === "sequence") {
    payload.ordering_items = (interactive.steps || []).map((step, index) => ({
      text: step.text || "",
      image_url: normalizeImageUrl(step.image_url),
      explanation: step.explanation || "",
      correct_order: step.position ?? (index + 1),
    }));
  }

  if (interactive.type === "quiz") {
    payload.quiz_questions = (interactive.questions || []).map((question, index) => ({
      question_text: question.text || "",
      image_url: normalizeImageUrl(question.image_url),
      answer_type: question.answer_type || "single",
      answers: (question.answers || []).map((answer) => ({
        ...answer,
        image_url: normalizeImageUrl(answer?.image_url),
      })),
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
