import {
  assignmentActionLabel,
  formatStudentDate,
  interactiveActionLabel,
} from "./StudentSectionUi";

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
};

function isDueToday(iso) {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

export function getStudentAssignmentPath(item) {
  if (item.kind === "interactive") {
    return `/cabinet/student/interactives/${item.interactive_id || item.id}/play`;
  }
  return `/cabinet/student/assignments/${item.id}`;
}

export function mapStudentAssignmentToHwCard(item) {
  const typeLabel = item.type_label || TYPE_LABELS[item.type] || "Задание";
  const isInteractive = item.kind === "interactive";

  let deadlineLabel = item.status_label || "Задание";
  let deadlineTone = STATUS_TONE[item.status] || "default";

  if (item.due_at && !["checked", "completed", "submitted", "reviewing"].includes(item.status)) {
    deadlineLabel = isDueToday(item.due_at) ? "Сегодня" : `До ${formatStudentDate(item.due_at)}`;
    if (item.status === "overdue") {
      deadlineTone = "overdue";
    } else if (isDueToday(item.due_at)) {
      deadlineTone = "today";
    }
  } else if (item.status === "submitted" || item.status === "reviewing") {
    deadlineLabel = "На проверке";
    deadlineTone = "review";
  } else if (item.status === "checked" || item.status === "completed") {
    deadlineLabel = item.status_label || "Готово";
    deadlineTone = "completed";
  }

  const descriptionParts = [];
  if (item.topic) descriptionParts.push(`к уроку «${item.topic}»`);
  if (item.items_count != null) descriptionParts.push(`${item.items_count} элементов`);

  const score = item.result_percent ?? item.score_percent;
  let progressLabel = null;
  let progressPercent = 0;
  let progressTone = "default";
  let hideProgressBar = true;

  if (score != null) {
    progressLabel = `Результат: ${score}%`;
    progressPercent = score;
    progressTone = "completed";
    hideProgressBar = false;
  } else if (item.status === "in_progress") {
    progressLabel = "В работе";
  } else if (item.status === "new") {
    progressLabel = "Новое задание";
  }

  return {
    subject: typeLabel,
    title: item.title,
    description: descriptionParts.length ? descriptionParts.join(" · ") : undefined,
    deadlineLabel,
    deadlineTone,
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
