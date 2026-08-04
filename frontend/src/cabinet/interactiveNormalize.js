/**
 * Normalize interactive payloads from API / legacy localStorage / partial saves
 * into a stable frontend shape without mutating the source.
 */

import { DEFAULT_APPEARANCE } from "./interactiveAppearance";
import { DEFAULT_PARAMS } from "./interactivesData";
import { DEFAULT_WHEEL_SETTINGS } from "./wheelUtils";

const VALID_TYPES = new Set(["flashcards", "matching", "sequence", "quiz", "wheel"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text || text === "null" || text === "undefined") return "";
  return text;
}

function frontendType(type) {
  if (type === "ordering") return "sequence";
  return VALID_TYPES.has(type) ? type : "flashcards";
}

function normalizeStatus(status) {
  if (status === "assigned" || status === "published" || status === "review" || status === "archived") {
    return status;
  }
  if (status === "draft") return "draft";
  return "draft";
}

/**
 * Deep-ish clone of interactive content for a fresh play session.
 * Does not mutate the original interactive object.
 */
export function cloneInteractiveForPlay(interactive) {
  if (!interactive || typeof interactive !== "object") return null;
  try {
    return structuredClone(interactive);
  } catch {
    return JSON.parse(JSON.stringify(interactive));
  }
}

/**
 * Initial play-session state (answers / progress), separate from content.
 */
export function getInteractiveInitialState(interactive) {
  const type = frontendType(interactive?.type);
  return {
    type,
    started: false,
    completed: false,
    scorePercent: null,
    answers: {},
    mistakes: [],
    index: 0,
    sessionStartedAt: null,
  };
}

/**
 * Normalize any interactive-like object for UI rendering.
 * Safe defaults for missing fields; never throws on incomplete data.
 */
export function normalizeInteractiveData(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      id: null,
      type: "flashcards",
      title: "",
      description: "",
      subject: "",
      exam: "",
      topic: "",
      status: "draft",
      params: { ...DEFAULT_PARAMS, autoTextBackdrop: true },
      ...DEFAULT_APPEARANCE,
      cards: [],
      pairs: [],
      steps: [],
      questions: [],
      segments: [],
      wheelSettings: { ...DEFAULT_WHEEL_SETTINGS },
      updatedAt: null,
      results: [],
    };
  }

  const type = frontendType(raw.type || raw.interactive_type);
  const params = {
    ...DEFAULT_PARAMS,
    autoTextBackdrop: true,
    ...(raw.params && typeof raw.params === "object" ? raw.params : {}),
  };

  const base = {
    ...raw,
    id: raw.id ?? raw.pk ?? null,
    type,
    title: cleanText(raw.title || raw.name),
    description: cleanText(raw.description),
    subject: cleanText(raw.subject),
    exam: cleanText(raw.exam),
    topic: cleanText(raw.topic),
    subtopic: cleanText(raw.subtopic),
    instruction: cleanText(raw.instruction),
    status: normalizeStatus(raw.status),
    difficulty: cleanText(raw.difficulty) || "средний",
    updatedAt: raw.updatedAt || raw.updated_at || null,
    params,
    backgroundSlug: raw.backgroundSlug || raw.background_slug || DEFAULT_APPEARANCE.backgroundSlug,
    cardStyleSlug: raw.cardStyleSlug || raw.card_style_slug || DEFAULT_APPEARANCE.cardStyleSlug,
    soundPackSlug: raw.soundPackSlug || raw.sound_pack_slug || DEFAULT_APPEARANCE.soundPackSlug,
    soundEnabled: raw.soundEnabled !== false && raw.sound_enabled !== false,
    backgroundImage: raw.backgroundImage || null,
    backgroundImageTone: raw.backgroundImageTone || "light",
    autoTextBackdrop: params.autoTextBackdrop !== false,
    results: asArray(raw.results),
  };

  if (type === "flashcards") {
    base.cards = asArray(raw.cards || raw.flashcards).map((card) => ({
      front: cleanText(card.front || card.front_text),
      back: cleanText(card.back || card.back_text),
      front_image_url: cleanText(card.front_image_url),
      back_image_url: cleanText(card.back_image_url),
      hint: cleanText(card.hint),
      explanation: cleanText(card.explanation),
    }));
  } else if (type === "matching") {
    base.pairs = asArray(raw.pairs || raw.matching_pairs).map((pair) => ({
      left: cleanText(pair.left || pair.left_text),
      right: cleanText(pair.right || pair.right_text),
      left_image_url: cleanText(pair.left_image_url),
      right_image_url: cleanText(pair.right_image_url),
      explanation: cleanText(pair.explanation),
    }));
    base.shufflePairs = raw.shufflePairs !== false;
  } else if (type === "sequence") {
    base.steps = asArray(raw.steps || raw.ordering_items).map((step, index) => ({
      text: cleanText(step.text),
      image_url: cleanText(step.image_url),
      explanation: cleanText(step.explanation),
      position: step.position ?? step.correct_order ?? index + 1,
    }));
  } else if (type === "quiz") {
    base.questions = asArray(raw.questions || raw.quiz_questions).map((q) => ({
      id: String(q.id != null ? q.id : (cleanText(q.text || q.question_text) || Math.random())),
      text: cleanText(q.text || q.question_text),
      image_url: cleanText(q.image_url),
      answer_type: q.answer_type === "multiple" ? "multiple" : "single",
      answers: asArray(q.answers).map((a) => ({
        ...a,
        text: cleanText(a?.text),
        image_url: cleanText(a?.image_url),
      })),
      explanation: cleanText(q.explanation),
      points: q.points ?? 1,
    }));
  } else if (type === "wheel") {
    base.segments = asArray(raw.segments || raw.wheel_segments).map((seg, index) => ({
      id: seg.id || String(seg.order ?? index),
      title: cleanText(seg.title),
      description: cleanText(seg.description),
      color: cleanText(seg.color) || "#2563EB",
      points: seg.points ?? 0,
      order: seg.order ?? index,
    }));
    base.wheelSettings = {
      ...DEFAULT_WHEEL_SETTINGS,
      ...(raw.wheelSettings || raw.wheel_settings || {}),
    };
  }

  return base;
}

