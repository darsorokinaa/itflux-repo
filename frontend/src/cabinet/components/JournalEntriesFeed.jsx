import { useEffect, useState } from "react";
import { fetchJournalEntries } from "../../utils/cabinetAuth";

export default function JournalEntriesFeed({ studentId, groupId }) {
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    entry_type: "",
    homework_only: false,
    overdue: false,
    reviewed: "",
  });
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!studentId && !groupId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchJournalEntries({
      student_id: studentId || undefined,
      group_id: groupId || undefined,
      entry_type: filters.entry_type || undefined,
      homework_only: filters.homework_only ? "1" : undefined,
      overdue: filters.overdue ? "1" : undefined,
      reviewed: filters.reviewed || undefined,
    })
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries || []);
        setSummary(data.summary || null);
        setHint(data.summary_hint || "");
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Ошибка загрузки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [studentId, groupId, filters]);

  return (
    <section className="jg-entries">
      <div className="jg-entries__head">
        <h2 className="jg-entries__title">Все записи</h2>
        <p className="jg-entries__lead">
          Уроки и домашние задания в одной ленте. ДЗ берутся из сдач, без дублирования оценок.
        </p>
      </div>

      <div className="jg-entries__filters">
        <select
          className="jg-entries__select"
          value={filters.entry_type}
          onChange={(e) => setFilters((f) => ({ ...f, entry_type: e.target.value, homework_only: false }))}
          aria-label="Тип записи"
        >
          <option value="">Все типы</option>
          <option value="lesson">Урок</option>
          <option value="homework">ДЗ</option>
        </select>
        <label className={`jg-entries__check${filters.homework_only ? " is-active" : ""}`}>
          <input
            type="checkbox"
            checked={filters.homework_only}
            onChange={(e) => setFilters((f) => ({
              ...f,
              homework_only: e.target.checked,
              entry_type: e.target.checked ? "homework" : f.entry_type,
            }))}
          />
          Только ДЗ
        </label>
        <label className={`jg-entries__check${filters.overdue ? " is-active" : ""}`}>
          <input
            type="checkbox"
            checked={filters.overdue}
            onChange={(e) => setFilters((f) => ({ ...f, overdue: e.target.checked }))}
          />
          Просрочено
        </label>
        <select
          className="jg-entries__select"
          value={filters.reviewed}
          onChange={(e) => setFilters((f) => ({ ...f, reviewed: e.target.value }))}
          aria-label="Статус проверки"
        >
          <option value="">Проверка: все</option>
          <option value="yes">Проверено</option>
          <option value="no">Не проверено</option>
        </select>
      </div>

      {summary ? (
        <div className="jg-entries__summary">
          <div className="jg-entries__stats">
            <span>
              <em>Средний % ДЗ</em>
              <strong>{summary.homework_average_percent ?? "—"}</strong>
            </span>
            <span>
              <em>Выдано</em>
              <strong>{summary.homework_assigned}</strong>
            </span>
            <span>
              <em>Сдано</em>
              <strong>{summary.homework_submitted}</strong>
            </span>
            <span>
              <em>Проверено</em>
              <strong>{summary.homework_checked}</strong>
            </span>
            <span>
              <em>На проверке</em>
              <strong>{summary.homework_pending_review}</strong>
            </span>
            <span>
              <em>Просрочено</em>
              <strong>{summary.homework_overdue}</strong>
            </span>
          </div>
          {hint ? <p className="jg-entries__hint">{hint}</p> : null}
        </div>
      ) : null}

      {loading ? <div className="jg-empty jg-empty--compact">Загрузка записей…</div> : null}
      {error ? <div className="jl-error">{error}</div> : null}

      {!loading && !error && !entries.length ? (
        <div className="jg-empty jg-empty--compact">Записей пока нет</div>
      ) : null}

      <ul className="jg-entries__list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={`jg-entry-card jg-entry-card--${entry.entry_type}${entry.is_overdue ? " is-overdue" : ""}`}
              onClick={() => setSelected(entry)}
            >
              <span className={`jg-entry-card__badge jg-entry-card__badge--${entry.entry_type}`}>
                {entry.badge || entry.entry_type_label}
              </span>
              <div className="jg-entry-card__body">
                <strong>{entry.title}</strong>
                <span>
                  {entry.student_name}
                  {entry.date ? ` · ${entry.date}` : ""}
                  {entry.score_percent != null ? ` · ${entry.score_percent}%` : ""}
                  {entry.status_label || entry.status ? ` · ${entry.status_label || entry.status}` : ""}
                  {entry.is_overdue ? " · просрочено" : ""}
                </span>
                {entry.comment ? <em>{entry.comment}</em> : null}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {selected ? (
        <div className="jg-entry-drawer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="jg-entry-drawer__backdrop"
            aria-label="Закрыть"
            onClick={() => setSelected(null)}
          />
          <div className="jg-entry-drawer__panel">
            <header className="jg-entry-drawer__header">
              <div className="jg-entry-drawer__heading">
                <span className={`jg-entry-card__badge jg-entry-card__badge--${selected.entry_type}`}>
                  {selected.badge}
                </span>
                <h3>{selected.title}</h3>
              </div>
              <button type="button" className="cb-btn cb-btn--outline" onClick={() => setSelected(null)}>
                Закрыть
              </button>
            </header>
            <div className="jg-entry-drawer__meta">
              <p>{selected.student_name}</p>
              <p>Статус: {selected.status_label || selected.status}</p>
              {selected.score_percent != null ? <p>Результат: {selected.score_percent}%</p> : null}
              {selected.due_at ? <p>Срок: {new Date(selected.due_at).toLocaleString("ru-RU")}</p> : null}
              {selected.submitted_at ? <p>Сдано: {new Date(selected.submitted_at).toLocaleString("ru-RU")}</p> : null}
              {selected.comment ? <p>Комментарий: {selected.comment}</p> : null}
            </div>
            {(selected.attempts || []).length ? (
              <div className="jg-entry-drawer__attempts">
                <h4>История попыток</h4>
                <ul>
                  {selected.attempts.map((a) => (
                    <li key={a.id}>
                      #{a.attempt_number}: {a.status}
                      {a.score != null ? ` · ${a.score}%` : ""}
                      {a.teacher_comment ? ` — ${a.teacher_comment}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {selected.review_url ? (
              <a className="cb-btn cb-btn--primary" href={selected.review_url}>Открыть проверку</a>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
