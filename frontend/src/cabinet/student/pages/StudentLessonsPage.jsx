/**
 * Расписание — предстоящие уроки списком по датам и история занятий.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { fetchStudentSchedule } from "../../../utils/cabinetAuth";
import { loadStudentData } from "../studentData";
import StudentEventDetailPopover from "../StudentEventDetailPopover";
import {
  StudentEmptyState,
  StudentFilterPills,
  StudentLoadingState,
  StudentPageShell,
  StudentStatusBadge,
  formatLessonTimeRange,
  formatStudentDate,
  formatStudentTime,
  isLessonInProgress,
  lessonMeetingHref,
  studentLessonMetaParts,
  useLessonConnectAvailable,
  useLessonInProgress,
  useScheduleNow,
  LESSON_CONNECT_BEFORE_MS,
} from "../StudentSectionUi";
import ConnectionCheckButton from "../../connectionCheck/ConnectionCheckButton";
import { closeConnectionCheck } from "../../connectionCheck/openConnectionCheck";
import { usePageTitle } from "../../hooks/usePageTitle";
import { formatDayLabel } from "../studentDisplay";
import { resolveAuthenticatedMeetingNavigation } from "../../meetingNavigation";

const FILTERS = [
  { id: "upcoming", label: "Предстоящие" },
  { id: "history", label: "История уроков" },
];

function looksLikeBadTitle(value) {
  const text = (value || "").trim();
  return !text || /^\d+$/.test(text);
}

function lessonTopic(event) {
  const candidate = (event.topic || "").trim();
  if (candidate && !looksLikeBadTitle(candidate)) return candidate;
  return "Тема урока не указана";
}

function eventEndMs(event) {
  if (event.ends_at) return new Date(event.ends_at).getTime();
  if (event.starts_at) return new Date(event.starts_at).getTime();
  return 0;
}

function dateGroupKey(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function groupByDate(events) {
  const groups = [];
  const map = new Map();
  for (const event of events) {
    const key = dateGroupKey(event.starts_at);
    if (!map.has(key)) {
      const group = {
        key,
        label: formatDayLabel(event.starts_at) || formatStudentDate(event.starts_at) || "Дата не указана",
        events: [],
      };
      map.set(key, group);
      groups.push(group);
    }
    map.get(key).events.push(event);
  }
  return groups;
}

function MeetingConnectLink({ href, className, children, onClick }) {
  const handleClick = (event) => {
    closeConnectionCheck();
    onClick?.(event);
  };
  const nav = resolveAuthenticatedMeetingNavigation(href);
  if (nav.kind === "internal") {
    return (
      <Link to={nav.href} className={className} onClick={handleClick}>
        {children}
      </Link>
    );
  }
  if (nav.kind !== "external") return null;
  return (
    <a href={nav.href} className={className} target="_blank" rel="noreferrer" onClick={handleClick}>
      {children}
    </a>
  );
}

function lessonStatus(event, inProgress, canConnect) {
  if (inProgress) return { id: "live", label: "Идёт сейчас" };
  if (canConnect) return { id: "ready", label: "Можно подключиться" };
  if (event.status === "completed" || event.status === "done") {
    return { id: "done", label: event.status_label || "Завершён" };
  }
  return { id: "planned", label: event.status_label || "Запланирован" };
}

function ScheduleLessonRow({ event, onOpen, past = false, now }) {
  const vmStatus = event.video_meeting?.status || event.videoMeeting?.status;
  const canConnect = useLessonConnectAvailable(event.starts_at, event.ends_at, vmStatus);
  const inProgress = useLessonInProgress(event.starts_at, event.ends_at);
  const topic = lessonTopic(event);
  const subject = event.student_subject_label || "";
  const { formatLine, teacher } = studentLessonMetaParts(event);
  const timeRange = formatLessonTimeRange(event.starts_at, event.ends_at);
  const meetingHref = lessonMeetingHref(event);
  const materialsLink = event.assignment_id
    ? `/cabinet/student/lessons/${event.assignment_id}`
    : null;
  const status = lessonStatus(event, inProgress, canConnect && !past);
  const hasMeeting = Boolean(
    event.meeting_url
    || event.video_meeting
    || event.videoMeeting
    || event.link,
  );
  const startMs = event.starts_at ? new Date(event.starts_at).getTime() : 0;
  const showRoom = !past && hasMeeting && startMs && (
    inProgress || canConnect || startMs > now - LESSON_CONNECT_BEFORE_MS
  );
  const connectMinutes = Math.round(LESSON_CONNECT_BEFORE_MS / 60000);

  return (
    <article
      className={`st-schedule-row${inProgress ? " st-schedule-row--live" : ""}`}
    >
      <button
        type="button"
        className="st-schedule-row__main"
        onClick={() => onOpen(event.id)}
      >
        <div className="st-schedule-row__time">
          <strong>{event.starts_at ? formatStudentTime(event.starts_at) : "—"}</strong>
          {timeRange ? <span>{timeRange}</span> : null}
        </div>
        <div className="st-schedule-row__body">
          <div className="st-schedule-row__top">
            {subject ? <span className="st-schedule-row__subject">{subject}</span> : null}
            <StudentStatusBadge status={status.id} label={status.label} />
          </div>
          <h3 className="st-schedule-row__topic">{topic}</h3>
          <p className="st-schedule-row__meta">
            {[teacher ? `Учитель: ${teacher}` : "", formatLine].filter(Boolean).join(" · ")}
          </p>
        </div>
      </button>

      <div className="st-schedule-row__actions">
        {!past && canConnect && meetingHref ? (
          <MeetingConnectLink
            href={meetingHref}
            className="cb-btn cb-btn--primary cb-btn--sm"
            onClick={(e) => e.stopPropagation()}
          >
            Перейти в комнату
          </MeetingConnectLink>
        ) : null}
        {!past && showRoom && !(canConnect && meetingHref) ? (
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm"
            disabled
            title={`Комната откроется за ${connectMinutes} минут до урока`}
          >
            Комната скоро откроется
          </button>
        ) : null}
        {!past && (hasMeeting || /онлайн/i.test(String(event.format || event.format_label || ""))) ? (
          <ConnectionCheckButton
            className="cb-btn cb-btn--outline cb-btn--sm"
            canJoin={Boolean(canConnect && meetingHref)}
            joinHref={canConnect ? meetingHref : ""}
          />
        ) : null}
        {materialsLink ? (
          <Link
            to={materialsLink}
            className="cb-btn cb-btn--outline cb-btn--sm"
            onClick={(e) => e.stopPropagation()}
          >
            Материалы
          </Link>
        ) : (
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm"
            onClick={() => onOpen(event.id)}
          >
            Подробнее
          </button>
        )}
      </div>
    </article>
  );
}

function DateGroup({ group, onOpen, past = false, now }) {
  return (
    <section className="st-schedule-day">
      <h2 className="st-schedule-day__title">{group.label}</h2>
      <div className="st-schedule-day__list">
        {group.events.map((event) => (
          <ScheduleLessonRow
            key={event.id}
            event={event}
            onOpen={onOpen}
            past={past}
            now={now}
          />
        ))}
      </div>
    </section>
  );
}

export default function StudentLessonsPage() {
  usePageTitle("Расписание");
  const location = useLocation();
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState([]);
  const [filter, setFilter] = useState("upcoming");
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState(() => {
    try {
      const eventParam = new URLSearchParams(window.location.search).get("event");
      return eventParam ? (Number(eventParam) || eventParam) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    loadStudentData(fetchStudentSchedule, "schedule")
      .then((scheduleData) => {
        setSchedule(scheduleData?.items || []);
      })
      .finally(() => setLoading(false));
  }, []);

  // Снимаем ?event= из адресной строки после открытия карточки (из уведомлений)
  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    if (!params.has("event")) return;
    params.delete("event");
    const next = params.toString();
    navigate(`${location.pathname}${next ? `?${next}` : ""}`, { replace: true });
  }, [location.search, location.pathname, navigate]);

  const now = useScheduleNow();

  const upcoming = useMemo(
    () => schedule
      .filter((e) => eventEndMs(e) > now)
      .sort((a, b) => {
        const aLive = isLessonInProgress(a.starts_at, a.ends_at, now);
        const bLive = isLessonInProgress(b.starts_at, b.ends_at, now);
        if (aLive !== bLive) return aLive ? -1 : 1;
        return new Date(a.starts_at) - new Date(b.starts_at);
      }),
    [schedule, now],
  );

  const past = useMemo(
    () => schedule
      .filter((e) => eventEndMs(e) <= now)
      .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)),
    [schedule, now],
  );

  const upcomingGroups = useMemo(() => groupByDate(upcoming), [upcoming]);
  const pastGroups = useMemo(() => groupByDate(past), [past]);

  const isEmpty = filter === "upcoming" ? upcoming.length === 0 : past.length === 0;

  return (
    <StudentPageShell className="st-lessons-page">
      <header className="st-schedule-head">
        <h1 className="st-schedule-head__title">Расписание</h1>
        <p className="st-schedule-head__sub">Предстоящие уроки и история занятий</p>
      </header>

      <StudentFilterPills filters={FILTERS} active={filter} onChange={setFilter} />

      {loading && <StudentLoadingState />}

      {!loading && isEmpty && (
        <StudentEmptyState
          icon={filter === "upcoming" ? "calendar" : "lessons"}
          title={
            filter === "upcoming"
              ? "Ближайшие уроки пока не запланированы"
              : "История уроков пока пуста"
          }
          text={
            filter === "upcoming"
              ? "Когда учитель назначит занятие, оно появится здесь."
              : "После проведённых занятий здесь останутся темы и материалы."
          }
        />
      )}

      {!loading && !isEmpty && filter === "upcoming" ? (
        <div className="st-schedule-groups">
          {upcomingGroups.map((group) => (
            <DateGroup key={group.key} group={group} onOpen={setSelectedEventId} now={now} />
          ))}
        </div>
      ) : null}

      {!loading && !isEmpty && filter === "history" ? (
        <div className="st-schedule-groups">
          {pastGroups.map((group) => (
            <DateGroup key={group.key} group={group} onOpen={setSelectedEventId} past now={now} />
          ))}
        </div>
      ) : null}

      {selectedEventId ? (
        <StudentEventDetailPopover
          eventId={selectedEventId}
          onClose={() => setSelectedEventId(null)}
        />
      ) : null}
    </StudentPageShell>
  );
}
