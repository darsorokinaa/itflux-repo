import { Link } from "react-router-dom";
import {
  StudentStatusBadge,
  formatDueDate,
} from "../StudentSectionUi";
import { getStudentAssignmentPath, studentResultBlock } from "../studentAssignmentCards";
import {
  studentHwActionLabel,
  studentHwStatusLabel,
} from "../studentDisplay";
import { commentPreview } from "../../homeworkResultSummary";

export function PendingHomeworkCard({ item, showTeacher = false }) {
  const subject = item.student_subject_label || item.type_label || "Задание";
  const title = item.topic || item.title;
  const statusLabel = studentHwStatusLabel(item.status, item.status_label);
  const actionLabel = studentHwActionLabel(item.status);
  const isOverdue = item.status === "overdue";
  const result = studentResultBlock(item);
  const comment = commentPreview(item.result_summary?.teacher_comment_preview || item.teacher_comment);

  let progressText = "";
  if (result) {
    const parts = [result.countsLabel, result.percentage != null ? `${result.percentage}%` : ""].filter(Boolean);
    progressText = parts.length ? `Результат ${parts.join(" · ")}` : "";
  } else if (item.status === "submitted" || item.status === "reviewing") {
    progressText = "Ожидает проверки преподавателем";
  } else if (item.status === "needs_fix") {
    progressText = "Учитель оставил замечания";
  } else if (item.items_count > 0 && item.result_percent == null) {
    progressText = `Выполнено ${item.items_done ?? 0} из ${item.items_count} заданий`;
  } else if (item.progress_percent > 0 && item.status === "in_progress") {
    progressText = "В процессе";
  }

  return (
    <article className={`st-pending-hw${isOverdue ? " st-pending-hw--overdue" : ""}`}>
      <div className="st-pending-hw__body">
        <div className="st-pending-hw__top">
          <span className="st-pending-hw__subject">{subject}</span>
          <StudentStatusBadge status={item.status} label={statusLabel} />
        </div>
        <h3 className="st-pending-hw__title">{title}</h3>
        {item.topic && item.title && item.topic !== item.title ? (
          <p className="st-pending-hw__subtitle">{item.title}</p>
        ) : null}
        <div className="st-pending-hw__meta">
          {item.due_at ? (
            <span className={isOverdue ? "st-pending-hw__due st-pending-hw__due--late" : "st-pending-hw__due"}>
              Срок: {formatDueDate(item.due_at).replace(/^до /i, "до ")}
            </span>
          ) : null}
          {showTeacher && item.teacher_name ? <span>Учитель: {item.teacher_name}</span> : null}
        </div>
        {progressText ? (
          <div className="st-pending-hw__progress">
            {result?.percentage != null ? (
              <div
                className="st-pending-hw__bar"
                role="progressbar"
                aria-label="Результат"
                aria-valuenow={result.percentage}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${Math.min(100, result.percentage)}%` }} />
              </div>
            ) : null}
            <span>{progressText}</span>
          </div>
        ) : null}
        {comment && (item.status === "checked" || item.status === "needs_fix") ? (
          <p className="st-hw-card__comment">{comment}</p>
        ) : null}
      </div>
      <Link
        to={getStudentAssignmentPath(item)}
        className="cb-btn cb-btn--primary cb-btn--sm"
      >
        {actionLabel}
      </Link>
    </article>
  );
}

export default function PendingHomeworkList({ items = [], emptyTitle, emptyText }) {
  if (!items.length) {
    return (
      <div className="st-dash-empty">
        <p className="st-dash-empty__title">{emptyTitle || "Все задания выполнены"}</p>
        {emptyText ? <p className="st-dash-empty__text">{emptyText}</p> : (
          <p className="st-dash-empty__text">Когда появится новое домашнее задание, оно будет здесь.</p>
        )}
      </div>
    );
  }

  const preview = items.slice(0, 3);
  const teacherNames = new Set(
    preview.map((item) => item.teacher_name).filter(Boolean),
  );
  const showTeacher = teacherNames.size > 1;

  return (
    <div className="st-dash-card-stack">
      {preview.map((item) => (
        <PendingHomeworkCard
          key={`${item.kind || "assignment"}-${item.id}`}
          item={item}
          showTeacher={showTeacher}
        />
      ))}
    </div>
  );
}
