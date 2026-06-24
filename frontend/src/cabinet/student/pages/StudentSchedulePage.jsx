import { useEffect, useState } from "react";
import { fetchStudentSchedule } from "../../../utils/cabinetAuth";
import { loadStudentData } from "../studentData";
import {
  StudentEmptyState,
  StudentPageHeader,
  StudentPageShell,
  canShowLessonConnectButton,
  formatStudentDate,
  formatStudentTime,
} from "../StudentSectionUi";

const VIEWS = [
  { id: "list", label: "Список" },
  { id: "week", label: "Неделя" },
  { id: "day", label: "День" },
  { id: "month", label: "Месяц" },
];

export default function StudentSchedulePage() {
  const [items, setItems] = useState([]);
  const [view, setView] = useState("list");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStudentData(fetchStudentSchedule, "schedule")
      .then((d) => setItems(d?.items || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <StudentPageShell>
      <StudentPageHeader title="Расписание" subtitle="Ваши занятия." />
      <div className="st-view-tabs">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`st-view-tab${view === v.id ? " is-active" : ""}`}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {loading ? <div className="st-loading">Загрузка…</div> : null}
      {!loading && !items.length ? (
        <StudentEmptyState title="Занятий пока нет" icon="calendar" />
      ) : null}
      <div className="st-schedule-list">
        {items.map((e) => (
          <article key={e.id} className="st-schedule-card">
            <div className="st-schedule-card__time">
              <strong>{formatStudentTime(e.starts_at)}</strong>
              <span>{formatStudentDate(e.starts_at)}</span>
            </div>
            <div className="st-schedule-card__body">
              <h3>{e.title}</h3>
              <p>{e.teacher_name} · {e.format}</p>
            </div>
            {e.meeting_url && canShowLessonConnectButton(e.starts_at, e.ends_at) ? (
              <a href={e.meeting_url} className="cb-btn cb-btn--primary cb-btn--sm" target="_blank" rel="noreferrer">
                Подключиться
              </a>
            ) : e.meeting_url ? (
              <span className="st-schedule-card__pending">Подключение за 5 мин до начала</span>
            ) : (
              <span className="st-schedule-card__pending">Ссылка появится позже</span>
            )}
          </article>
        ))}
      </div>
    </StudentPageShell>
  );
}
