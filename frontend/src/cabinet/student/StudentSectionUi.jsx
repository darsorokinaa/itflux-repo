import { useEffect, useState } from "react";
import CabinetIcon from "../CabinetIcons";

export const ASSIGNMENT_STATUS_COLORS = {
  new: "#2563EB",
  in_progress: "#7C3AED",
  submitted: "#10B981",
  checked: "#10B981",
  reviewing: "#F59E0B",
  needs_fix: "#E53935",
  overdue: "#E53935",
};

const COVER_GRADIENTS = {
  oge: "linear-gradient(135deg, #7B1226 0%, #C0284A 100%)",
  ege: "linear-gradient(135deg, #0B2F9F 0%, #1550D8 100%)",
  school: "linear-gradient(135deg, #E05A00 0%, #FF8C38 100%)",
  python: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
  material: "linear-gradient(135deg, #2563EB 0%, #4F46E5 100%)",
  interactive: "linear-gradient(135deg, #0B2F9F 0%, #1550D8 100%)",
};

export function StudentCover({ theme = "ege", children, className = "" }) {
  return (
    <div
      className={`st-cover st-cover--${theme} ${className}`.trim()}
      style={{ background: COVER_GRADIENTS[theme] || COVER_GRADIENTS.ege }}
    >
      {children}
    </div>
  );
}

export function StudentStatusBadge({ status, label }) {
  const color = ASSIGNMENT_STATUS_COLORS[status] || "#64748B";
  return (
    <span className="st-status-badge" style={{ "--st-status-color": color }}>
      <span className="st-status-badge__dot" />
      {label}
    </span>
  );
}

export function StudentPageShell({ children, className = "" }) {
  return <div className={`st-page ${className}`.trim()}>{children}</div>;
}

