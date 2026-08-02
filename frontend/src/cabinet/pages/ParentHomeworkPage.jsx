import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchParentChildren, fetchParentHomework } from "../../utils/cabinetAuth";
import ParentChildSwitcher from "../parent/ParentChildSwitcher";
import {
  StudentErrorState,
  StudentPageShell,
  StudentStatusBadge,
} from "../student/StudentSectionUi";

const BUCKETS = [
  { id: "todo", label: "Нужно выполнить", match: (h) => ["not_submitted", "new", "in_progress", "overdue"].includes(h.status) || h.is_overdue },
  { id: "review", label: "На проверке", match: (h) => h.status === "submitted" },
  { id: "done", label: "Проверено", match: (h) => h.status === "checked" },
  { id: "fix", label: "На доработке", match: (h) => ["returned", "needs_revision"].includes(h.status) },
];

export default function ParentHomeworkPage() {
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
      const res = await fetchParentHomework({ student_id: studentId });
      setItems(res.items || []);
      setError("");
    } catch (err) {
      setError(err.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => (
    BUCKETS.map((b) => ({ ...b, items: items.filter(b.match) }))
  ), [items]);

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
      {loading ? <div className="st-loading">Загрузка…</div> : null}
      {error ? <StudentErrorState message={error} onRetry={load} /> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="st-empty">
          <h3 className="st-empty__title">Нет домашних заданий</h3>
        </div>
      ) : null}
      {grouped.map((bucket) => (
        bucket.items.length ? (
          <section key={bucket.id} className="st-home-block">
            <div className="st-home-block__head">
              <h2 className="st-home-block__title">{bucket.label}</h2>
            </div>
            <ul className="st-simple-list">
              {bucket.items.map((hw) => (
                <li key={hw.homework_id} className="st-list-card">
                  <div className="st-list-card__row">
                    <span className="st-status-badge">ДЗ</span>
                    <strong>{hw.title}</strong>
                  </div>
                  <p className="st-muted">
                    {hw.status_label || hw.status}
                    {hw.score_percent != null ? ` · ${hw.score_percent}%` : ""}
                    {hw.attempt_count ? ` · попыток: ${hw.attempt_count}` : ""}
                  </p>
                  {hw.is_overdue ? <StudentStatusBadge status="overdue" label="Просрочено" /> : null}
                  {hw.teacher_comment ? <p className="st-muted">{hw.teacher_comment}</p> : null}
                  {(hw.attempts || []).length > 1 ? (
                    <details>
                      <summary>История попыток ({hw.attempts.length})</summary>
                      <ul>
                        {hw.attempts.map((a) => (
                          <li key={a.id}>
                            #{a.attempt_number}: {a.status}
                            {a.score != null ? ` · ${a.score}%` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null
      ))}
    </StudentPageShell>
  );
}
