/**
 * Занятия — расписание ученика с темами из плана.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { fetchStudentMaterials, fetchStudentSchedule } from "../../../utils/cabinetAuth";
import { loadStudentData } from "../studentData";
import StudentEventDetailPopover from "../StudentEventDetailPopover";
import {
  StudentEmptyState,
  StudentFilterPills,
  StudentLoadingState,
  StudentPageShell,
  formatLessonWhen,
  formatLessonTimeRange,
  formatStudentDate,
  formatStudentTime,
  isLessonInProgress,
  studentLessonMeta,
  studentLessonMetaParts,
  isInternalMeetingHref,
  lessonMeetingHref,
  useLessonConnectAvailable,
  useLessonInProgress,
  useScheduleNow,
} from "../StudentSectionUi";

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "upcoming", label: "Ближайшие" },
  { id: "completed", label: "Проведённые" },
];

const UPCOMING_LIMIT = 5;
const SOON_MS = 3 * 24 * 60 * 60 * 1000;
const MATERIALS_PAGE_SIZE = 3;

function isToday(iso) {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

function isSoon(iso) {
  if (!iso) return false;
  const start = new Date(iso).getTime();
  const now = Date.now();
  return start - now <= SOON_MS && start > now;
}

function looksLikeBadTitle(value) {
  const text = (value || "").trim();
  return !text || /^\d+$/.test(text);
}

function lessonTopic(event) {
  const candidate = event.topic || event.title;
  if (!looksLikeBadTitle(candidate)) return candidate;
  return "Индивидуальное занятие";
}

function lessonMeta(event) {
  return studentLessonMeta(event);
}

function formatFeaturedWhen(iso) {
  if (!iso) return "Дата не указана";
  const time = formatStudentTime(iso);
  if (isToday(iso)) return `Сегодня в ${time}`;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (new Date(iso).toDateString() === tomorrow.toDateString()) return `Завтра в ${time}`;
  return `${formatStudentDate(iso)} · ${time}`;
}

function formatCompactWhen(iso) {
  if (!iso) return "—";
  return formatLessonWhen(iso);
}

function eventEndMs(event) {
  return lessonEndMs(event.starts_at, event.ends_at);
}

function lessonEndMs(startsAt, endsAt) {
  if (endsAt) return new Date(endsAt).getTime();
  if (startsAt) return new Date(startsAt).getTime();
  return 0;
}

function sortUpcomingEvents(events, now) {
  return [...events].sort((a, b) => {
    const aLive = isLessonInProgress(a.starts_at, a.ends_at, now);
    const bLive = isLessonInProgress(b.starts_at, b.ends_at, now);
    if (aLive !== bLive) return aLive ? -1 : 1;
    return new Date(a.starts_at) - new Date(b.starts_at);
  });
}

function LiveBadge({ className = "" }) {
  return (
    <span className={`st-lesson-live${className ? ` ${className}` : ""}`}>
      <span className="st-lesson-live__dot" aria-hidden="true" />
      Идёт
    </span>
  );
}

function MeetingConnectLink({ href, className, children, onClick }) {
  if (isInternalMeetingHref(href)) {
    return (
      <Link to={href} className={className} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} target="_blank" rel="noreferrer" onClick={onClick}>
      {children}
    </a>
  );
}

function FeaturedLessonCard({ event, onOpen }) {
  const vmStatus = event.video_meeting?.status || event.videoMeeting?.status;
  const canConnect = useLessonConnectAvailable(event.starts_at, event.ends_at, vmStatus);
  const inProgress = useLessonInProgress(event.starts_at, event.ends_at);
  const topic = lessonTopic(event);
  const { formatLine, teacher } = studentLessonMetaParts(event);
  const timeRange = formatLessonTimeRange(event.starts_at, event.ends_at);
  const meetingHref = lessonMeetingHref(event);
  const connectLabel = vmStatus === "live" || inProgress ? "Подключиться к уроку" : "Подключиться к уроку";

  return (
    <section className={`st-lessons-hero${inProgress ? " st-lessons-hero--live" : ""}`}>
      <div className="st-lessons-hero__content">
        <div className="st-lessons-hero__label-row">
          <p className="st-lessons-hero__label">
            {inProgress ? "Сейчас на занятии" : "Ближайшее занятие"}
          </p>
          {inProgress ? <LiveBadge className="st-lesson-live--hero" /> : null}
        </div>
        <h2 className="st-lessons-hero__topic">{topic}</h2>
        <p className="st-lessons-hero__when">
          {inProgress
            ? `Идёт · ${timeRange}`
            : formatFeaturedWhen(event.starts_at)}
        </p>
        {(formatLine || teacher) ? (
          <p className="st-lessons-hero__meta">
            {formatLine}
            {formatLine && teacher ? " · " : null}
            {teacher}
          </p>
        ) : null}
        <div className="st-lessons-hero__actions">
          {canConnect && meetingHref ? (
            <MeetingConnectLink
              href={meetingHref}
              className="st-lessons-hero__cta cb-btn cb-btn--white"
              onClick={(e) => e.stopPropagation()}
            >
              {connectLabel}
            </MeetingConnectLink>
          ) : (
            <button
              type="button"
              className="st-lessons-hero__cta cb-btn cb-btn--white"
              onClick={() => onOpen(event.id)}
            >
              Открыть урок
            </button>
          )}
          {canConnect && meetingHref ? (
            <button
              type="button"
              className="st-lessons-hero__cta-secondary"
              onClick={() => onOpen(event.id)}
            >
              Открыть урок
            </button>
          ) : null}
        </div>
      </div>
      {event.starts_at ? (
        <div className="st-lessons-hero__chip">
          <span className="st-lessons-hero__chip-label">
            {inProgress ? "До конца" : "Начало"}
          </span>
          <strong>
            {inProgress && event.ends_at
              ? formatStudentTime(event.ends_at)
              : formatStudentTime(event.starts_at)}
          </strong>
        </div>
      ) : null}
    </section>
  );
}

function SummaryChip({ label, value }) {
  return (
    <div className="st-lessons-summary__chip">
      <span className="st-lessons-summary__chip-value">{value}</span>
      <span className="st-lessons-summary__chip-label">{label}</span>
    </div>
  );
}

function CompactLessonCard({ event, onOpen }) {
  const vmStatus = event.video_meeting?.status || event.videoMeeting?.status;
  const canConnect = useLessonConnectAvailable(event.starts_at, event.ends_at, vmStatus);
  const inProgress = useLessonInProgress(event.starts_at, event.ends_at);
  const topic = lessonTopic(event);
  const { formatLine, teacher } = studentLessonMetaParts(event);
  const meetingHref = lessonMeetingHref(event);
  const showConnect = canConnect && meetingHref && (
    vmStatus === "live" || inProgress || isToday(event.starts_at) || isSoon(event.starts_at)
  );
  const todayClass = isToday(event.starts_at) || inProgress ? " st-lesson-compact__date--today" : "";

  return (
    <article
      className={`st-lesson-compact${inProgress ? " st-lesson-compact--live" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(event.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(event.id);
        }
      }}
    >
      <div className="st-lesson-compact__body">
        <div className="st-lesson-compact__head">
          <span className={`st-lesson-compact__date${todayClass}`}>
            {inProgress
              ? `Идёт · ${formatLessonTimeRange(event.starts_at, event.ends_at)}`
              : formatCompactWhen(event.starts_at)}
          </span>
          {inProgress ? <LiveBadge className="st-lesson-live--compact" /> : null}
        </div>
        <h3 className="st-lesson-compact__topic">{topic}</h3>
        {(formatLine || teacher) ? (
          <p className="st-lesson-compact__meta">
            {formatLine}
            {formatLine && teacher ? " · " : null}
            {teacher ? <span className="st-lesson-meta-muted">{teacher}</span> : null}
          </p>
        ) : null}
      </div>
      <div className="st-lesson-compact__actions">
        {showConnect ? (
          <MeetingConnectLink
            href={meetingHref}
            className="cb-btn cb-btn--outline cb-btn--sm st-lesson-compact__btn"
            onClick={(e) => e.stopPropagation()}
          >
            Подключиться
          </MeetingConnectLink>
        ) : (
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm st-lesson-compact__btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(event.id);
            }}
          >
            Открыть
          </button>
        )}
      </div>
    </article>
  );
}

function PastLessonCard({ event, onOpen }) {
  const topic = lessonTopic(event);

  return (
    <article
      className="st-lesson-past"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(event.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(event.id);
        }
      }}
    >
      <div className="st-lesson-past__body">
        <span className="st-lesson-past__date">
          {event.starts_at ? formatStudentDate(event.starts_at) : "—"}
        </span>
        <h3 className="st-lesson-past__topic">{topic}</h3>
        <p className="st-lesson-past__meta">{lessonMeta(event)}</p>
      </div>
      <button
        type="button"
        className="cb-btn cb-btn--outline cb-btn--sm"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(event.id);
        }}
      >
        Открыть
      </button>
    </article>
  );
}

function SidebarPanel({ title, children, className = "" }) {
  return (
    <section className={`st-lessons-panel ${className}`.trim()}>
      <h2 className="st-lessons-panel__title">{title}</h2>
      {children}
    </section>
  );
}

function SidebarEmpty({ text, hint }) {
  return (
    <div className="st-lessons-panel__empty">
      <p className="st-lessons-panel__empty-title">{text}</p>
      {hint ? <p className="st-lessons-panel__empty-hint">{hint}</p> : null}
    </div>
  );
}

function MaterialSidebarRow({ item }) {
  const href = item.external_url || item.file_url || "";
  const external = Boolean(item.external_url);
  const meta = [item.type_label, item.lesson_topic ? `к уроку «${item.lesson_topic}»` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="st-lessons-material">
      <div className="st-lessons-material__body">
        <h3 className="st-lessons-material__title">{item.title}</h3>
        {meta ? <p className="st-lessons-material__meta">{meta}</p> : null}
      </div>
      {href ? (
        <a
          href={href}
          className="cb-btn cb-btn--outline cb-btn--sm st-lessons-material__btn"
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer" : undefined}
        >
          Открыть
        </a>
      ) : item.assignment_id ? (
        <Link
          to={`/cabinet/student/lessons/${item.assignment_id}`}
          className="cb-btn cb-btn--outline cb-btn--sm st-lessons-material__btn"
        >
          Открыть
        </Link>
      ) : null}
    </article>
  );
}

function LessonMaterialsPanel({ materials }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(materials.length / MATERIALS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = materials.slice(
    safePage * MATERIALS_PAGE_SIZE,
    safePage * MATERIALS_PAGE_SIZE + MATERIALS_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(0);
  }, [materials.length]);

  if (!materials.length) {
    return (
      <SidebarEmpty
        text="Материалы появятся после урока"
        hint="Откройте проведённое занятие, чтобы посмотреть материалы и ДЗ."
      />
    );
  }

  return (
    <div className="st-lessons-materials">
      <div className="st-lessons-materials__list">
        {pageItems.map((item) => (
          <MaterialSidebarRow key={item.id} item={item} />
        ))}
      </div>
      {totalPages > 1 ? (
        <nav className="st-lessons-materials__pager" aria-label="Страницы материалов">
          <button
            type="button"
            className="st-lessons-materials__nav"
            disabled={safePage === 0}
            aria-label="Предыдущая страница"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ←
          </button>
          <div className="st-lessons-materials__dots" role="tablist" aria-label="Номер страницы">
            {Array.from({ length: totalPages }, (_, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={index === safePage}
                aria-label={`Страница ${index + 1}`}
                className={`st-lessons-materials__dot${index === safePage ? " st-lessons-materials__dot--active" : ""}`}
                onClick={() => setPage(index)}
              />
            ))}
          </div>
          <button
            type="button"
            className="st-lessons-materials__nav"
            disabled={safePage >= totalPages - 1}
            aria-label="Следующая страница"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            →
          </button>
        </nav>
      ) : null}
    </div>
  );
}

function LessonsSidebar({ todayCount, nextToday, liveToday, past, materials, onOpenEvent }) {
  const pastPreview = past.slice(0, 3);

  return (
    <aside className="st-lessons-sidebar">
      <SidebarPanel title="Сегодня">
        {todayCount > 0 ? (
          <div className="st-lessons-today">
            {liveToday ? (
              <div className="st-lessons-today__live">
                <LiveBadge />
                <span>{lessonTopic(liveToday)}</span>
              </div>
            ) : null}
            <p className="st-lessons-today__count">
              {todayCount} {todayCount === 1 ? "занятие" : todayCount < 5 ? "занятия" : "занятий"}
            </p>
            {nextToday?.starts_at && !liveToday ? (
              <p className="st-lessons-today__next">
                Ближайшее в {formatStudentTime(nextToday.starts_at)}
              </p>
            ) : null}
            {liveToday?.ends_at ? (
              <p className="st-lessons-today__next">
                До {formatStudentTime(liveToday.ends_at)}
              </p>
            ) : null}
          </div>
        ) : (
          <SidebarEmpty text="Сегодня занятий нет" />
        )}
      </SidebarPanel>

      <SidebarPanel title="Проведённые">
        {pastPreview.length > 0 ? (
          <div className="st-lessons-panel__list">
            {pastPreview.map((event) => (
              <PastLessonCard key={event.id} event={event} onOpen={onOpenEvent} />
            ))}
          </div>
        ) : (
          <SidebarEmpty
            text="Проведённых занятий пока нет"
            hint="После урока здесь появятся материалы и домашние задания."
          />
        )}
      </SidebarPanel>

      <SidebarPanel title="Материалы после занятий">
        <LessonMaterialsPanel materials={materials} />
      </SidebarPanel>
    </aside>
  );
}

function UpcomingMain({ featured, rest, onOpenEvent }) {
  return (
    <div className="st-lessons-main">
      {featured ? <FeaturedLessonCard event={featured} onOpen={onOpenEvent} /> : null}
      {rest.length > 0 ? (
        <section className="st-lessons-block">
          <h2 className="st-lessons-block__title">Дальше</h2>
          <div className="st-lesson-compact-list">
            {rest.map((event) => (
              <CompactLessonCard key={event.id} event={event} onOpen={onOpenEvent} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function StudentLessonsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [schedule, setSchedule] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState(null);

  useEffect(() => {
    Promise.all([
      loadStudentData(fetchStudentSchedule, "schedule"),
      loadStudentData(fetchStudentMaterials, "materials"),
    ])
      .then(([scheduleData, materialsData]) => {
        setSchedule(scheduleData?.items || []);
        setMaterials(materialsData?.items || []);
      })
      .finally(() => setLoading(false));
  }, []);

  // Deep-link /cabinet/student/lessons?event=<id> — из уведомлений
  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(location.search || "");
    const eventParam = params.get("event");
    if (!eventParam) return;
    setSelectedEventId(Number(eventParam) || eventParam);
    params.delete("event");
    const next = params.toString();
    navigate(`${location.pathname}${next ? `?${next}` : ""}`, { replace: true });
  }, [loading, location.search, location.pathname, navigate]);

  const now = useScheduleNow();

  const allUpcoming = useMemo(
    () => sortUpcomingEvents(
      schedule.filter((e) => eventEndMs(e) > now),
      now,
    ),
    [schedule, now],
  );

  const upcoming = useMemo(
    () => allUpcoming.slice(0, UPCOMING_LIMIT),
    [allUpcoming],
  );

  const past = useMemo(
    () => schedule
      .filter((e) => eventEndMs(e) <= now)
      .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)),
    [schedule, now],
  );

  const todayUpcoming = useMemo(
    () => allUpcoming.filter((e) => isToday(e.starts_at)),
    [allUpcoming],
  );

  const liveToday = useMemo(
    () => todayUpcoming.find((e) => isLessonInProgress(e.starts_at, e.ends_at, now)) || null,
    [todayUpcoming, now],
  );

  const featured = upcoming[0] || null;
  const upcomingRest = upcoming.slice(1);

  const showSidebar = filter === "all";
  const showUpcomingMain = filter === "all" || filter === "upcoming";
  const showCompletedMain = filter === "completed";

  const isEmpty = filter === "upcoming"
    ? upcoming.length === 0
    : filter === "completed"
      ? past.length === 0
      : upcoming.length === 0 && past.length === 0;

  return (
    <StudentPageShell className="st-lessons-page">
      <header className="st-lessons-summary">
        <div className="st-lessons-summary__head">
          <div>
            <h1 className="st-lessons-summary__title">Занятия</h1>
            <p className="st-lessons-summary__sub">Ближайшие и проведённые уроки</p>
          </div>
        </div>
        <div className="st-lessons-summary__chips">
          <SummaryChip label="Ближайших" value={upcoming.length} />
          <SummaryChip label="Сегодня" value={todayUpcoming.length} />
          {liveToday ? <SummaryChip label="Сейчас" value={1} /> : null}
          <SummaryChip label="Проведённых" value={past.length} />
        </div>
      </header>

      <StudentFilterPills filters={FILTERS} active={filter} onChange={setFilter} />

      {loading && <StudentLoadingState />}

      {!loading && isEmpty && (
        <StudentEmptyState
          icon={filter === "upcoming" ? "calendar" : "lessons"}
          title={
            filter === "upcoming"
              ? "Ближайших занятий нет"
              : filter === "completed"
                ? "Проведённых занятий нет"
                : "Занятий пока нет"
          }
          text="Когда учитель добавит занятие, оно появится здесь."
        />
      )}

      {!loading && !isEmpty && (
        <div className={`st-lessons-layout${showSidebar ? "" : " st-lessons-layout--single"}`}>
          {showUpcomingMain && upcoming.length > 0 ? (
            <UpcomingMain
              featured={featured}
              rest={upcomingRest}
              onOpenEvent={setSelectedEventId}
            />
          ) : null}

          {showUpcomingMain && filter === "all" && upcoming.length === 0 && past.length > 0 ? (
            <div className="st-lessons-main">
              <div className="st-lessons-panel st-lessons-panel--inline">
                <SidebarEmpty text="Ближайших занятий нет" hint="Следующее занятие появится в расписании." />
              </div>
            </div>
          ) : null}

          {showCompletedMain && past.length > 0 ? (
            <div className="st-lessons-main">
              <section className="st-lessons-block">
                <h2 className="st-lessons-block__title">Проведённые занятия</h2>
                <div className="st-lesson-compact-list">
                  {past.map((event) => (
                    <PastLessonCard key={event.id} event={event} onOpen={setSelectedEventId} />
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {showSidebar ? (
            <LessonsSidebar
              todayCount={todayUpcoming.length}
              nextToday={todayUpcoming.find((e) => !isLessonInProgress(e.starts_at, e.ends_at, now)) || featured}
              liveToday={liveToday}
              past={past}
              materials={materials}
              onOpenEvent={setSelectedEventId}
            />
          ) : null}
        </div>
      )}

      {selectedEventId ? (
        <StudentEventDetailPopover
          eventId={selectedEventId}
          onClose={() => setSelectedEventId(null)}
        />
      ) : null}
    </StudentPageShell>
  );
}
