import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchParentDashboard } from "../../utils/cabinetAuth";
import ParentChildSwitcher from "../parent/ParentChildSwitcher";
import {
  StudentErrorState,
  StudentPageShell,
  StudentStatusBadge,
} from "../student/StudentSectionUi";

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function studiesLine(child, summary) {
  if (summary?.studies_label) return summary.studies_label;
  const subjects = (child?.subjects || [])
    .map((s) => s.title || s.subject)
    .filter(Boolean);
  if (subjects.length) return subjects.join(", ");
  return child?.direction_label || "направление пока не указано";
}

export default function ParentDashboardPage() {
  const [params, setParams] = useSearchParams();
  const studentId = params.get("student") ? Number(params.get("student")) : null;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchParentDashboard(studentId ? { student_id: studentId } : {});
      setData(res);
      if (!studentId && res.active_child?.student_id) {
        const p = new URLSearchParams(params);
        p.set("student", String(res.active_child.student_id));
        setParams(p, { replace: true });
      }
    } catch (err) {
      setError(err.message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [studentId, params, setParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchChild = (id) => {
    const p = new URLSearchParams(params);
    p.set("student", String(id));
    setParams(p);
  };

  if (loading) {
    return (
      <StudentPageShell className="st-dashboard parent-home">
        <div className="st-loading">Загрузка…</div>
      </StudentPageShell>
    );
  }

  if (error) {
    return (
      <StudentPageShell className="st-dashboard parent-home">
        <StudentErrorState message={error} onRetry={load} />
      </StudentPageShell>
    );
  }

  if (!data?.children?.length) {
    return (
      <StudentPageShell className="st-dashboard parent-home">
        <div className="st-empty">
          <h3 className="st-empty__title">К вашему аккаунту пока не привязан ученик</h3>
          <p className="st-empty__text">
            Приглашение отправляет преподаватель из карточки ученика — блок «Родители и доступ».
          </p>
        </div>
      </StudentPageShell>
    );
  }

  const child = data.active_child;
  const summary = data.activity_summary || {};
  const next = data.next_lesson;
  const homework = data.homework_attention || [];
  const q = child?.student_id ? `?student=${child.student_id}` : "";
  const teacherName = summary.teacher_name || child?.teachers?.[0]?.name || "";
  const meta = [
    child?.grade ? `${child.grade} класс` : null,
    studiesLine(child, summary),
    teacherName ? `преп. ${teacherName}` : null,
  ].filter(Boolean);

  return (
    <StudentPageShell className="st-dashboard parent-home">
      <ParentChildSwitcher
        kids={data.children}
        activeId={child?.student_id}
        onChange={switchChild}
      />

      {child ? (
        <section className="parent-home__summary">
          <div className="parent-home__summary-main">
            <p className="parent-home__eyebrow">Ученик</p>
            <h1 className="parent-home__name">{child.name}</h1>
            <p className="parent-home__meta">{meta.join(" · ")}</p>
            {summary.focus_label ? (
              <p className="parent-home__focus">{summary.focus_label}</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="parent-home__card">
        <div className="parent-home__card-head">
          <h2 className="parent-home__card-title">Ближайший урок</h2>
          <Link to={`/cabinet/parent/schedule${q}`} className="parent-home__card-link">
            Расписание
          </Link>
        </div>
        {next ? (
          <div className="parent-home__lesson">
            <p className="parent-home__lesson-when">{formatWhen(next.starts_at)}</p>
            <p className="parent-home__lesson-topic">{next.topic || next.title || "Урок"}</p>
            <p className="parent-home__lesson-meta">
              {[
                next.subject_label,
                next.format_label,
                next.teacher_name,
              ]
                .filter(Boolean)
                .join(" · ") || "Занятие"}
            </p>
          </div>
        ) : (
          <p className="st-muted">Ближайших уроков пока нет</p>
        )}
      </section>

      <section className="parent-home__card">
        <div className="parent-home__card-head">
          <h2 className="parent-home__card-title">Сейчас в работе</h2>
          <Link to={`/cabinet/parent/homework${q}`} className="parent-home__card-link">
            Все задания
          </Link>
        </div>
        {homework.length === 0 ? (
          <p className="st-muted">Нет заданий, требующих внимания</p>
        ) : (
          <ul className="st-simple-list">
            {homework.slice(0, 3).map((hw) => (
              <li key={hw.homework_id} className="st-list-card">
                <div className="st-list-card__row">
                  <strong>{hw.title}</strong>
                  {hw.is_overdue ? <StudentStatusBadge status="overdue" label="Просрочено" /> : null}
                </div>
                <p className="st-muted">
                  {hw.status_label || hw.status}
                  {hw.due_at ? ` · до ${formatWhen(hw.due_at)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="parent-home__quick">
        <Link to={`/cabinet/parent/results${q}`} className="parent-home__quick-link">Результаты</Link>
        <Link to={`/cabinet/parent/billing${q}`} className="parent-home__quick-link">Оплата</Link>
      </div>
    </StudentPageShell>
  );
}
