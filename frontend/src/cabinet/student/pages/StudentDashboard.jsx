import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStudentDashboard } from "../../../utils/cabinetAuth";
import StudentEventDetailPopover from "../StudentEventDetailPopover";
import { StudentErrorState, StudentPageShell } from "../StudentSectionUi";
import NextLessonCard from "../components/NextLessonCard";
import PendingHomeworkList from "../components/PendingHomeworkList";
import RecentMaterials from "../components/RecentMaterials";
import StudentDashboardHeader from "../components/StudentDashboardHeader";
import StudentDashboardSkeleton from "../components/StudentDashboardSkeleton";
import StudentProgressSummary from "../components/StudentProgressSummary";
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

export default function StudentDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEventId, setSelectedEventId] = useState(null);

  const load = () => {
    setLoading(true);
    setError("");
    fetchStudentDashboard()
      .then((payload) => setData(payload))
      .catch((err) => {
        setData(null);
        setError(err?.message || "Не удалось загрузить кабинет.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <StudentPageShell className="st-dashboard">
        <StudentDashboardSkeleton />
      </StudentPageShell>
    );
  }

  if (error || !data) {
    return (
      <StudentPageShell className="st-dashboard">
        <StudentErrorState message={error} onRetry={load} />
      </StudentPageShell>
    );
  }

  const {
    summary,
    metrics,
    next_lesson,
    todo,
    recent_materials,
    recent_results,
  } = data;

  const lessonsToday = summary?.lessons_today ?? 0;
  const assignmentsDue = summary?.assignments_due ?? (todo?.length ?? 0);
  const pending = (todo || []).filter((item) =>
    ["new", "in_progress", "overdue", "needs_fix"].includes(item.status),
  );

  const lastResult = recent_results?.[0];

  const hasProgress =
    (metrics?.lessons_completed ?? 0) > 0
    || (metrics?.assignments_done ?? 0) > 0
    || ((metrics?.average_score ?? 0) > 0)
    || Boolean(lastResult);

  return (
    <StudentPageShell className="st-dashboard">
      <StudentDashboardHeader
        name={data.greeting_name}
        lessonsToday={lessonsToday}
        assignmentsDue={assignmentsDue}
      />

      <div className="st-dash-grid">
        <DashBlock title="Ближайший урок" className="st-dash-grid__next">
          {next_lesson ? (
            <NextLessonCard lesson={next_lesson} onOpenSchedule={setSelectedEventId} />
          ) : (
            <div className="st-dash-empty st-dash-empty--lesson">
              <p className="st-dash-empty__title">Ближайшие уроки пока не запланированы</p>
              <p className="st-dash-empty__text">
                Когда учитель назначит занятие, здесь появятся дата, тема и кнопка входа в комнату.
              </p>
              <Link to="/cabinet/student/lessons" className="st-home-block__link">
                Открыть расписание
              </Link>
            </div>
          )}
        </DashBlock>

        <DashBlock
          title="Невыполненные задания"
          linkLabel="Все домашние задания"
          linkTo="/cabinet/student/assignments"
          className="st-dash-grid__todo"
        >
          <PendingHomeworkList
            items={pending}
            emptyTitle={todo?.length ? "Все срочные задания выполнены" : "Домашних заданий пока нет"}
            emptyText={
              todo?.length
                ? "Можно посмотреть материалы или подготовиться к следующему уроку."
                : "Когда учитель выдаст задание, оно появится здесь."
            }
          />
        </DashBlock>

        <DashBlock title="Прогресс" className="st-dash-grid__progress">
          <StudentProgressSummary
            metrics={metrics}
            lastResult={lastResult}
            hasData={hasProgress}
          />
        </DashBlock>

        <DashBlock
          title="Последние материалы"
          linkLabel="Все материалы"
          linkTo="/cabinet/student/materials"
          className="st-dash-grid__materials"
        >
          <RecentMaterials items={recent_materials || []} />
        </DashBlock>
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
