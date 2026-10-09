import { inferExamTaskPart } from "./examTaskPart";
import {
  isUserAnswerCorrect,
  scoreInformaticsTableTask,
} from "./examAnswerCheck";

/**
 * Первичный максимум задания.
 * В модели max_score по умолчанию 1. Пустое значение не подменяется тройкой.
 */
export function taskMaxPoints(task) {
  const raw = task?.max_score;
  if (raw == null || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, n);
}

function taskKey(task) {
  return String(task?.id ?? "");
}

function answerText(answers, task) {
  if (!answers || typeof answers !== "object") return "";
  const id = taskKey(task);
  const direct = answers[id] ?? answers[task?.id];
  if (direct == null) return "";
  if (typeof direct === "object" && direct && "text" in direct) return String(direct.text ?? "");
  return String(direct);
}

function explicitScore(scores, task) {
  if (!scores || typeof scores !== "object") return null;
  const id = taskKey(task);
  if (!Object.prototype.hasOwnProperty.call(scores, id) && !Object.prototype.hasOwnProperty.call(scores, task?.id)) {
    return null;
  }
  const raw = scores[id] ?? scores[task?.id];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function checkedFlag(checked, task) {
  if (!checked || typeof checked !== "object") return null;
  const id = taskKey(task);
  const raw = Object.prototype.hasOwnProperty.call(checked, id)
    ? checked[id]
    : (Object.prototype.hasOwnProperty.call(checked, task?.id) ? checked[task.id] : undefined);
  if (typeof raw === "boolean") return raw;
  return null;
}

function hasAttachment(attachmentIds, task) {
  if (!attachmentIds) return false;
  const id = taskKey(task);
  if (attachmentIds instanceof Set) return attachmentIds.has(id) || attachmentIds.has(task?.id);
  return Boolean(attachmentIds[id] || attachmentIds[task?.id]);
}

function clampPoints(value, maxPoints) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const capped = Math.min(Math.max(0, n), maxPoints);
  return Math.abs(capped - Math.round(capped)) < 1e-9 ? Math.round(capped) : Math.round(capped * 100) / 100;
}

function statusFromPoints(points, maxPoints) {
  if (maxPoints > 0 && points >= maxPoints) return "correct";
  if (points > 0) return "partial";
  return "incorrect";
}

function isInfPartialTask(task, level, subject) {
  const sub = String(subject || "").toLowerCase();
  const lv = String(level || "").toLowerCase();
  const num = Number(task?.number);
  return sub === "inf" && lv === "ege" && (num === 26 || num === 27);
}

/**
 * Итог попытки по фактическому составу варианта.
 * Баллы и число верных заданий считаются отдельно.
 * Пропуск и ожидание ручной проверки не становятся «неверно».
 */
export function tasksForStoredAttempt(liveTasks, result, level = "", subject = "") {
  const snapshot = Array.isArray(result?.tasks_snapshot)
    ? result.tasks_snapshot.filter((row) => row && row.id != null)
    : [];
  if (!snapshot.length) return Array.isArray(liveTasks) ? liveTasks : [];
  const grading = new Map(
    (Array.isArray(result?.grading_snapshot) ? result.grading_snapshot : [])
      .filter((row) => row && row.id != null)
      .map((row) => [String(row.id), row]),
  );
  const live = new Map((liveTasks || []).map((task) => [String(task.id), task]));
  return snapshot.map((row) => {
    const frozen = grading.get(String(row.id)) || {};
    const current = live.get(String(row.id)) || {};
    const examPart = frozen.exam_part ?? row.exam_part ?? current.exam_part;
    const merged = {
      ...current,
      id: row.id,
      number: row.number ?? current.number,
      max_score: row.max_score ?? frozen.max_score ?? current.max_score,
      exam_part: examPart,
      part: row.part ?? current.part,
      part_title: row.part_title || current.part_title || "",
      subdivision: row.subdivision || current.subdivision || "",
      answer: frozen.answer != null ? String(frozen.answer) : "",
    };
    const partNumber = Number(examPart);
    const part = partNumber === 1 || partNumber === 2
      ? partNumber
      : inferExamTaskPart(merged, level, subject);
    return { ...merged, part };
  });
}

export function scoreVariantAttempt({
  tasks,
  level = "",
  subject = "",
  answers = {},
  scores = {},
  checked = {},
  attachmentIds = null,
} = {}) {
  const list = Array.isArray(tasks) ? tasks : [];
  const rows = [];
  let earned = 0;
  let maxPoints = 0;
  const counts = {
    correct: 0,
    incorrect: 0,
    partial: 0,
    unanswered: 0,
    pending: 0,
  };

  for (const task of list) {
    const part = inferExamTaskPart(task, level, subject) === 2 ? 2 : 1;
    const max = taskMaxPoints(task);
    const text = answerText(answers, task).trim();
    const attached = hasAttachment(attachmentIds, task);
    const answered = Boolean(text) || attached;
    const given = explicitScore(scores, task);
    const flag = checkedFlag(checked, task);
    const expected = String(task?.answer ?? "");
    let status = "unanswered";
    let points = 0;

    if (part === 2) {
      if (given == null) {
        status = "pending_review";
      } else {
        points = clampPoints(given, max);
        status = statusFromPoints(points, max);
      }
    } else if (!answered && given == null) {
      status = "unanswered";
    } else if (isInfPartialTask(task, level, subject) && expected.trim()) {
      const tableScore = scoreInformaticsTableTask(task.number, text, expected);
      points = clampPoints(tableScore ?? 0, max);
      status = answered ? statusFromPoints(points, max) : "unanswered";
      if (!answered) points = 0;
    } else if (isInfPartialTask(task, level, subject) && given != null) {
      points = clampPoints(given, max);
      status = answered ? statusFromPoints(points, max) : "unanswered";
      if (!answered) points = 0;
    } else if (expected.trim() && answered) {
      const ok = isUserAnswerCorrect(text, expected, subject);
      points = ok ? max : 0;
      status = ok ? "correct" : "incorrect";
    } else if (flag === true) {
      points = max;
      status = "correct";
    } else if (flag === false) {
      points = 0;
      status = answered ? "incorrect" : "unanswered";
    } else if (answered) {
      status = "pending_review";
    } else {
      status = "unanswered";
    }

    if (status === "correct") counts.correct += 1;
    else if (status === "incorrect") counts.incorrect += 1;
    else if (status === "partial") counts.partial += 1;
    else if (status === "pending_review") counts.pending += 1;
    else counts.unanswered += 1;

    earned += points;
    maxPoints += max;
    rows.push({
      id: task?.id,
      number: task?.number ?? null,
      part,
      status,
      points,
      max_points: max,
    });
  }

  const total = list.length;
  const checkedCount = counts.correct + counts.incorrect + counts.partial;
  let reviewStatus = "final";
  if (total === 0) reviewStatus = "empty";
  else if (counts.pending > 0) reviewStatus = "pending_review";

  let percentage = null;
  if (reviewStatus === "final" && maxPoints > 0) {
    percentage = Math.round((earned / maxPoints) * 10000) / 100;
  }

  return {
    total_tasks: total,
    correct_count: counts.correct,
    incorrect_count: counts.incorrect,
    partial_count: counts.partial,
    unanswered_count: counts.unanswered,
    pending_review_count: counts.pending,
    checked_count: checkedCount,
    earned_points: earned,
    max_points: maxPoints,
    percentage,
    review_status: reviewStatus,
    preliminary: reviewStatus === "pending_review",
    tasks: rows,
  };
}
