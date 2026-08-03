import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchStudentResultDetail, fetchStudentResults } from "../../../utils/cabinetAuth";
import { usePageTitle } from "../../hooks/usePageTitle";
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

const PREV_HW_STATUS_RU = {
  full: "Выполнено полностью",
  partial: "Выполнено частично",
  not_done: "Не выполнено",
  not_assigned: "Не было задано",
  not_reviewed: "Не проверено",
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

function VariantResultBlock({ result, titleFallback = "Вариант на уроке" }) {
  const tasks = Array.isArray(result?.tasks) ? result.tasks : [];
  if (!result || (!tasks.length && result.score_percent == null)) return null;
  return (
    <div className="jl-variant-result">
      <div className="jl-variant-result__head">
        <strong>{result.title || titleFallback}</strong>
        {result.score_percent != null ? (
          <span>
            {result.correct_count ?? 0}/
            {result.checked_count ?? tasks.length}
            {" · "}
            {formatScore(result.score_percent)}
          </span>
        ) : null}
      </div>
      {tasks.length ? (
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
              {tasks.map((task) => (
                <tr key={`${result.title || "v"}-${task.id || task.number}`}>
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
      ) : null}
    </div>
  );
}

function HomeworkResultBlock({ result }) {
  if (!result) return null;
  const tasks = Array.isArray(result.tasks) ? result.tasks : [];
  const scoreLabel = formatScore(result.score_percent);
  const hasBody =
    tasks.length > 0
    || Boolean(String(result.answer_text || "").trim())
    || Boolean(result.has_attached_file)
    || Boolean(String(result.teacher_comment || "").trim())
    || result.score_percent != null
    || Boolean(result.status_label);
  if (!hasBody) return null;
  return (
    <div className="jl-variant-result">
      <div className="jl-variant-result__head">
        <strong>{result.title || "Домашнее задание"}</strong>
        <span>
          {result.status_label || ""}
          {scoreLabel
            ? `${result.status_label ? " · " : ""}${
              result.correct_count != null && result.checked_count != null
                ? `${result.correct_count}/${result.checked_count} · `
                : ""
            }${scoreLabel}`
            : ""}
        </span>
      </div>
      {tasks.length ? (
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
              {tasks.map((task) => (
                <tr key={`hw-${result.homework_id}-${task.id || task.number}`}>
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
      ) : null}
      {String(result.answer_text || "").trim() ? (
        <p className="jl-hw-result-note">
          <strong>Ваш ответ:</strong> {result.answer_text}
        </p>
      ) : null}
      {result.has_attached_file ? (
        <p className="jl-hw-result-note">Вы прикрепили файл</p>
      ) : null}
      {String(result.teacher_comment || "").trim() ? (
        <p className="jl-hw-result-note">
          <strong>Комментарий к ДЗ:</strong> {result.teacher_comment}
        </p>
      ) : null}
    </div>
  );
}

export default function StudentResultsPage() {
  const { recordId } = useParams();
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  usePageTitle(recordId ? "Итоги урока" : "Мои результаты");

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
    const prevHwLabel = PREV_HW_STATUS_RU[detail.previous_homework_status] || "";
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
              <strong>Результат урока:</strong> {formatScore(detail.overall_score)}
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
          {prevHwLabel ? (
            <p>
              <strong>Домашнее задание (статус):</strong> {prevHwLabel}
            </p>
          ) : null}
          <VariantResultBlock result={detail.variant_result} />
          <HomeworkResultBlock result={detail.homework_result} />
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
      <p className="jl-page__sub">Опубликованные итоги уроков, вариант и домашние задания</p>
      {!items.length ? (
        <p className="jl-state">Пока нет опубликованных результатов</p>
      ) : (
        <div className="jl-results-list">
          {items.map((item) => {
            const timeRange = formatLessonTimeRange(item);
            const hw = item.homework_result;
            const hwScore = formatScore(hw?.score_percent);
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
                  {item.overall_score != null ? ` · урок ${formatScore(item.overall_score)}` : ""}
                  {hwScore ? ` · ДЗ ${hwScore}` : hw?.status_label ? ` · ДЗ: ${hw.status_label}` : ""}
                </p>
                {item.teacher_comment ? <p>{item.teacher_comment}</p> : null}
                {hw?.title ? (
                  <p className="jl-hw-result-note">
                    ДЗ: {hw.title}
                    {hw.status_label ? ` · ${hw.status_label}` : ""}
                  </p>
                ) : null}
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
