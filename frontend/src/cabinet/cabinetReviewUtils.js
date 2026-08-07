import { homeworkTaskAttachments } from "../utils/cabinetHomework";
import {
  computePart1TaskCorrect,
  formatCorrectAnswerPlain,
} from "../utils/examAnswerCheck";

export { inferExamTaskPart, isMathLikeSubject } from "../utils/examTaskPart";

function answerValue(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw && "text" in raw) return String(raw.text ?? "");
  return String(raw);
}

/** Сколько задач в варианте с этим bank-номером (№8, №8, …). */
export function numberCollisionCount(tasks, numKey) {
  if (!numKey || !Array.isArray(tasks)) return 0;
  return tasks.reduce((n, t) => (String(t?.number) === String(numKey) ? n + 1 : n), 0);
}

/**
 * Ответ ученика по заданию.
 * Учитывает legacy, когда by_task_id заполняли ключами-номерами заданий.
 * by_number безопасен только если номер уникален — иначе один ответ
 * размножается на все строки тетради из одного типа заданий.
 * @param {object} result
 * @param {string|number} taskId
 * @param {string|number} taskNumber
 * @param {Array<{id?: string|number, number?: string|number}>} [tasks]
 */
export function homeworkTaskAnswer(result, taskId, taskNumber, tasks) {
  if (!result || typeof result !== "object") return "";
  const byId = result.by_task_id || result.byTaskId || {};
  const byNum = result.by_number || result.byNumber || {};
  const id = String(taskId);
  const num = String(taskNumber);
  const numberUnique = numberCollisionCount(tasks, num) <= 1;

  const fromId = answerValue(byId[id]);
  if (fromId.trim() !== "") return fromId;

  if (numberUnique) {
    const fromNum = answerValue(byNum[num] ?? byNum[String(Number(num))]);
    if (fromNum.trim() !== "") return fromNum;
  }

  // Legacy: by_task_id["6"] = ответ на задание №6 (ключ — номер, не TaskList.id)
  if (id !== num && numberUnique) {
    const knownIds = Array.isArray(tasks)
      ? new Set(tasks.map((t) => String(t.id)))
      : null;
    const numIsRealTaskId = knownIds ? knownIds.has(num) : false;
    if (!numIsRealTaskId) {
      const legacy = answerValue(byId[num] ?? byId[String(Number(num))]);
      if (legacy.trim() !== "") return legacy;
    }
  }
  return "";
}

export function homeworkTaskScore(result, taskId) {
  const scores = result?.scores || {};
  const v = scores[String(taskId)];
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isNaN(n) ? "" : n;
}

export function homeworkTaskChecked(result, taskId) {
  const ch = result?.checked || {};
  const v = ch[String(taskId)];
  return typeof v === "boolean" ? v : null;
}

export function homeworkTaskComment(result, taskId, taskNumber, tasks) {
  if (!result || typeof result !== "object") return "";
  const byId = result.comments_by_task_id || result.commentsByTaskId || {};
  const byNum = result.comments_by_number || result.commentsByNumber || {};
  const id = String(taskId);
  const num = String(taskNumber);
  const fromId = String(byId[id] || "").trim();
  if (fromId) return fromId;
  if (numberCollisionCount(tasks, num) > 1) return "";
  return String(byNum[num] || byNum[String(Number(num))] || "").trim();
}

export function taskMaxScore(task) {
  const raw = task?.max_score;
  if (raw != null && !Number.isNaN(Number(raw))) return Number(raw);
  return 3;
}

export function formatReviewDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

export function buildTeacherVariantUrl(reviewCtx) {
  return String(reviewCtx?.variant_path || "").trim();
}

export function homeworkTeacherAttachments(result, taskId, taskNumber, tasks) {
  if (!result || typeof result !== "object") return [];
  const byId = result.teacher_attachments_by_task_id || result.teacherAttachmentsByTaskId || {};
  const byNum = result.teacher_attachments_by_number || result.teacherAttachmentsByNumber || {};
  const id = String(taskId);
  const num = String(taskNumber);
  if (byId[id]) {
    return Array.isArray(byId[id]) ? byId[id] : [];
  }
  if (numberCollisionCount(tasks, num) > 1) return [];
  const list = byNum[num] || byNum[String(Number(num))] || [];
  return Array.isArray(list) ? list : [];
}

export { homeworkTaskAttachments };
export { computePart1TaskCorrect, formatCorrectAnswerPlain } from "../utils/examAnswerCheck";

/** Вердикт ч.1: без ответа всегда «Нет ответа», даже если checked=false. */
export function resolvePart1Verdict(task, answer, result, subject) {
  const text = String(answer ?? "").trim();
  if (!text) return null;
  const saved = homeworkTaskChecked(result, task.id);
  if (typeof saved === "boolean") return saved;
  return computePart1TaskCorrect(task, text, subject);
}

