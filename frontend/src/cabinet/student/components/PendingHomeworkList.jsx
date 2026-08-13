import { Link } from "react-router-dom";
import {
  StudentStatusBadge,
  formatDueDate,
} from "../StudentSectionUi";
import { getStudentAssignmentPath } from "../studentAssignmentCards";
import {
  studentHwActionLabel,
  studentHwStatusLabel,
} from "../studentDisplay";

export function PendingHomeworkCard({ item, showTeacher = false }) {
  const subject = item.student_subject_label || item.type_label || "Задание";
  const title = item.topic || item.title;
  const statusLabel = studentHwStatusLabel(item.status, item.status_label);
  const actionLabel = studentHwActionLabel(item.status);
  const isOverdue = item.status === "overdue";
  const hasProgress =
    item.items_count > 0
    || (item.progress_percent != null && item.progress_percent > 0)
    || item.result_percent != null;

  let progressText = "";
  if (item.result_percent != null) {
    progressText = `Результат: ${Math.round(item.result_percent)}%`;
  } else if (item.items_count > 0) {
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
        {hasProgress && progressText ? (
          <div className="st-pending-hw__progress">
            {item.items_count > 0 && item.result_percent == null ? (
              <div
                className="st-pending-hw__bar"
                role="progressbar"
                aria-valuenow={item.progress_percent || 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${Math.min(100, item.progress_percent || 0)}%` }} />
              </div>
            ) : null}
            <span>{progressText}</span>
          </div>
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
