import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  completeStudentLesson,
  fetchStudentLesson,
} from "../../../utils/cabinetAuth";
import {
  StudentPageShell,
  StudentStatusBadge,
} from "../StudentSectionUi";
import CabinetIcon from "../../CabinetIcons";
import { usePageTitle } from "../../hooks/usePageTitle";

const MATERIAL_ICONS = {
  lesson:       { icon: "lessons",   color: "blue"   },
  task_set:     { icon: "tasks",     color: "blue"   },
  worksheet:    { icon: "note",      color: "purple" },
  presentation: { icon: "plan",      color: "yellow" },
  methodic:     { icon: "book",      color: "green"  },
  link:         { icon: "arrow",     color: "blue"   },
  file:         { icon: "folder",    color: "yellow" },
};

function DetailItemCard({ icon, iconColor = "blue", title, subtitle, to, href, isClickable = true }) {
  const inner = (
    <>
      <span className={`st-ld-item__icon st-ld-item__icon--${iconColor}`} aria-hidden="true">
        <CabinetIcon name={icon} />
      </span>
      <span className="st-ld-item__body">
        <span className="st-ld-item__title">{title}</span>
        {subtitle ? <span className="st-ld-item__sub">{subtitle}</span> : null}
      </span>
      {(to || href) && (
        <span className="st-ld-item__arrow" aria-hidden="true">
          <CabinetIcon name="arrow" />
        </span>
      )}
    </>
  );

  if (to)   return <Link to={to} className="st-ld-item st-ld-item--link">{inner}</Link>;
  if (href) return <a href={href} target="_blank" rel="noreferrer" className="st-ld-item st-ld-item--link">{inner}</a>;
  return <div className="st-ld-item">{inner}</div>;
}

export default function StudentLessonDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  usePageTitle(lesson?.title || "Урок");

  useEffect(() => {
    fetchStudentLesson(id)
      .then(setLesson)
      .catch(() => setLesson(null))
      .finally(() => setLoading(false));
  }, [id]);

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await completeStudentLesson(id);
      setLesson((prev) =>
        prev ? { ...prev, status: "completed", status_label: "Пройден", progress_percent: 100 } : prev,
      );
    } catch { /* ignore */ }
    finally { setCompleting(false); }
  };

  if (loading) return <StudentPageShell><div className="st-loading">Загрузка…</div></StudentPageShell>;
  if (!lesson) return <StudentPageShell><p className="st-panel__empty">Урок не найден</p></StudentPageShell>;

  return (
    <StudentPageShell className="st-ld-page">

      {/* Back button */}
      <button type="button" className="st-ld-back" onClick={() => navigate("/cabinet/student/lessons")}>
        <CabinetIcon name="arrowLeft" />
        Все занятия
      </button>

      {/* Lesson header card */}
      <div className="st-ld-header">
        <div className="st-ld-header__icon" aria-hidden="true">
          <CabinetIcon name="lessons" />
        </div>
        <div className="st-ld-header__body">
          <h1 className="st-ld-header__title">{lesson.title}</h1>
          {(lesson.direction || lesson.topic) ? (
            <p className="st-ld-header__sub">
              {[lesson.direction, lesson.topic].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          <StudentStatusBadge status={lesson.status} label={lesson.status_label} />
        </div>
      </div>

      {/* Theory */}
      {lesson.theory ? (
        <section className="st-ld-section">
          <h2 className="st-ld-section__title">Теория</h2>
          <div className="st-ld-text">{lesson.theory}</div>
        </section>
      ) : null}

      {/* Practice */}
      {lesson.practice ? (
        <section className="st-ld-section">
          <h2 className="st-ld-section__title">Практика</h2>
          <div className="st-ld-text">{lesson.practice}</div>
        </section>
      ) : null}

      {/* Materials */}
      {lesson.materials?.length ? (
        <section className="st-ld-section">
          <h2 className="st-ld-section__title">Материалы</h2>
          <div className="st-ld-list">
            {lesson.materials.map((m) => {
              const { icon, color } = MATERIAL_ICONS[m.type] || { icon: "note", color: "blue" };
              const url = m.external_url || m.file_url || undefined;
              return (
                <DetailItemCard
                  key={m.id}
                  icon={icon}
                  iconColor={color}
                  title={m.title}
                  subtitle={m.type_label}
                  href={url}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Assignments */}
      {lesson.assignments?.length ? (
        <section className="st-ld-section">
          <h2 className="st-ld-section__title">Задания</h2>
          <div className="st-ld-list">
            {lesson.assignments.map((a) => (
              <DetailItemCard
                key={a.id}
                icon="check"
                iconColor="green"
                title={a.title}
                to={`/cabinet/student/assignments/${a.id}`}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Interactives */}
      {lesson.interactives?.length ? (
        <section className="st-ld-section">
          <h2 className="st-ld-section__title">Интерактивы</h2>
          <div className="st-ld-list">
            {lesson.interactives.map((ix) => (
              <DetailItemCard
                key={ix.id}
                icon="interactives"
                iconColor="purple"
                title={ix.title}
                to={`/cabinet/student/interactives/${ix.id}/play`}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Actions */}
      <div className="st-ld-actions">
        {lesson.status !== "completed" ? (
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            onClick={handleComplete}
            disabled={completing}
          >
            {completing ? "Сохраняем…" : "Завершить урок"}
          </button>
        ) : (
          <div className="st-ld-done">
            <CabinetIcon name="check" />
            Урок пройден
          </div>
        )}
        <button
          type="button"
          className="cb-btn cb-btn--outline"
          onClick={() => navigate("/cabinet/student/lessons")}
        >
          К списку занятий
        </button>
      </div>
    </StudentPageShell>
  );
}
