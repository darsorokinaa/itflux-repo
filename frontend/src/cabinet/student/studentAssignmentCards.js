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

export function getStudentAssignmentPath(item) {
  if (item.kind === "interactive") {
    return `/cabinet/student/interactives/${item.interactive_id || item.id}/play`;
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

  let deadlineLabel = item.status_label || "Задание";
  let deadlineTone = STATUS_TONE[item.status] || "default";
  let metaLine = "";
  let comment = "";

  if (item.status === "needs_fix") {
    deadlineLabel = "Нужна доработка";
    deadlineTone = "overdue";
    metaLine = "Учитель оставил замечания";
    comment = commentPreview(item.result_summary?.teacher_comment_preview || item.teacher_comment);
  } else if (item.due_at && !["checked", "completed", "submitted", "reviewing"].includes(item.status)) {
    const dueTime = formatStudentTime(item.due_at);
    deadlineLabel = isDueToday(item.due_at)
      ? (dueTime ? `Сегодня, ${dueTime}` : "Сегодня")
      : `До ${formatStudentDate(item.due_at)}${dueTime ? `, ${dueTime}` : ""}`;
    if (item.status === "overdue") {
      deadlineTone = "overdue";
    } else if (isDueToday(item.due_at)) {
      deadlineTone = "today";
    }
    if (item.status === "new" || item.status === "in_progress") {
      metaLine = item.due_at ? `Сдать до ${formatStudentDate(item.due_at)}` : "";
    }
  } else if (item.status === "submitted" || item.status === "reviewing") {
    deadlineLabel = "Сдано";
    deadlineTone = "review";
    metaLine = "Ожидает проверки преподавателем";
  } else if (item.status === "checked" || item.status === "completed") {
    deadlineLabel = item.status_label || "Проверено";
    deadlineTone = "completed";
    comment = commentPreview(item.result_summary?.teacher_comment_preview || item.teacher_comment);
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
    if (item.status === "in_progress") {
      progressLabel = "В работе";
      progressTone = "review";
    } else if (item.status === "new") {
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
      : assignmentActionLabel(item.status),
    actionPrimary: true,
  };
}
