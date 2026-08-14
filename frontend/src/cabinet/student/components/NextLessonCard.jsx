import { Link } from "react-router-dom";
import CabinetIcon from "../../CabinetIcons";
import {
  LESSON_CONNECT_BEFORE_MS,
  formatLessonTimeRange,
  formatStudentTime,
  isInternalMeetingHref,
  lessonMeetingHref,
  studentLessonMetaParts,
  useLessonConnectAvailable,
  useLessonInProgress,
  useScheduleNow,
} from "../StudentSectionUi";
import { formatCountdownTo, formatDayLabel } from "../studentDisplay";
import ConnectionCheckButton from "../../connectionCheck/ConnectionCheckButton";
import { closeConnectionCheck } from "../../connectionCheck/openConnectionCheck";
import LastCheckHint from "../../connectionCheck/LastCheckHint";
import { shouldRemindBeforeLesson } from "../../connectionCheck/storage";

function MeetingButton({ href, className, children, onClick }) {
  if (isInternalMeetingHref(href)) {
    return (
      <Link
        to={href}
        className={className}
        onClick={(e) => {
          closeConnectionCheck();
          onClick?.(e);
        }}
      >
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        closeConnectionCheck();
        onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}

export default function NextLessonCard({ lesson, onOpenSchedule }) {
  const now = useScheduleNow(30000);
  const vmStatus = lesson.video_meeting?.status || lesson.videoMeeting?.status;
  const canConnect = useLessonConnectAvailable(lesson.starts_at, lesson.ends_at, vmStatus);
  const inProgress = useLessonInProgress(lesson.starts_at, lesson.ends_at);
  const topic = lesson.topic || lesson.title || "Индивидуальное занятие";
  const subject = lesson.student_subject_label || "";
  const { formatLine, teacher } = studentLessonMetaParts(lesson);
  const lessonLink = lesson.assignment_id
    ? `/cabinet/student/lessons/${lesson.assignment_id}`
    : null;
  const materialsLink = lesson.assignment_id
    ? `/cabinet/student/lessons/${lesson.assignment_id}`
    : "/cabinet/student/materials";
  const canOpenCard = lesson.kind === "schedule" && lesson.id;
  const meetingHref = lessonMeetingHref(lesson);
  const dayLabel = formatDayLabel(lesson.starts_at);
  const timeRange = formatLessonTimeRange(lesson.starts_at, lesson.ends_at);
  const countdown = !inProgress ? formatCountdownTo(lesson.starts_at) : "";
  const connectMinutes = Math.round(LESSON_CONNECT_BEFORE_MS / 60000);
  const endsSoon = inProgress && lesson.ends_at
    ? `до ${formatStudentTime(lesson.ends_at)}`
    : "";
  const hasMeeting = Boolean(
    lesson.meeting_url
    || lesson.video_meeting
    || lesson.videoMeeting
    || lesson.link,
  );
  const isOnline = hasMeeting || /онлайн/i.test(String(lesson.format || lesson.format_label || ""));
  const startMs = lesson.starts_at ? new Date(lesson.starts_at).getTime() : 0;
  const showRoomButton = hasMeeting && startMs && (
    inProgress || canConnect || startMs > now - LESSON_CONNECT_BEFORE_MS
  );
  const showReminder = isOnline && shouldRemindBeforeLesson(lesson.starts_at, now);
  const joinHref = canConnect ? meetingHref : "";

  let readiness = "Запланирован";
  if (inProgress) readiness = "Идёт сейчас";
  else if (canConnect) readiness = "Можно подключиться";
  else if (lesson.status === "completed" || lesson.status === "done") readiness = "Завершён";

  const openSchedule = (e) => {
    e?.stopPropagation?.();
    if (canOpenCard && onOpenSchedule) onOpenSchedule(lesson.id);
  };

  return (
    <article
      className={`st-next-lesson st-next-lesson--featured${canOpenCard ? " st-next-lesson--clickable" : ""}${inProgress ? " st-next-lesson--live" : ""}`}
      role={canOpenCard ? "button" : undefined}
      tabIndex={canOpenCard ? 0 : undefined}
      onClick={canOpenCard ? () => onOpenSchedule(lesson.id) : undefined}
      onKeyDown={canOpenCard ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenSchedule(lesson.id);
        }
      } : undefined}
    >
      <div className="st-next-lesson__main">
        <div className="st-next-lesson__label-row">
          {inProgress ? (
            <span className="st-lesson-live st-lesson-live--inline">
              <span className="st-lesson-live__dot" aria-hidden="true" />
              Идёт сейчас
            </span>
          ) : (
            <span className="st-next-lesson__ready">{readiness}</span>
          )}
          {countdown && !inProgress ? (
            <span className="st-next-lesson__countdown">{countdown}</span>
          ) : null}
        </div>

        <p className="st-next-lesson__when">
          {dayLabel}
          {timeRange ? `, ${timeRange}` : ""}
          {endsSoon ? ` · ${endsSoon}` : ""}
        </p>

        {subject ? <p className="st-next-lesson__subject">{subject}</p> : null}
        <h3 className="st-next-lesson__topic">
          {/^тема:/i.test(topic) ? topic : `Тема: ${topic}`}
        </h3>

        <ul className="st-next-lesson__facts">
          {teacher ? <li>Учитель: {teacher}</li> : null}
          {formatLine ? <li>Формат: {formatLine}</li> : null}
        </ul>
      </div>

      <div className="st-next-lesson__actions">
        {canConnect && meetingHref ? (
          <MeetingButton
            href={meetingHref}
            className="cb-btn cb-btn--primary"
            onClick={(e) => e.stopPropagation()}
          >
            Подключиться к уроку
          </MeetingButton>
        ) : showRoomButton ? (
          <button
            type="button"
            className="cb-btn cb-btn--outline st-next-lesson__locked"
            disabled
            title={`Комната откроется за ${connectMinutes} минут до урока`}
            onClick={(e) => e.stopPropagation()}
          >
            {inProgress
              ? "Ожидайте, пока учитель откроет комнату"
              : `Комната откроется за ${connectMinutes} минут до урока`}
          </button>
        ) : null}
        {isOnline && lesson.status !== "completed" && lesson.status !== "done" ? (
          <ConnectionCheckButton
            className="cb-btn cb-btn--outline"
            canJoin={Boolean(canConnect && joinHref)}
            joinHref={joinHref}
            joinLabel="Перейти в урок"
          />
        ) : null}
        <Link
          to={materialsLink}
          className={`cb-btn ${showRoomButton || (canConnect && meetingHref) || isOnline ? "cb-btn--outline" : "cb-btn--primary"}`}
          onClick={(e) => e.stopPropagation()}
        >
          Посмотреть материалы к уроку
        </Link>
        {lessonLink && lessonLink !== materialsLink ? (
          <Link to={lessonLink} className="st-next-lesson__soft-link" onClick={(e) => e.stopPropagation()}>
            Открыть карточку урока
          </Link>
        ) : null}
        {canOpenCard ? (
          <button type="button" className="st-next-lesson__soft-link" onClick={openSchedule}>
            Подробнее о занятии
          </button>
        ) : null}
        <LastCheckHint />
        {showReminder ? (
          <div className="cc-reminder" onClick={(e) => e.stopPropagation()}>
            <span>До урока меньше 10 минут. Рекомендуем проверить камеру и микрофон.</span>
          </div>
        ) : null}
      </div>

      <div className="st-next-lesson__icon" aria-hidden="true">
        <CabinetIcon name="lessons" />
      </div>
    </article>
  );
}
