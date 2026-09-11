const TURNED_IN_STATUSES = new Set([
  "submitted",
  "checked",
  "returned",
  "needs_revision",
  "pending_review",
  "in_review",
]);

const HOMEWORK_STATUS_LABELS = {
  submitted: "Сдано",
  checked: "Проверено",
  returned: "Возвращено",
  needs_revision: "Нужна доработка",
  pending_review: "На проверке",
  in_review: "На проверке",
  overdue: "Просрочено",
  not_submitted: "Не сдано",
  in_progress: "В работе",
  new: "Не начато",
};

export function isHomeworkTurnedIn(entry) {
  if (!entry) return false;
  if (entry.submitted_at) return true;
  const status = String(entry.status || "").toLowerCase();
  return TURNED_IN_STATUSES.has(status);
}

export function wasHomeworkSubmittedLate(entry) {
  if (!isHomeworkTurnedIn(entry)) return false;
  return Boolean(entry?.submitted_late || entry?.is_overdue);
}

export function isUnsubmittedOverdue(entry) {
  if (isHomeworkTurnedIn(entry)) return false;
  const status = String(entry?.status || "").toLowerCase();
  return Boolean(entry?.is_overdue) || status === "overdue";
}

export function homeworkJournalStatusKey(entry) {
  if (isHomeworkTurnedIn(entry)) {
    const status = String(entry?.status || "").toLowerCase();
    if (TURNED_IN_STATUSES.has(status)) return status;
    return "submitted";
  }
  if (isUnsubmittedOverdue(entry)) return "overdue";
  return String(entry?.status || "").toLowerCase();
}

export function homeworkJournalStatusLabel(entry) {
  const key = homeworkJournalStatusKey(entry);
  if (isHomeworkTurnedIn(entry)) {
    const raw = String(entry?.status_label || "").trim();
    if (raw && !/просроч/i.test(raw)) return raw;
    return HOMEWORK_STATUS_LABELS[key] || "Сдано";
  }
  if (key === "overdue") return "Просрочено";
  const raw = String(entry?.status_label || "").trim();
  if (raw) return raw;
  return HOMEWORK_STATUS_LABELS[key] || "Не сдано";
}

export function homeworkJournalStatusTone(entry) {
  const key = homeworkJournalStatusKey(entry);
  if (key === "overdue") return "danger";
  if (key === "checked") return "success";
  if (key === "returned" || key === "needs_revision") return "warning";
  return "info";
}
