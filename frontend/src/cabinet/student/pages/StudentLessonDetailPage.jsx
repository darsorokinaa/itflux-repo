import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  completeStudentLesson,
  fetchStudentLesson,
} from "../../../utils/cabinetAuth";
import {
  StudentPageHeader,
  StudentPageShell,
  StudentStatusBadge,
} from "../StudentSectionUi";

export default function StudentLessonDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

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
      setLesson((prev) => prev ? { ...prev, status: "completed", status_label: "Пройден", progress_percent: 100 } : prev);
    } catch { /* ignore */ }
    finally { setCompleting(false); }
  };

  if (loading) return <StudentPageShell><div className="st-loading">Загрузка…</div></StudentPageShell>;
  if (!lesson) return <StudentPageShell><p className="st-panel__empty">Урок не найден</p></StudentPageShell>;

  return (
    <StudentPageShell>
      <StudentPageHeader
        title={lesson.title}
        subtitle={`${lesson.direction || ""}${lesson.topic ? ` · ${lesson.topic}` : ""}`}
        actions={<StudentStatusBadge status={lesson.status} label={lesson.status_label} />}
      />

      {lesson.theory ? (
        <section className="st-detail-block">
          <h2>Теория</h2>
          <div className="st-detail-text">{lesson.theory}</div>
        </section>
      ) : null}

      {lesson.practice ? (
        <section className="st-detail-block">
          <h2>Практика</h2>
          <div className="st-detail-text">{lesson.practice}</div>
        </section>
      ) : null}

      {lesson.materials?.length ? (
        <section className="st-detail-block">
          <h2>Материалы</h2>
          <ul className="st-link-list">
            {lesson.materials.map((m) => (
              <li key={m.id}>{m.title} · {m.type_label}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {lesson.assignments?.length ? (
        <section className="st-detail-block">
          <h2>Задания</h2>
          <div className="st-link-list">
            {lesson.assignments.map((a) => (
              <Link key={a.id} to={`/cabinet/student/assignments/${a.id}`}>{a.title}</Link>
            ))}
          </div>
        </section>
      ) : null}

      {lesson.interactives?.length ? (
        <section className="st-detail-block">
          <h2>Интерактивы</h2>
          <div className="st-link-list">
            {lesson.interactives.map((ix) => (
              <Link key={ix.id} to={`/cabinet/student/interactives/${ix.id}/play`}>{ix.title}</Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="st-detail-actions">
        {lesson.status !== "completed" ? (
          <button type="button" className="cb-btn cb-btn--primary cb-btn--pill" onClick={handleComplete} disabled={completing}>
            Завершить урок
          </button>
        ) : null}
        <button type="button" className="cb-btn cb-btn--outline" onClick={() => navigate("/cabinet/student/lessons")}>
          К списку
        </button>
      </div>
    </StudentPageShell>
  );
}
