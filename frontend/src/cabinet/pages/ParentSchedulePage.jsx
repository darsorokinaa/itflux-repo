import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchParentChildren, fetchParentSchedule } from "../../utils/cabinetAuth";
import ParentChildSwitcher from "../parent/ParentChildSwitcher";
import { StudentErrorState, StudentPageShell } from "../student/StudentSectionUi";

export default function ParentSchedulePage() {
  const [params, setParams] = useSearchParams();
  const studentId = params.get("student") ? Number(params.get("student")) : null;
  const [children, setChildren] = useState([]);
  const [items, setItems] = useState([]);
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
      const res = await fetchParentSchedule({ student_id: studentId });
      setItems(res.items || []);
      setError("");
    } catch (err) {
      setError(err.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <StudentPageShell className="st-lessons-page">
      <ParentChildSwitcher
        kids={children}
        activeId={studentId}
        onChange={(id) => {
          const p = new URLSearchParams(params);
          p.set("student", String(id));
          setParams(p);
        }}
      />
      {loading ? <div className="st-loading">Загрузка…</div> : null}
      {error ? <StudentErrorState message={error} onRetry={load} /> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="st-empty">
          <h3 className="st-empty__title">Нет занятий в расписании</h3>
        </div>
      ) : null}
      <ul className="st-simple-list">
        {items.map((ev) => (
          <li key={ev.id} className="st-list-card">
            <strong>{ev.title}</strong>
            <p className="st-muted">
              {ev.starts_at ? new Date(ev.starts_at).toLocaleString("ru-RU") : "—"}
              {ev.status ? ` · ${ev.status}` : ""}
              {ev.format ? ` · ${ev.format}` : ""}
            </p>
            <p className="st-muted">Вход в видеоурок для родителя недоступен</p>
          </li>
        ))}
      </ul>
    </StudentPageShell>
  );
}
