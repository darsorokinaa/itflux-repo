import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchStudentResultDetail, fetchStudentResults } from "../../../utils/cabinetAuth";
import "../../styles/journal.css";

const ATTENDANCE_RU = {
  present: "Присутствовал",
  late: "Опоздал",
  left_early: "Ушёл раньше",
  partial: "Часть урока",
  absent_excused: "Отсутствовал (уваж.)",
  absent_unexcused: "Отсутствовал",
  cancelled_by_student: "Отменено",
  cancelled_by_teacher: "Отменено учителем",
  technical_issue: "Техническая причина",
  not_marked: "—",
};

function formatLessonDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function formatLessonTimeRange(item) {
  const start = formatClock(item?.starts_at);
  const end = formatClock(item?.ends_at);
  if (start && end) return `${start}–${end}`;
  return start || "";
}

function formatScore(score) {
  if (score == null) return null;
  return Number(score) === Number.parseInt(score, 10)
    ? `${Number.parseInt(score, 10)}%`
    : `${Number(score).toFixed(1)}%`;
}

function DetailBlock({ label, value }) {
  const text = String(value || "").trim();
  if (!text) return null;
  return (
    <p>
      <strong>{label}:</strong> {text}
    </p>
  );
}

export default function StudentResultsPage() {
  const { recordId } = useParams();
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (recordId) {
          const data = await fetchStudentResultDetail(recordId);
          if (!cancelled) setDetail(data);
        } else {
          const data = await fetchStudentResults();
          if (!cancelled) setItems(data.results || []);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || "Не удалось загрузить результаты");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  if (loading) {
    return (
      <div className="jl-page">
        <p className="jl-state">Загрузка…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="jl-page">
        <div className="jl-error">{error}</div>
      </div>
    );
  }

  if (detail) {
    const timeRange = formatLessonTimeRange(detail);
    return (
      <div className="jl-page">
        <Link className="jl-btn jl-btn--ghost" to="/cabinet/student/results">
          ← Все результаты
        </Link>
        <h1 className="jl-page__title">Итоги урока</h1>
        <p className="jl-page__sub">
          {formatLessonDate(detail.lesson_date)}
          {timeRange ? ` · ${timeRange}` : ""}
          {" · "}
          {detail.topic || "Без темы"}
        </p>
        <article className="jl-result-card">
          <p>
            <strong>Посещаемость:</strong>{" "}
            {ATTENDANCE_RU[detail.attendance_status] || detail.attendance_status}
          </p>
          {detail.overall_score != null ? (
            <p>
              <strong>Результат:</strong> {formatScore(detail.overall_score)}
            </p>
          ) : null}
          {(detail.criterion_scores || []).length ? (
            <div>
              <strong>Критерии:</strong>
              <ul>
                {detail.criterion_scores.map((s) => (
                  <li key={s.criterion_id}>
                    {s.criterion_title}:{" "}
                    {s.is_not_applicable ? "Не оценивалось" : s.value ?? "—"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <DetailBlock label="Итог урока" value={detail.lesson_summary} />
          <DetailBlock label="Комментарий учителя" value={detail.teacher_comment} />
          <DetailBlock label="Рекомендация" value={detail.recommendation || detail.recommendations} />
          <DetailBlock label="Сильные стороны" value={detail.strengths} />
          <DetailBlock label="Пройденный материал" value={detail.material_covered} />
          <DetailBlock label="Повторить" value={detail.material_to_repeat} />
          <DetailBlock label="План на следующий урок" value={detail.next_lesson_plan} />
          {(detail.variant_result?.tasks || []).length ? (
            <div className="jl-variant-result">
              <div className="jl-variant-result__head">
                <strong>{detail.variant_result.title || "Вариант на уроке"}</strong>
                {detail.variant_result.score_percent != null ? (
                  <span>
                    {detail.variant_result.correct_count ?? 0}/
                    {detail.variant_result.checked_count ?? detail.variant_result.tasks.length}
                    {" · "}
                    {formatScore(detail.variant_result.score_percent)}
                  </span>
                ) : null}
              </div>
              <div className="jl-variant-result__table-wrap">
                <table className="jl-variant-result__table">
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Ваш ответ</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.variant_result.tasks.map((task) => (
                      <tr key={`${detail.id}-${task.id || task.number}`}>
                        <td>{task.number ?? "—"}</td>
                        <td>{String(task.student_answer || "").trim() || "—"}</td>
                        <td>
                          {task.ok === true ? (
                            <span className="jl-variant-result__ok">верно</span>
                          ) : task.ok === false ? (
                            <span className="jl-variant-result__bad">ошибка</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {(detail.tags || []).length ? (
            <p>
              {(detail.tags || []).map((t) => t.title).join(" · ")}
            </p>
          ) : null}
        </article>
      </div>
    );
  }

  return (
    <div className="jl-page">
      <h1 className="jl-page__title">Мои результаты</h1>
      <p className="jl-page__sub">Опубликованные итоги уроков и комментарии учителя</p>
      {!items.length ? (
        <p className="jl-state">Пока нет опубликованных результатов</p>
      ) : (
        <div className="jl-results-list">
          {items.map((item) => {
            const timeRange = formatLessonTimeRange(item);
            return (
              <article key={item.id} className="jl-result-card">
                <h3>
                  {formatLessonDate(item.lesson_date)}
                  {timeRange ? ` · ${timeRange}` : ""}
                  {" · "}
                  {item.topic || "Урок"}
                </h3>
                <p>
                  {ATTENDANCE_RU[item.attendance_status] || item.attendance_status}
                  {item.overall_score != null ? ` · ${formatScore(item.overall_score)}` : ""}
                </p>
                {item.teacher_comment ? <p>{item.teacher_comment}</p> : null}
                <a
                  className="jl-btn jl-btn--secondary"
                  href={`/cabinet/student/results/${item.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Подробнее
                </a>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
