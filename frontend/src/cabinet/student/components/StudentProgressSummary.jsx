import { Link } from "react-router-dom";

export default function StudentProgressSummary({ metrics, lastResult, hasData }) {
  if (!hasData) {
    return (
      <div className="st-progress-summary st-progress-summary--empty">
        <p className="st-dash-empty__title">Данные появятся после первых выполненных заданий</p>
        <p className="st-dash-empty__text">
          Здесь будет видно, сколько заданий выполнено и как меняется результат.
        </p>
        <Link to="/cabinet/student/progress" className="st-home-block__link">
          Подробнее об успеваемости
        </Link>
      </div>
    );
  }

  const done = metrics?.assignments_done ?? 0;
  const lessons = metrics?.lessons_completed ?? 0;
  const avg = metrics?.average_score ?? metrics?.progress_percent;
  const hasAvg = avg != null && avg > 0;

  return (
    <div className="st-progress-summary">
      <div className="st-progress-summary__metrics">
        <div className="st-dash-metric">
          <strong>{done}</strong>
          <span>ДЗ выполнено</span>
        </div>
        <div className="st-dash-metric">
          <strong>{lessons}</strong>
          <span>Тем пройдено</span>
        </div>
        <div className={`st-dash-metric${hasAvg ? " st-dash-metric--accent" : ""}`}>
          <strong>{hasAvg ? `${Math.round(avg)}%` : "—"}</strong>
          <span>Средний результат</span>
        </div>
      </div>

      {lastResult ? (
        <div className="st-dash-last-result">
          <span>Последний результат</span>
          <strong>
            {lastResult.title}
            {lastResult.score_percent != null ? ` · ${Math.round(lastResult.score_percent)}%` : ""}
          </strong>
        </div>
      ) : null}

      <Link to="/cabinet/student/progress" className="st-home-block__link st-progress-summary__link">
        Подробнее об успеваемости
      </Link>
    </div>
  );
}