/**
 * Theme helpers used by players and editor preview.
 */
export function getInteractiveTheme(interactive, appearance) {
  const autoBackdrop = interactive?.autoTextBackdrop !== false
    && interactive?.params?.autoTextBackdrop !== false;
  const textTone = appearance?.backgroundImageTone
    || appearance?.background?.text_tone
    || "dark";
  const textColor = textTone === "light" ? "#ffffff" : "#0f172a";
  return {
    autoTextBackdrop: autoBackdrop,
    textTone: textTone === "light" ? "light" : "dark",
    textColor,
  };
}

/**
 * Display-safe meta fields: skip empty / nullish labels.
 */
export function getInteractiveCardMeta(interactive) {
  const data = normalizeInteractiveData(interactive);
  const parts = [];
  if (data.subject) parts.push({ key: "subject", label: data.subject });
  if (data.exam && data.exam !== "без экзамена") parts.push({ key: "exam", label: data.exam });
  if (data.topic) parts.push({ key: "topic", label: data.topic });
  if (data.difficulty) parts.push({ key: "difficulty", label: data.difficulty });
  return {
    title: data.title || "Без названия",
    description: data.description,
    status: data.status,
    metaParts: parts,
    updatedAt: data.updatedAt,
  };
}

/**
 * Ownership check for edit actions.
 * Teacher API is scoped to owner; optional authorId comparison for future shared catalogs.
 */
export function canEditInteractive(interactive, currentUserId) {
  if (!interactive?.id) return false;
  if (interactive.isOwner === false) return false;
  if (interactive.isOwner === true) return true;
  if (currentUserId == null) return true;
  const ownerId = interactive.teacherId ?? interactive.teacher_id ?? interactive.authorId;
  if (ownerId == null) return true;
  return Number(ownerId) === Number(currentUserId);
}
