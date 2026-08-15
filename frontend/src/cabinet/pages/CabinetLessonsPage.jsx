import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchScheduleEvents } from "../../utils/cabinetAuth";
import {
  CabinetPageShell,
  CabinetPageHeader,
  CabinetFilterBar,
  CabinetEmptyState,
  useSoonToast,
} from "../CabinetSectionUi";
import {
  eventLocalTimeRange,
  formatDayHeading,
  getLessonsFetchRange,
  groupSessionsByDate,
  isTeachableLessonEvent,
  sessionMatchesFilter,
  sessionStatusTone,
  sessionTypeLabel,
} from "../scheduleLessonUtils";

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "planned", label: "Запланированные" },
  { id: "done", label: "Проведённые" },
];

function statusBadgeTone(status) {
  if (status === "done") return "success";
  if (status === "draft") return "gray";
  return "info";
}

function SessionCard({ event, onOpen, onJoin }) {
  const tone = sessionStatusTone(event.status);

  return (
    <article className={`cb-schedule-card cb-schedule-card--${tone}`}>
      <div className="cb-schedule-card__accent" aria-hidden="true" />
      <div className="cb-schedule-card__main">
        <div className="cb-schedule-card__row">
          <span className="cb-schedule-card__time">
            {eventLocalTimeRange(event)}
          </span>
          <span className={`cb-status-badge cb-status-badge--${statusBadgeTone(event.status)}`}>
            {event.statusLabel || event.status}
          </span>
        </div>
        <h3 className="cb-schedule-card__title">{event.title}</h3>
        {event.topic ? (
          <p className="cb-schedule-card__topic">{event.topic}</p>
        ) : null}
        <p className="cb-schedule-card__meta">
          {sessionTypeLabel(event.type)}
          <span className="cb-schedule-card__dot">·</span>
          {event.audience || "Ученик не указан"}
          <span className="cb-schedule-card__dot">·</span>
          {event.format}
        </p>
      </div>
      <div className="cb-schedule-card__actions">
        {event.link && event.status === "planned" ? (
          <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={() => onJoin(event)}>
            Войти
          </button>
        ) : null}
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={() => onOpen(event)}>
          Открыть
        </button>
      </div>
    </article>
  );
}

export default function CabinetLessonsPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { notifySoon, toast } = useSoonToast();

  const loadSessions = useCallback(() => {
    setLoading(true);
    setError(null);
    const range = getLessonsFetchRange();
    fetchScheduleEvents(range)
      .then((data) => {
        if (!data?.ok) throw new Error(data?.error || "Не удалось загрузить уроки");
        const events = Array.isArray(data.events) ? data.events : [];
        setSessions(events.filter(isTeachableLessonEvent));
      })
      .catch((err) => {
        setSessions([]);
        setError(err?.message || "Ошибка загрузки");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const grouped = useMemo(() => {
    const filtered = sessions.filter((event) => sessionMatchesFilter(event, filter));
    return groupSessionsByDate(filtered);
  }, [sessions, filter]);

  const handleOpen = useCallback((event) => {
    navigate("/cabinet/schedule", { state: { openEventId: event.id } });
  }, [navigate]);

  const handleJoin = useCallback((event) => {
    if (event.link) {
      window.open(event.link, "_blank", "noopener,noreferrer");
      return;
    }
    notifySoon();
  }, [notifySoon]);

  return (
    <CabinetPageShell className="cb-section--lessons">
      {toast}
      <CabinetPageHeader
        title="Уроки"
        actions={[
          { label: "Запланировать", icon: "calendar", primary: true, href: "/cabinet/schedule" },
        ]}
      />
      <CabinetFilterBar filters={FILTERS} active={filter} onChange={setFilter} />

      {loading ? (
        <p className="cb-page-hint">Загрузка занятий…</p>
      ) : error ? (
        <CabinetEmptyState
          icon="lessons"
          title="Не удалось загрузить занятия"
          text={error}
          actions={[
            { label: "Повторить", primary: true, onClick: loadSessions },
          ]}
        />
      ) : grouped.length === 0 ? (
        <CabinetEmptyState
          icon="lessons"
          title="Занятий нет"
          text="Запланируйте урок в расписании."
          actions={[
            { label: "Расписание", primary: true, href: "/cabinet/schedule" },
          ]}
        />
      ) : (
        <div className="cb-lessons-sessions">
          {grouped.map(([dateKey, dayEvents]) => (
            <section key={dateKey} className="cb-lessons-day">
              <h2 className="cb-lessons-day__title">{formatDayHeading(new Date(`${dateKey}T12:00:00`))}</h2>
              <div className="cb-lessons-day__list">
                {dayEvents.map((event) => (
                  <SessionCard
                    key={event.id}
                    event={event}
                    onOpen={handleOpen}
                    onJoin={handleJoin}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

    </CabinetPageShell>
  );
}