export function StudentPageHeader({ title, subtitle, actions }) {
  return (
    <header className="st-page-header">
      <div>
        <h1 className="st-page-header__title">{title}</h1>
        {subtitle ? <p className="st-page-header__sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="st-page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function StudentFilterPills({ filters, active, onChange }) {
  return (
    <div className="st-filters" role="tablist">
      {filters.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={active === f.id}
          className={`st-filter-pill${active === f.id ? " st-filter-pill--active" : ""}`}
          onClick={() => onChange(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

export function StudentEmptyState({ title, text, actionLabel, onAction, icon = "folder" }) {
  return (
    <div className="st-empty">
      <div className="st-empty__icon" aria-hidden="true">
        <CabinetIcon name={icon} />
      </div>
      <h3 className="st-empty__title">{title}</h3>
      {text ? <p className="st-empty__text">{text}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="cb-btn cb-btn--primary cb-btn--pill" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function StudentLoadingState() {
  return <div className="st-loading" role="status">Загрузка…</div>;
}

export function StudentErrorState({ message, onRetry }) {
  return (
    <div className="st-empty st-empty--error">
      <h3 className="st-empty__title">Не удалось загрузить</h3>
      <p className="st-empty__text">{message || "Попробуйте ещё раз."}</p>
      {onRetry ? (
        <button type="button" className="cb-btn cb-btn--outline" onClick={onRetry}>Повторить</button>
      ) : null}
    </div>
  );
}

export function StudentMetricCard({ label, value, icon, tone = "brand" }) {
  return (
    <article className={`st-metric st-metric--${tone}`}>
      <div className={`st-metric__icon st-metric__icon--${tone}`}>
        <CabinetIcon name={icon} />
      </div>
      <div>
        <p className="st-metric__value">{value}</p>
        <p className="st-metric__label">{label}</p>
      </div>
    </article>
  );
}

export function StudentCardGrid({ children, columns }) {
  return (
    <div className={`st-card-grid${columns ? ` st-card-grid--${columns}` : ""}`}>
      {children}
    </div>
  );
}

export function formatStudentDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return "—";
  }
}

export function formatStudentTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function formatLessonWhen(iso) {
  if (!iso) return "Дата не указана";
  try {
    const d = new Date(iso);
    const now = new Date();
    const time = formatStudentTime(iso);
    if (d.toDateString() === now.toDateString()) return `Сегодня · ${time}`;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return `Завтра · ${time}`;
    return `${formatStudentDate(iso)} · ${time}`;
  } catch {
    return "Дата не указана";
  }
}

export function formatDueDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const date = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return `до ${date}, ${time}`;
  } catch {
    return "";
  }
}

const STUDENT_META_SKIP = new Set(["нет", "none", "—", "-", "без экзамена"]);

export function isMeaningfulStudentMetaPart(value) {
  const text = (value || "").trim();
  if (!text) return false;
  if (STUDENT_META_SKIP.has(text.toLowerCase())) return false;
  return true;
}

/** Краткая строка под темой занятия: формат и учитель (без служебных «Нет» и статусов). */
export function studentLessonMeta(event) {
  const { formatLine, teacher } = studentLessonMetaParts(event);
  return [formatLine, teacher].filter(Boolean).join(" · ");
}

export function studentLessonMetaParts(event) {
  const formatParts = [];
  const formatSource = event?.format_label || event?.format || "Онлайн";
  formatSource
    .split(" · ")
    .map((part) => part.trim())
    .filter(isMeaningfulStudentMetaPart)
    .forEach((part) => {
      if (!formatParts.includes(part)) formatParts.push(part);
    });
  const formatLine = formatParts.length ? formatParts.join(" · ") : "Онлайн";
  const teacher = isMeaningfulStudentMetaPart(event?.teacher_name) ? event.teacher_name : "";
  return { formatLine, teacher };
}

/** Показывать «Подключиться» за 15 минут до начала (как JITSI_JOIN_BEFORE_MINUTES). */
export const LESSON_CONNECT_BEFORE_MS = 15 * 60 * 1000;
/** Дополнительное окно после окончания (как JITSI_JOIN_AFTER_MINUTES). */
export const LESSON_CONNECT_AFTER_MS = 30 * 60 * 1000;

function lessonEndMs(startsAt, endsAt) {
  if (endsAt) {
    const end = new Date(endsAt).getTime();
    if (!Number.isNaN(end)) return end;
  }
  if (!startsAt) return 0;
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return 0;
  return start + 90 * 60 * 1000;
}

export function isLessonInProgress(startsAt, endsAt, now = Date.now()) {
  if (!startsAt) return false;
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return false;
  const end = lessonEndMs(startsAt, endsAt);
  return now >= start && now < end;
}

export function formatLessonTimeRange(startsAt, endsAt) {
  if (!startsAt) return "";
  const start = formatStudentTime(startsAt);
  const end = endsAt ? formatStudentTime(endsAt) : "";
  return end ? `${start}–${end}` : start;
}

export function useScheduleNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}

export function useLessonInProgress(startsAt, endsAt) {
  const [live, setLive] = useState(() => isLessonInProgress(startsAt, endsAt));

  useEffect(() => {
    const update = () => setLive(isLessonInProgress(startsAt, endsAt));
    update();
    const id = window.setInterval(update, 30000);
    return () => window.clearInterval(id);
  }, [startsAt, endsAt]);

  return live;
}

export function canShowLessonConnectButton(startsAt, endsAt, now = Date.now(), meetingStatus = "") {
  // Пока конференция live — кнопка активна до завершения урока учителем.
  if (meetingStatus === "live") return true;
  if (!startsAt) return false;
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return false;
  const end = lessonEndMs(startsAt, endsAt) + LESSON_CONNECT_AFTER_MS;
  return now >= start - LESSON_CONNECT_BEFORE_MS && now <= end;
}

export function lessonMeetingHref(event) {
  const status = event?.video_meeting?.status || event?.videoMeeting?.status;
  // Пока учитель не начал урок — не отдаём ссылку для «Подключиться».
  if (status && status !== "live") return "";
  const vmUrl = event?.video_meeting?.pageUrl || event?.videoMeeting?.pageUrl;
  if (vmUrl) return vmUrl;
  return event?.meeting_url || event?.link || "";
}

export function isInternalMeetingHref(href) {
  return typeof href === "string" && href.startsWith("/cabinet/meetings/");
}

export function useLessonConnectAvailable(startsAt, endsAt, meetingStatus = "") {
  const [available, setAvailable] = useState(() =>
    canShowLessonConnectButton(startsAt, endsAt, Date.now(), meetingStatus),
  );

  useEffect(() => {
    const update = () => setAvailable(
      canShowLessonConnectButton(startsAt, endsAt, Date.now(), meetingStatus),
    );
    update();
    const id = window.setInterval(update, 30000);
    return () => window.clearInterval(id);
  }, [startsAt, endsAt, meetingStatus]);

  return available;
}

export function lessonActionLabel(status) {
  if (status === "completed") return "Открыть";
  if (status === "in_progress") return "Продолжить";
  return "Открыть";
}

export function assignmentActionLabel(status) {
  if (status === "checked") return "Результат";
  if (status === "needs_fix") return "Исправить";
  if (status === "submitted") return "Результат";
  if (status === "overdue") return "Сдать";
  return status === "new" ? "Открыть" : "Сдать";
}

export function interactiveActionLabel(action) {
  if (action === "result") return "Результат";
  if (action === "continue") return "Продолжить";
  return "Начать";
}
