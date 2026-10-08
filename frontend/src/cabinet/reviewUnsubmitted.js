function formatIssued(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function formatDue(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSameLocalDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === new Date().toDateString();
}

export function mapUnsubmittedWork(row) {
  const studentName = (row.student_name || "").trim() || "Без ученика";
  const initials = studentName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const overdue = row.is_overdue === true;
  const draft = row.status === "draft";
  const dueLabel = formatDue(row.due_at);
  const issued = formatIssued(row.issued_at);
  const filter = ["missing", "students"];
  if (overdue) filter.push("overdue");
  const level = String(row.level || "").toLowerCase();
  if (level.includes("oge") || level === "огэ") filter.push("oge");
  if (level.includes("ege") || level === "егэ") filter.push("ege");
  if (row.group_id || row.group_title) filter.push("groups");

  let deadlineLabel = draft ? "Черновик" : "Не сдано";
  let deadlineTone = overdue ? "overdue" : "info";
  if (dueLabel) {
    deadlineLabel = `До ${dueLabel}`;
    if (!overdue) deadlineTone = isSameLocalDay(row.due_at) ? "today" : "default";
  }
  const notes = [];
  if (draft) notes.push("Черновик");
  if (issued) notes.push(`Выдано ${issued}`);
  if (overdue) notes.push("Просрочено");

  return {
    id: String(row.id),
    kind: "unsubmitted",
    homeworkId: row.homework_id,
    openPath: row.open_path || (row.homework_id ? `/cabinet/homework/${row.homework_id}/edit` : ""),
    status: row.status || "not_submitted",
    canDeleteHomework: true,
    dueAt: row.due_at || null,
    issuedAt: row.issued_at || null,
    overdue,
    awaitingSubmission: true,
    submittedForReview: false,
    studentId: row.student_id != null ? String(row.student_id) : "",
    studentName,
    groupId: row.group_id != null ? String(row.group_id) : "",
    groupTitle: row.group_title || "Без группы",
    filter,
    coverType: "exam",
    deadlineLabel,
    deadlineTone,
    subject: row.subject_label || "Домашнее задание",
    title: row.title || "Домашнее задание",
    metaLine: notes.join(" · "),
    result: null,
    students: [{ initials, name: studentName }],
    actionLabel: "Открыть задание",
  };
}

export function classifyReviewItem(item, { overdue = false } = {}) {
  const filter = ["all"];
  const submittedAt = item?.homework_submission?.submitted_at;
  const awaitingSubmission = item?.status === "pending" && !submittedAt;
  if (item?.status === "pending") {
    if (!awaitingSubmission) filter.push("new");
    filter.push("inbox");
  } else if (item?.status === "returned") {
    filter.push("returned");
  } else {
    filter.push("done");
  }
  if (overdue) filter.push("overdue");
  return { filter, awaitingSubmission };
}

export function reviewQueues(reviewWorks, unsubmittedWorks) {
  return {
    toReview: reviewWorks.filter((item) => item.filter?.includes("new")),
    notSubmitted: unsubmittedWorks.filter((item) => item.filter?.includes("missing")),
    returned: reviewWorks.filter((item) => item.filter?.includes("returned")),
    checked: reviewWorks.filter(
      (item) => item.filter?.includes("done") && !item.filter?.includes("returned"),
    ),
    overdue: [
      ...reviewWorks.filter((item) => item.filter?.includes("overdue")),
      ...unsubmittedWorks.filter((item) => item.overdue),
    ],
  };
}

export function reviewTabCounts(reviewWorks, unsubmittedWorks, serverCounts = {}) {
  const queues = reviewQueues(reviewWorks, unsubmittedWorks);
  return {
    all: serverCounts.all ?? reviewWorks.length,
    pending: serverCounts.pending ?? queues.toReview.length,
    unsubmitted: serverCounts.unsubmitted ?? queues.notSubmitted.length,
    returned: serverCounts.returned ?? queues.returned.length,
    checked: serverCounts.checked ?? queues.checked.length,
    overdue: queues.overdue.length,
  };
}
