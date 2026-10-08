import {
  assignmentActionLabel,
  formatStudentDate,
  formatStudentTime,
  interactiveActionLabel,
} from "./StudentSectionUi";
import {
  commentPreview,
  formatResultCounts,
  formatResultPercent,
} from "../homeworkResultSummary";
import { isDueAtPast } from "../homeworkDueAt";

const TYPE_LABELS = {
  homework: "Домашнее задание",
  variant: "Вариант",
  flashcards: "Карточки",
  matching: "Сопоставление",
  sequence: "Порядок",
  ordering: "Порядок",
  interactive: "Интерактив",
};

const STATUS_TONE = {
  new: "default",
  in_progress: "default",
  submitted: "review",
  reviewing: "review",
  checked: "completed",
  completed: "completed",
  overdue: "overdue",
  needs_fix: "overdue",
};

function isDueToday(iso) {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

/** «Просрочено» только если срок сдачи уже прошёл. Будущая дата не перебивается статусом. */
export function studentHomeworkStatus(item) {
  const status = item?.status || "";
  if (status === "overdue" && item?.due_at && !isDueAtPast(item.due_at)) {
    return "new";
  }
  return status;
}

export const STUDENT_PHASE_LABEL = {
  not_submitted: "Не сдано",
  reviewing: "На проверке",
  needs_fix: "На доработке",
  checked: "Проверено",
  overdue: "Просрочено",
};

/** Статус карточки ученика берётся из поля status, а не из submitted_at. */
export function studentAssignmentPhase(item) {
  const status = studentHomeworkStatus(item || {});
  if (status === "checked" || status === "completed") return "checked";
  if (status === "needs_fix") return "needs_fix";
  if (status === "submitted" || status === "reviewing") return "reviewing";
  if (status === "overdue") return "overdue";
  return "not_submitted";
}

export function studentTeacherRemark(item) {
  if (!item) return null;
  if (item.review_comment_conflict) {
    return {
      kind: "conflict",
      text: "Замечания по проверке различаются. Уточните у преподавателя, какой комментарий учитывать.",
    };
  }
  const text = String(
    item.teacher_comment || item.result_summary?.teacher_comment_preview || "",
  ).trim();
  if (!text) return null;
  const phase = studentAssignmentPhase(item);
  if (phase === "needs_fix") return { kind: "current", text };
  if (phase === "checked") return { kind: "final", text };
  if (phase === "reviewing") return { kind: "history", text };
  return null;
}

export function getStudentAssignmentPath(item) {
  if (item.kind === "interactive") {
    return `/cabinet/student/interactives/${item.interactive_assignment_id || item.id}/play`;
  }
  const base = `/cabinet/student/assignments/${item.id}`;
  if (item.status === "checked" || item.status === "completed") {
    return `${base}?focus=results`;
  }
  return base;
}

export function studentResultBlock(item) {
  const summary = item.result_summary;
  if (summary?.is_final) {
    return {
      countsLabel: formatResultCounts(summary),
      percentage: formatResultPercent(summary),
    };
  }
  return null;
}

export function mapStudentAssignmentToHwCard(item) {
  const typeLabel = item.student_subject_label || item.type_label || TYPE_LABELS[item.type] || "Задание";
  const isInteractive = item.kind === "interactive";
  const status = studentHomeworkStatus(item);

  let deadlineLabel = (status === item.status ? item.status_label : "") || "Задание";
  let deadlineTone = STATUS_TONE[status] || "default";
  let metaLine = "";
  let comment = "";

  const remark = studentTeacherRemark(item);
  if (status === "needs_fix") {
    deadlineLabel = "На доработке";
    deadlineTone = "overdue";
    metaLine = "Нужно исправить работу";
    comment = remark?.kind === "current" ? commentPreview(remark.text) : "";
  } else if (item.due_at && !["checked", "completed", "submitted", "reviewing"].includes(status)) {
    const dueTime = formatStudentTime(item.due_at);
    deadlineLabel = isDueToday(item.due_at)
      ? (dueTime ? `Сегодня, ${dueTime}` : "Сегодня")
      : `До ${formatStudentDate(item.due_at)}${dueTime ? `, ${dueTime}` : ""}`;
    if (status === "overdue" && isDueAtPast(item.due_at)) {
      deadlineTone = "overdue";
    } else if (isDueToday(item.due_at)) {
      deadlineTone = "today";
    } else {
      deadlineTone = "default";
    }
    if (status === "new" || status === "in_progress") {
      metaLine = item.due_at ? `Сдать до ${formatStudentDate(item.due_at)}` : "";
    }
  } else if (status === "submitted" || status === "reviewing") {
    deadlineLabel = "На проверке";
    deadlineTone = "review";
    metaLine = "Ожидает проверки преподавателем";
  } else if (status === "checked" || status === "completed") {
    deadlineLabel = "Проверено";
    deadlineTone = "completed";
    comment = remark?.kind === "final" ? commentPreview(remark.text) : "";
  }

  const descriptionParts = [];
  if (item.topic) descriptionParts.push(`к уроку «${item.topic}»`);
  if (item.items_count != null && !studentResultBlock(item)) {
    descriptionParts.push(`${item.items_count} элементов`);
  }

  const result = isInteractive
    ? (item.result_percent != null || item.score_percent != null
      ? { percentage: Math.round(Number(item.result_percent ?? item.score_percent)), countsLabel: "" }
      : null)
    : studentResultBlock(item);
  let progressLabel = null;
  let progressPercent = 0;
  let progressTone = "default";
  let hideProgressBar = true;

  if (!result) {
    if (status === "in_progress") {
      progressLabel = "В работе";
      progressTone = "review";
    } else if (status === "new") {
      progressLabel = null;
    }
  }

  return {
    subject: typeLabel,
    title: item.title,
    description: descriptionParts.length ? descriptionParts.join(" · ") : undefined,
    deadlineLabel,
    deadlineTone,
    metaLine,
    commentPreview: comment,
    result,
    progressLabel,
    progressPercent,
    progressTone,
    hideProgressBar,
    actionLabel: isInteractive
      ? interactiveActionLabel(item.action)
      : assignmentActionLabel(status),
    actionPrimary: true,
  };
}
