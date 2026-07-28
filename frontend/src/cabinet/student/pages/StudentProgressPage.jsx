/**
 * Успеваемость — простая аналитика без сложных терминов.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchStudentProgress, fetchStudentResults } from "../../../utils/cabinetAuth";
import {
  StudentEmptyState,
  StudentErrorState,
  StudentLoadingState,
  StudentPageShell,
  formatStudentDate,
} from "../StudentSectionUi";

function insightForScore(score) {
  if (score == null) return null;
  if (score >= 85) return "Хорошо получается";
  if (score >= 70) return "Есть прогресс";
  if (score >= 50) return "Нужно повторить";
  return "Требуется больше практики";
}

function StatCard({ label, value, hint }) {
  return (
    <article className="st-progress-stat">
      <strong>{value}</strong>
      <span>{label}</span>
      {hint ? <em>{hint}</em> : null}
    </article>
  );
}

export default function StudentProgressPage() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([
      fetchStudentProgress(),
      fetchStudentResults().catch(() => ({ results: [] })),
    ])
      .then(([progressRes, resultsRes]) => {
        setProgress(progressRes || null);
        setResults(resultsRes?.results || resultsRes?.items || []);
      })
      .catch((err) => {
        setProgress(null);
        setResults([]);
        setError(err?.message || "Не удалось загрузить успеваемость.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <StudentPageShell className="st-progress-page">
        <StudentLoadingState />
      </StudentPageShell>
    );
  }

  if (error) {
    return (
      <StudentPageShell className="st-progress-page">
        <StudentErrorState message={error} onRetry={load} />
      </StudentPageShell>
    );
  }

  const lessonsDone = progress?.lessons_completed ?? 0;
  const hwDone = progress?.assignments_done ?? 0;
  const hwOpen = progress?.assignments_open ?? 0;
  const avg = progress?.average_score ?? 0;
  const hasData = lessonsDone > 0 || hwDone > 0 || avg > 0 || results.length > 0;

  const recentWithScores = results
    .map((r) => ({
      id: r.id || r.record_id || r.lesson_date,
      title: r.topic || r.title || r.lesson_topic || "Занятие",
      score: r.overall_score ?? r.homework_result?.score_percent ?? r.score_percent ?? r.score ?? null,
      date: r.lesson_date || r.starts_at || r.completed_at,
      comment: r.teacher_comment || r.comment || r.homework_result?.teacher_comment || "",
      subject: r.student_subject_label || r.subject || "",
    }))
    .filter((r) => r.score != null || r.comment)
    .slice(0, 8);

  const strong = recentWithScores.filter((r) => r.score != null && r.score >= 80).slice(0, 3);
  const weak = recentWithScores.filter((r) => r.score != null && r.score < 70).slice(0, 3);
  const comments = recentWithScores.filter((r) => r.comment).slice(0, 3);

  return (
    <StudentPageShell className="st-progress-page">
      {!hasData ? (
        <StudentEmptyState
          icon="chart"
          title="Данных об успеваемости пока нет"
          text="После первых выполненных заданий и занятий здесь появится понятная сводка результатов."
          actionLabel="К домашним заданиям"
          onAction={() => navigate("/cabinet/student/assignments")}
        />
      ) : (
        <>
          <section className="st-progress-overview">
            <h2 className="st-home-block__title">Общий прогресс</h2>
            <div className="st-progress-stats">
              <StatCard label="Пройдено тем" value={lessonsDone} />
              <StatCard label="Выполнено ДЗ" value={hwDone} />
              <StatCard
                label="Ещё нужно сдать"
                value={hwOpen}
                hint={hwOpen > 0 ? "Открытые задания" : "Всё сдано"}
              />
              <StatCard
                label="Средний результат"
                value={avg > 0 ? `${Math.round(avg)}%` : "—"}
                hint={insightForScore(avg > 0 ? avg : null)}
              />
            </div>
            {avg > 0 ? (
              <div className="st-progress-bar-wrap">
                <div className="st-progress-bar" role="progressbar" aria-valuenow={avg} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${Math.min(100, avg)}%` }} />
                </div>
                <p className="st-progress-bar-label">{insightForScore(avg)}</p>
              </div>
            ) : null}
          </section>

          <div className="st-progress-columns">
            <section className="st-home-block">
              <h2 className="st-home-block__title">Хорошо получается</h2>
              {strong.length ? (
                <ul className="st-progress-list">
                  {strong.map((item) => (
                    <li key={`s-${item.id}`}>
                      <strong>{item.title}</strong>
                      <span>{Math.round(item.score)}%</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="st-dash-soft-note">Пока мало данных — продолжайте выполнять задания.</p>
              )}
            </section>

            <section className="st-home-block">
              <h2 className="st-home-block__title">Нужно повторить</h2>
              {weak.length ? (
                <ul className="st-progress-list">
                  {weak.map((item) => (
                    <li key={`w-${item.id}`}>
                      <strong>{item.title}</strong>
                      <span>{Math.round(item.score)}%</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="st-dash-soft-note">Сложных тем по последним результатам не видно.</p>
              )}
            </section>
          </div>

          <section className="st-home-block">
            <div className="st-home-block__head">
              <h2 className="st-home-block__title">Последние результаты</h2>
              <Link to="/cabinet/student/results" className="st-home-block__link">
                Все результаты
              </Link>
            </div>
            {recentWithScores.length ? (
              <ul className="st-progress-recent">
                {recentWithScores.map((item) => (
                  <li key={`r-${item.id}`}>
                    <div>
                      <strong>{item.title}</strong>
                      <span>
                        {[item.subject, item.date ? formatStudentDate(item.date) : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {item.comment ? <em>«{item.comment}»</em> : null}
                    </div>
                    <div className="st-progress-recent__right">
                      {item.score != null ? <b>{Math.round(item.score)}%</b> : null}
                      {insightForScore(item.score) ? <small>{insightForScore(item.score)}</small> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="st-dash-soft-note">Оценки появятся после проверки работ учителем.</p>
            )}
          </section>

          {comments.length ? (
            <section className="st-home-block">
              <h2 className="st-home-block__title">Комментарии учителя</h2>
              <ul className="st-progress-comments">
                {comments.map((item) => (
                  <li key={`c-${item.id}`}>
                    <strong>{item.title}</strong>
                    <p>{item.comment}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </StudentPageShell>
  );
}