export function buildStudentHomeworkReviewRows(tasks, result, level, subject) {
  if (!Array.isArray(tasks) || !tasks.length || !result || typeof result !== "object") {
    return { part1: [], part2: [], teacherComment: "" };
  }
  const teacherComment = String(
    result.teacher_comment || result.review_comment || result.teacherComment || ""
  ).trim();
  const part1 = [];
  const part2 = [];
  const list = [...tasks].sort((a, b) => a.number - b.number);
  for (const task of list) {
    const part = inferExamTaskPart(task, level, subject);
    const answer = homeworkTaskAnswer(result, task.id, task.number, list);
    const comment = homeworkTaskComment(result, task.id, task.number, list);
    const teacherFiles = homeworkTeacherAttachments(result, task.id, task.number, list);
    const studentFiles = homeworkTaskAttachments(result, task.id, task.number, list);
    const correctAnswer = formatCorrectAnswerPlain(task.answer);
    if (part === 1) {
      part1.push({
        taskId: String(task.id),
        number: task.number,
        answer,
        correctAnswer,
        verdict: resolvePart1Verdict(task, answer, result, subject),
        comment,
        teacherFiles,
        studentFiles,
      });
    } else {
      part2.push({
        taskId: String(task.id),
        number: task.number,
        answer,
        correctAnswer,
        score: homeworkTaskScore(result, task.id),
        maxScore: taskMaxScore(task),
        comment,
        teacherFiles,
        studentFiles,
      });
    }
  }
  return { part1, part2, teacherComment };
}

function hasReviewAnswer(row) {
  return Boolean(String(row?.answer || "").trim());
}

function hasReviewStudentFiles(row) {
  return Array.isArray(row?.studentFiles) && row.studentFiles.length > 0;
}

function isReviewTaskCompleted(row, part) {
  if (part === 1) return hasReviewAnswer(row) || hasReviewStudentFiles(row);
  return hasReviewAnswer(row) || hasReviewStudentFiles(row) || (row.score !== "" && row.score != null);
}

function isReviewTaskCorrect(row, part) {
  if (part === 1) return row.verdict === true;
  const score = Number(row.score);
  const max = Number(row.maxScore);
  if (Number.isNaN(score) || Number.isNaN(max) || max <= 0) return false;
  return score >= max;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

/** Сводная статистика для блока «Результаты проверки». */
export function computeHomeworkReviewSummary(review) {
  const part1 = review?.part1 || [];
  const part2 = review?.part2 || [];
  const total = part1.length + part2.length;

  const p1Completed = part1.filter((row) => isReviewTaskCompleted(row, 1)).length;
  const p2Completed = part2.filter((row) => isReviewTaskCompleted(row, 2)).length;
  const completed = p1Completed + p2Completed;

  const p1Correct = part1.filter((row) => isReviewTaskCorrect(row, 1)).length;
  const p2Correct = part2.filter((row) => isReviewTaskCorrect(row, 2)).length;
  const correct = p1Correct + p2Correct;

  const p2ScoreSum = part2.reduce((sum, row) => {
    const n = Number(row.score);
    return sum + (Number.isNaN(n) ? 0 : n);
  }, 0);
  const p2MaxSum = part2.reduce((sum, row) => sum + (Number(row.maxScore) || 0), 0);

  return {
    total,
    completed,
    completedPct: pct(completed, total),
    correct,
    correctOfCompletedPct: pct(correct, completed),
    correctOfTotalPct: pct(correct, total),
    part1: {
      total: part1.length,
      completed: p1Completed,
      completedPct: pct(p1Completed, part1.length),
      correct: p1Correct,
      correctOfCompletedPct: pct(p1Correct, p1Completed),
      correctOfTotalPct: pct(p1Correct, part1.length),
    },
    part2: {
      total: part2.length,
      completed: p2Completed,
      completedPct: pct(p2Completed, part2.length),
      correct: p2Correct,
      correctOfCompletedPct: pct(p2Correct, p2Completed),
      correctOfTotalPct: pct(p2Correct, part2.length),
      scoreSum: p2ScoreSum,
      maxSum: p2MaxSum,
      scorePct: pct(p2ScoreSum, p2MaxSum),
    },
  };
}

export function formatHomeworkVerdict(verdict) {
  if (verdict === true) return "Верно";
  if (verdict === false) return "Неверно";
  return "Нет ответа";
}

export function parseVariantApiUrl(openUrl) {
  const text = String(openUrl || "").trim();
  if (!text) return null;
  try {
    const u = new URL(text, typeof window !== "undefined" ? window.location.origin : "http://localhost/");
    const m = u.pathname.match(/\/(oge|ege|vpr)\/([^/]+)\/variant\/(\d+)/i);
    if (!m) return null;
    return `/api/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2])}/variant/${encodeURIComponent(m[3])}/`;
  } catch {
    return null;
  }
}
