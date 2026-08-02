import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchParentChildren, fetchParentJournal } from "../../utils/cabinetAuth";
import ParentChildSwitcher from "../parent/ParentChildSwitcher";
import { StudentErrorState, StudentPageShell } from "../student/StudentSectionUi";

export default function ParentResultsPage() {
  const [params, setParams] = useSearchParams();
  const studentId = params.get("student") ? Number(params.get("student")) : null;
  const entryType = params.get("type") || "";
  const [children, setChildren] = useState([]);
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchParentChildren().then((res) => {
      const list = res.children || [];
      setChildren(list);
      if (!studentId && list[0]?.student_id) {
        const p = new URLSearchParams(params);
        p.set("student", String(list[0].student_id));
        setParams(p, { replace: true });
      }
    }).catch((err) => setError(err.message));
  }, [studentId, params, setParams]);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const res = await fetchParentJournal({
        student_id: studentId,
        entry_type: entryType || undefined,
      });
      setEntries(res.entries || []);
      setSummary(res.summary || null);
      setHint(res.summary_hint || "");
      setError("");
    } catch (err) {
      setError(err.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [studentId, entryType]);

  useEffect(() => { void load(); }, [load]);

  const setType = (type) => {
    const p = new URLSearchParams(params);
    if (type) p.set("type", type);
    else p.delete("type");
    setParams(p);
  };

  return (
    <StudentPageShell>
      <ParentChildSwitcher
        kids={children}
        activeId={studentId}
        onChange={(id) => {
          const p = new URLSearchParams(params);
          p.set("student", String(id));
          setParams(p);
        }}
      />
      <div className="st-filters">
        {[
          ["", "Все"],
          ["homework", "ДЗ"],
          ["lesson", "Уроки"],
        ].map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            className={`st-filter-pill${entryType === value ? " st-filter-pill--active" : ""}`}
            onClick={() => setType(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {summary ? (
        <section className="st-home-block">
          <div className="st-home-block__head">
            <h2 className="st-home-block__title">Сводка по ДЗ</h2>
          </div>
          <p>
            Средний результат: {summary.homework_average_percent != null ? `${summary.homework_average_percent}%` : "—"}
          </p>
          <p className="st-muted">
            Выдано {summary.homework_assigned}, сдано {summary.homework_submitted},
            проверено {summary.homework_checked}, просрочено {summary.homework_overdue}
          </p>
          {hint ? <p className="st-muted">{hint}</p> : null}
        </section>
      ) : null}
      {loading ? <div className="st-loading">Загрузка…</div> : null}
      {error ? <StudentErrorState message={error} onRetry={load} /> : null}
      {!loading && !error && entries.length === 0 ? (
        <div className="st-empty">
          <h3 className="st-empty__title">Нет результатов</h3>
        </div>
      ) : null}
      <ul className="st-simple-list">
        {entries.map((item) => (
          <li key={item.id} className="st-list-card">
            <div className="st-list-card__row">
              <span className="st-status-badge">{item.badge || item.entry_type_label}</span>
              <strong>{item.title}</strong>
            </div>
            <p className="st-muted">
              {item.date || "—"}
              {item.score_percent != null ? ` · ${item.score_percent}%` : ""}
              {item.status_label || item.status ? ` · ${item.status_label || item.status}` : ""}
              {item.is_overdue ? " · просрочено" : ""}
            </p>
            {item.comment ? <p className="st-muted">{item.comment}</p> : null}
          </li>
        ))}
      </ul>
    </StudentPageShell>
  );
}
