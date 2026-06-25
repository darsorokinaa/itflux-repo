import { getTypeMeta } from "./interactivesData";

export const SUBJECT_CHIPS = ["Информатика", "Математика", "Другое"];

export const EXAM_CHIPS = [
  { value: "без экзамена", label: "Без экзамена" },
  { value: "ОГЭ", label: "ОГЭ" },
  { value: "ЕГЭ", label: "ЕГЭ" },
];

export const DIFFICULTY_CHIPS = [
  { value: "базовый", label: "Лёгкий" },
  { value: "средний", label: "Средний" },
  { value: "продвинутый", label: "Сложный" },
];

export const TYPE_SEGMENTS = [
  { id: "flashcards", label: "Карточки" },
  { id: "matching", label: "Сопоставление" },
  { id: "sequence", label: "Порядок" },
  { id: "quiz", label: "Викторина" },
  { id: "wheel", label: "Колесо" },
];

export function editorTypeSubtitle(type) {
  const meta = getTypeMeta(type);
  if (type === "flashcards") return "карточки для запоминания";
  if (type === "matching") return "сопоставление понятий";
  if (type === "sequence") return "сборка порядка шагов";
  if (type === "quiz") return "вопросы с вариантами ответов";
  if (type === "wheel") return "случайный выбор сектора";
  return meta.label?.toLowerCase() || "интерактив";
}

export function computeInteractiveFillProgress(data) {
  if (!data) return { percent: 0, summary: [] };

  const checks = [];
  const titleOk = Boolean((data.title || "").trim());
  const topicOk = Boolean((data.topic || "").trim());
  checks.push({ label: "Название", ok: titleOk });
  checks.push({ label: "Тема", ok: topicOk });

  let contentOk = false;
  let contentDetail = "";

  if (data.type === "flashcards") {
    const cards = data.cards || [];
    contentOk = cards.length > 0;
    const complete = cards.filter((c) => (c.front || "").trim() && (c.back || "").trim()).length;
    contentDetail = `${complete} из ${cards.length} карточек заполнены`;
    checks.push({ label: "Карточки", ok: contentOk && complete > 0 });
    checks.push({ label: "Лицо и ответ", ok: complete > 0 });
  } else if (data.type === "matching") {
    const pairs = data.pairs || [];
    contentOk = pairs.length > 0;
    const complete = pairs.filter((p) => (p.left || "").trim() && (p.right || "").trim()).length;
    contentDetail = `${complete} из ${pairs.length} пар заполнены`;
    checks.push({ label: "Пары", ok: contentOk && complete > 0 });
    checks.push({ label: "Слева и справа", ok: complete > 0 });
  } else if (data.type === "quiz") {
    const questions = data.questions || [];
    contentOk = questions.length > 0;
    const complete = questions.filter((q) => {
      const textOk = (q.text || "").trim();
      const answers = q.answers || [];
      const hasCorrect = answers.some((a) => a.is_correct);
      const filledAnswers = answers.filter((a) => (a.text || "").trim()).length;
      return textOk && filledAnswers >= 2 && hasCorrect;
    }).length;
    contentDetail = `${complete} из ${questions.length} вопросов готовы`;
    checks.push({ label: "Вопросы", ok: contentOk && complete > 0 });
    checks.push({ label: "Ответы и правильный вариант", ok: complete > 0 });
  } else if (data.type === "wheel") {
    const segments = data.segments || [];
    const complete = segments.filter((s) => (s.title || "").trim()).length;
    contentOk = complete >= 2;
    contentDetail = `${complete} секторов заполнено`;
    checks.push({ label: "Сектора", ok: complete >= 2 });
    checks.push({ label: "Минимум 2 сектора", ok: complete >= 2 });
  } else {
    const steps = data.steps || [];
    contentOk = steps.length > 0;
    const complete = steps.filter((s) => (s.text || "").trim()).length;
    contentDetail = `${complete} из ${steps.length} шагов заполнены`;
    checks.push({ label: "Шаги", ok: contentOk && complete > 0 });
    checks.push({ label: "Текст шага", ok: complete > 0 });
  }

  const done = checks.filter((c) => c.ok).length;
  const percent = Math.round((done / checks.length) * 100);

  return {
    percent,
    checks,
    contentDetail,
    summary: [
      titleOk ? data.title.trim() : "Название не задано",
      topicOk ? data.topic.trim() : "Тема не указана",
      contentDetail || "Нет содержимого",
    ],
  };
}

export function reorderList(items, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

const DIFFICULTY_LABELS = {
  базовый: "Лёгкий",
  средний: "Средний",
  продвинутый: "Сложный",
};

export function difficultyLabel(value) {
  return DIFFICULTY_LABELS[value] || value || "—";
}

export function getInteractiveLaunchMeta(interactive) {
  if (!interactive) return "";
  const count = interactive.type === "flashcards"
    ? (interactive.cards || []).length
    : interactive.type === "matching"
      ? (interactive.pairs || []).length
      : interactive.type === "quiz"
        ? (interactive.questions || []).length
        : interactive.type === "wheel"
          ? (interactive.segments || []).length
          : (interactive.steps || []).length;
  const itemLabel = interactive.type === "flashcards"
    ? "карточек"
    : interactive.type === "matching"
      ? "пар"
      : interactive.type === "quiz"
        ? "вопросов"
        : interactive.type === "wheel"
          ? "секторов"
          : "элементов";
  const parts = [`${count} ${itemLabel}`];
  if (interactive.exam && interactive.exam !== "без экзамена") parts.push(interactive.exam);
  if (interactive.topic?.trim()) parts.push(interactive.topic.trim());
  return parts.join(" · ");
}

export function interactiveHasPlayableContent(interactive) {
  if (!interactive) return false;
  if (interactive.type === "flashcards") {
    return (interactive.cards || []).some((c) => (c.front || "").trim() && (c.back || "").trim());
  }
  if (interactive.type === "matching") {
    return (interactive.pairs || []).some((p) => (p.left || "").trim() && (p.right || "").trim());
  }
  if (interactive.type === "quiz") {
    return (interactive.questions || []).some((q) => (q.text || "").trim());
  }
  if (interactive.type === "wheel") {
    return (interactive.segments || []).filter((s) => (s.title || "").trim()).length >= 2;
  }
  return (interactive.steps || []).some((s) => (s.text || "").trim());
}

export function getInteractiveSummaryChips(interactive) {
  if (!interactive) return [];
  const count = interactive.type === "flashcards"
    ? (interactive.cards || []).length
    : interactive.type === "matching"
      ? (interactive.pairs || []).length
      : interactive.type === "quiz"
        ? (interactive.questions || []).length
        : interactive.type === "wheel"
          ? (interactive.segments || []).length
          : (interactive.steps || []).length;
  const itemLabel = interactive.type === "flashcards"
    ? "карточек"
    : interactive.type === "matching"
      ? "пар"
      : interactive.type === "quiz"
        ? "вопросов"
        : interactive.type === "wheel"
          ? "секторов"
          : "элементов";
  const chips = [`${count} ${itemLabel}`];
  chips.push(difficultyLabel(interactive.difficulty));
  const statusMeta = interactive.status === "published"
    ? "Опубликован"
    : interactive.status === "assigned"
      ? "Выдан"
      : "Черновик";
  chips.push(statusMeta);
  if (interactive.access === "assignable") chips.push("Можно выдать ученикам");
  else chips.push("Только мне");
  return chips;
}
