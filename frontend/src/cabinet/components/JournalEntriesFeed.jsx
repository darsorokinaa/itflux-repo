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
        <h2>Все записи</h2>
        <p className="jg-entries__hint">Уроки и домашние задания в одной ленте. ДЗ берутся из сдач, без дублирования оценок.</p>
      </div>

      <div className="jg-entries__filters">
        <select
          value={filters.entry_type}
          onChange={(e) => setFilters((f) => ({ ...f, entry_type: e.target.value, homework_only: false }))}
        >
          <option value="">Все типы</option>
          <option value="lesson">Урок</option>
          <option value="homework">ДЗ</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={filters.homework_only}
            onChange={(e) => setFilters((f) => ({ ...f, homework_only: e.target.checked, entry_type: e.target.checked ? "homework" : f.entry_type }))}
          />
          Только ДЗ
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.overdue}
            onChange={(e) => setFilters((f) => ({ ...f, overdue: e.target.checked }))}
          />
          Просрочено
        </label>
        <select
          value={filters.reviewed}
          onChange={(e) => setFilters((f) => ({ ...f, reviewed: e.target.value }))}
        >
          <option value="">Проверка: все</option>
          <option value="yes">Проверено</option>
          <option value="no">Не проверено</option>
        </select>
      </div>

      {summary ? (
        <div className="jg-entries__summary">
          <span>Средний % ДЗ: {summary.homework_average_percent ?? "—"}</span>
          <span>Выдано: {summary.homework_assigned}</span>
          <span>Сдано: {summary.homework_submitted}</span>
          <span>Проверено: {summary.homework_checked}</span>
          <span>На проверке: {summary.homework_pending_review}</span>
          <span>Просрочено: {summary.homework_overdue}</span>
          {hint ? <p className="jg-entries__hint">{hint}</p> : null}
        </div>
      ) : null}

      {loading ? <div className="jg-empty">Загрузка записей…</div> : null}
      {error ? <div className="jl-error">{error}</div> : null}

      <ul className="jg-entries__list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={`jg-entry-card jg-entry-card--${entry.entry_type}${entry.is_overdue ? " is-overdue" : ""}`}
              onClick={() => setSelected(entry)}
            >
              <span className="jg-entry-card__badge">{entry.badge || entry.entry_type_label}</span>
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
          <div className="jg-entry-drawer__panel">
            <header>
              <span className="jg-entry-card__badge">{selected.badge}</span>
              <h3>{selected.title}</h3>
              <button type="button" className="cb-btn cb-btn--outline" onClick={() => setSelected(null)}>Закрыть</button>
            </header>
            <p>{selected.student_name}</p>
            <p>Статус: {selected.status_label || selected.status}</p>
            {selected.score_percent != null ? <p>Результат: {selected.score_percent}%</p> : null}
            {selected.due_at ? <p>Срок: {new Date(selected.due_at).toLocaleString("ru-RU")}</p> : null}
            {selected.submitted_at ? <p>Сдано: {new Date(selected.submitted_at).toLocaleString("ru-RU")}</p> : null}
            {selected.comment ? <p>Комментарий: {selected.comment}</p> : null}
            {(selected.attempts || []).length ? (
              <div>
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
