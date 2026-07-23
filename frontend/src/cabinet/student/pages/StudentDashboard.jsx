import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CabinetIcon from "../../CabinetIcons";
import { fetchStudentDashboard } from "../../../utils/cabinetAuth";
import { loadStudentData } from "../studentData";
import StudentEventDetailPopover from "../StudentEventDetailPopover";
import {
  StudentPageShell,
  StudentStatusBadge,
  formatDueDate,
  formatLessonWhen,
  formatLessonTimeRange,
  formatStudentDate,
  formatStudentTime,
  studentLessonMeta,
  isInternalMeetingHref,
  lessonMeetingHref,
  useLessonConnectAvailable,
  useLessonInProgress,
} from "../StudentSectionUi";
import "../../styles/notifications-settings.css";

function DashBlock({ title, linkLabel, linkTo, children, className = "" }) {
  return (
    <section className={`st-home-block ${className}`.trim()}>
      <div className="st-home-block__head">
        <h2 className="st-home-block__title">{title}</h2>
        {linkLabel && linkTo ? (
          <Link to={linkTo} className="st-home-block__link">
            {linkLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function DashEmptyCard({ title, text }) {
  return (
    <div className="st-dash-empty">
      <p className="st-dash-empty__title">{title}</p>
      {text ? <p className="st-dash-empty__text">{text}</p> : null}
    </div>
  );
}

function NextLessonCard({ lesson, onOpenSchedule }) {
  const vmStatus = lesson.video_meeting?.status || lesson.videoMeeting?.status;
  const canConnect = useLessonConnectAvailable(lesson.starts_at, lesson.ends_at, vmStatus);
  const inProgress = useLessonInProgress(lesson.starts_at, lesson.ends_at);
  const topic = lesson.topic || lesson.title || "Индивидуальное занятие";
  const lessonLink = lesson.assignment_id
    ? `/cabinet/student/lessons/${lesson.assignment_id}`
    : "/cabinet/student/lessons";
  const canOpenCard = lesson.kind === "schedule" && lesson.id;

  return (
    <article
      className={`st-next-lesson${canOpenCard ? " st-next-lesson--clickable" : ""}${inProgress ? " st-next-lesson--live" : ""}`}
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
      <div className="st-next-lesson__icon" aria-hidden="true">
        <CabinetIcon name="lessons" />
      </div>
      <div className="st-next-lesson__body">
        {inProgress ? (
          <span className="st-lesson-live st-lesson-live--inline">
            <span className="st-lesson-live__dot" aria-hidden="true" />
            Идёт сейчас
          </span>
        ) : null}
        <h3 className="st-next-lesson__topic">{topic}</h3>
        <p className="st-next-lesson__when">
          {inProgress
            ? formatLessonTimeRange(lesson.starts_at, lesson.ends_at)
            : formatLessonWhen(lesson.starts_at)}
        </p>
        <p className="st-next-lesson__meta">
          {studentLessonMeta(lesson)}
        </p>
      </div>
      <div className="st-next-lesson__actions">
        {canConnect && lessonMeetingHref(lesson) ? (
          isInternalMeetingHref(lessonMeetingHref(lesson)) ? (
            <Link
              to={lessonMeetingHref(lesson)}
              className="cb-btn cb-btn--primary"
              onClick={(e) => e.stopPropagation()}
            >
              Подключиться
            </Link>
          ) : (
            <a
              href={lessonMeetingHref(lesson)}
              className="cb-btn cb-btn--primary"
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              Подключиться
            </a>
          )
        ) : null}
        <Link to={lessonLink} className="cb-btn cb-btn--outline" onClick={(e) => e.stopPropagation()}>
          Открыть урок
        </Link>
      </div>
    </article>
  );
}

function TodoCard({ item }) {
  const meta = [item.topic, item.due_at ? formatDueDate(item.due_at) : ""].filter(Boolean).join(" · ");

  return (
    <Link to={`/cabinet/student/assignments/${item.id}`} className="st-dash-todo-card">
      <div className="st-dash-todo-card__body">
        <h3 className="st-dash-todo-card__title">{item.title}</h3>
        {meta ? <p className="st-dash-todo-card__meta">{meta}</p> : null}
        <StudentStatusBadge status={item.status} label={item.status_label} />
      </div>
      <span className="cb-btn cb-btn--outline cb-btn--sm">Открыть</span>
    </Link>
  );
}

function MaterialCard({ item }) {
  const meta = [item.type_label, item.lesson_topic ? `к уроку «${item.lesson_topic}»` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="st-dash-material-card">
      <div className="st-dash-material-card__icon" aria-hidden="true">
        <CabinetIcon name="folder" />
      </div>
      <div className="st-dash-material-card__body">
        <h3 className="st-dash-material-card__title">{item.title}</h3>
        {meta ? <p className="st-dash-material-card__meta">{meta}</p> : null}
      </div>
      <Link
        to={item.assignment_id ? `/cabinet/student/lessons/${item.assignment_id}` : "/cabinet/student/lessons"}
        className="cb-btn cb-btn--outline cb-btn--sm"
      >
        Открыть
      </Link>
    </article>
  );
}

function RecentLessonCard({ item }) {
  const extras = [];
  if (item.materials_count > 0) extras.push(`${item.materials_count} материала`);
  if (item.homework_title) extras.push("есть ДЗ");

  const link = item.assignment_id
    ? `/cabinet/student/lessons/${item.assignment_id}`
    : "/cabinet/student/lessons";

  return (
    <article className="st-dash-recent-card">
      <div className="st-dash-recent-card__body">
        <h3 className="st-dash-recent-card__title">{item.topic || "Занятие"}</h3>
        <p className="st-dash-recent-card__meta">
          {item.starts_at ? formatStudentDate(item.starts_at) : "—"}
          {extras.length ? ` · ${extras.join(" · ")}` : ""}
        </p>
      </div>
      <Link to={link} className="cb-btn cb-btn--outline cb-btn--sm">
        Открыть
      </Link>
    </article>
  );
}

export default function StudentDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState(null);
  const canConnectToNext = useLessonConnectAvailable(
    data?.next_lesson?.starts_at,
    data?.next_lesson?.ends_at,
    data?.next_lesson?.video_meeting?.status || data?.next_lesson?.videoMeeting?.status,
  );
  const nextLessonLive = useLessonInProgress(
    data?.next_lesson?.starts_at,
    data?.next_lesson?.ends_at,
  );

  useEffect(() => {
    loadStudentData(fetchStudentDashboard, "dashboard")
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <StudentPageShell>
        <div className="st-loading">Загрузка…</div>
      </StudentPageShell>
    );
  }

  const {
    summary,
    metrics,
    next_lesson,
    todo,
    recent_materials,
    recent_lessons,
    recent_results,
  } = data;

  const lessonsToday = summary?.lessons_today ?? 0;
  const assignmentsDue = summary?.assignments_due ?? 0;
  const todayLine = `Сегодня: ${lessonsToday} ${lessonsToday === 1 ? "занятие" : lessonsToday >= 2 && lessonsToday <= 4 ? "занятия" : "занятий"} · ${assignmentsDue} ${assignmentsDue === 1 ? "задание" : assignmentsDue >= 2 && assignmentsDue <= 4 ? "задания" : "заданий"}`;

  const hasProgress =
    (metrics?.lessons_completed ?? 0) > 0
    || (metrics?.assignments_done ?? 0) > 0
    || (metrics?.progress_percent ?? 0) > 0;

  const lastResult = recent_results?.[0];
  const nextMeetingHref = next_lesson ? lessonMeetingHref(next_lesson) : "";
  const heroCtaLink = canConnectToNext && nextMeetingHref
    ? nextMeetingHref
    : next_lesson?.assignment_id
      ? `/cabinet/student/lessons/${next_lesson.assignment_id}`
      : null;
  const heroUsesMeeting = Boolean(canConnectToNext && nextMeetingHref);

  return (
    <StudentPageShell className="st-dashboard">
      <section className="st-dash-hero">
        <div className="st-dash-hero__content">
          <h1 className="st-dash-hero__title">Привет, {data.greeting_name}!</h1>
          <p className="st-dash-hero__sub">{todayLine}</p>
          {heroCtaLink ? (
            heroUsesMeeting ? (
              isInternalMeetingHref(heroCtaLink) ? (
                <Link to={heroCtaLink} className="st-dash-hero__cta cb-btn cb-btn--white">
                  К занятию
                </Link>
              ) : (
                <a
                  href={heroCtaLink}
                  className="st-dash-hero__cta cb-btn cb-btn--white"
                  target="_blank"
                  rel="noreferrer"
                >
                  К занятию
                </a>
              )
            ) : (
              <Link to={heroCtaLink} className="st-dash-hero__cta cb-btn cb-btn--white">
                К материалам
              </Link>
            )
          ) : (
            <Link to="/cabinet/student/lessons" className="st-dash-hero__cta cb-btn cb-btn--white">
              Открыть материалы
            </Link>
          )}
        </div>
        {next_lesson?.starts_at ? (
          <div className={`st-dash-hero__chip${nextLessonLive ? " st-dash-hero__chip--live" : ""}`}>
            <span className="st-dash-hero__chip-label">
              {nextLessonLive ? "Сейчас идёт" : "Следующий урок"}
            </span>
            <strong>
              {nextLessonLive && next_lesson.ends_at
                ? `до ${formatStudentTime(next_lesson.ends_at)}`
                : formatLessonWhen(next_lesson.starts_at)}
            </strong>
          </div>
        ) : (
          <div className="st-dash-hero__decor" aria-hidden="true">
            <CabinetIcon name="lessons" />
          </div>
        )}
      </section>

      <div className="st-dash-grid">
        <DashBlock title="Следующее занятие" className="st-dash-grid__next">
          {next_lesson ? (
            <NextLessonCard lesson={next_lesson} onOpenSchedule={setSelectedEventId} />
          ) : (
            <DashEmptyCard
              title="Ближайших занятий нет"
              text="Когда учитель назначит занятие, оно появится здесь."
            />
          )}
        </DashBlock>

        <DashBlock
          title="Нужно выполнить"
          linkLabel="Все задания"
          linkTo="/cabinet/student/assignments"
          className="st-dash-grid__todo"
        >
          {todo?.length > 0 ? (
            <div className="st-dash-card-stack">
              {todo.slice(0, 3).map((item) => (
                <TodoCard key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </div>
          ) : (
            <DashEmptyCard
              title="Заданий пока нет"
              text="Когда учитель выдаст задание, оно появится здесь."
            />
          )}
        </DashBlock>

        <DashBlock title="Прогресс" className="st-dash-grid__progress">
          {!hasProgress ? (
            <p className="st-dash-soft-note">Прогресс появится после первых занятий и заданий.</p>
          ) : null}
          <div className="st-dash-metrics">
            <div className="st-dash-metric">
              <strong>{metrics?.lessons_completed ?? 0}</strong>
              <span>Уроков пройдено</span>
            </div>
            <div className="st-dash-metric">
              <strong>{metrics?.assignments_done ?? 0}</strong>
              <span>Заданий выполнено</span>
            </div>
            <div className="st-dash-metric st-dash-metric--accent">
              <strong>{metrics?.progress_percent ?? 0}%</strong>
              <span>Активность</span>
            </div>
          </div>
          {lastResult ? (
            <div className="st-dash-last-result">
              <span>Последний результат</span>
              <strong>
                {lastResult.title}
                {lastResult.score_percent != null ? ` · ${lastResult.score_percent}%` : ""}
              </strong>
            </div>
          ) : null}
        </DashBlock>

        <DashBlock title="Материалы" className="st-dash-grid__materials">
          {recent_materials?.length > 0 ? (
            <div className="st-dash-card-stack">
              {recent_materials.map((item) => (
                <MaterialCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <DashEmptyCard title="Материалов пока нет" />
          )}
        </DashBlock>

        <DashBlock
          title="Последние занятия"
          linkLabel="Все занятия"
          linkTo="/cabinet/student/lessons"
          className="st-dash-grid__recent"
        >
          {recent_lessons?.length > 0 ? (
            <div className="st-dash-card-stack">
              {recent_lessons.map((item) => (
                <RecentLessonCard key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </div>
          ) : (
            <DashEmptyCard title="Проведённых занятий пока нет" />
          )}
        </DashBlock>

        <section className="st-home-block st-dash-grid__quick">
          <h2 className="st-home-block__title">Быстрые действия</h2>
          <div className="st-dash-quick">
            <Link to="/cabinet/student/boards" className="st-dash-quick__item">
              <CabinetIcon name="board" />
              <span>Доски</span>
            </Link>
          </div>
        </section>
      </div>

      {selectedEventId ? (
        <StudentEventDetailPopover
          eventId={selectedEventId}
          onClose={() => setSelectedEventId(null)}
        />
      ) : null}
    </StudentPageShell>
  );
}
