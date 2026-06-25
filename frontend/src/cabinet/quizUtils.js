export function genQuizId(prefix = "id") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmptyAnswer() {
  return { id: genQuizId("a"), text: "", is_correct: false };
}

export function createEmptyQuestion() {
  return {
    id: genQuizId("q"),
    text: "",
    answer_type: "single",
    answers: [createEmptyAnswer(), createEmptyAnswer()],
    explanation: "",
    points: 1,
  };
}

export function shuffleArray(items) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

export function getCorrectAnswerIds(question) {
  return (question.answers || []).filter((a) => a.is_correct).map((a) => a.id);
}

export function checkQuestionAnswer(question, selectedIds) {
  const correctIds = getCorrectAnswerIds(question).sort();
  const selected = [...selectedIds].sort();
  if (question.answer_type === "single") {
    return selected.length === 1 && correctIds.length >= 1 && selected[0] === correctIds[0];
  }
  return correctIds.length > 0
    && correctIds.length === selected.length
    && correctIds.every((id, index) => id === selected[index]);
}

export function summarizeQuestion(question) {
  const answers = question.answers || [];
  const correctCount = answers.filter((a) => a.is_correct).length;
  return `${answers.length} вариант${answers.length === 1 ? "" : answers.length < 5 ? "а" : "ов"} · ${correctCount} правильн${correctCount === 1 ? "ый" : "ых"}`;
}

export function computeQuizResult(questions, answerRecords) {
  const records = answerRecords || [];
  const maxScore = questions.reduce((sum, q) => sum + (Number(q.points) || 1), 0);
  const earnedScore = records.reduce((sum, r) => sum + (r.earned_points || 0), 0);
  const correctCount = records.filter((r) => r.is_correct).length;
  const percent = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
  const mistakes = records
    .filter((r) => !r.is_correct)
    .map((r) => {
      const idx = questions.findIndex((q) => q.id === r.question_id);
      return idx >= 0 ? idx + 1 : r.question_id;
    });

  return {
    score: earnedScore,
    max_score: maxScore,
    percent,
    correct_count: correctCount,
    total: questions.length,
    mistakes,
    answers: records,
  };
}

export function gradeQuestionAnswer(question, selectedIds) {
  const isCorrect = checkQuestionAnswer(question, selectedIds);
  const points = Number(question.points) || 1;
  return {
    question_id: question.id,
    selected_answer_ids: selectedIds,
    is_correct: isCorrect,
    earned_points: isCorrect ? points : 0,
  };
}

export function cloneQuestion(question) {
  return {
    ...question,
    id: genQuizId("q"),
    answers: (question.answers || []).map((a) => ({ ...a, id: genQuizId("a") })),
  };
}
