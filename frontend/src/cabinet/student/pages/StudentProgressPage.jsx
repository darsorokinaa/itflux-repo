import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStudentProgress } from "../../../utils/cabinetAuth";
import { loadStudentData } from "../studentData";
import {
  StudentCardGrid,
  StudentEmptyState,
  StudentMetricCard,
  StudentPageHeader,
  StudentPageShell,
} from "../StudentSectionUi";

const TOPIC_STATUS = {
  repeat: "Повторить",
  hard: "Сложно",
  ok: "Усвоено",
};

export default function StudentProgressPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStudentData(fetchStudentProgress, "progress")
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <StudentPageShell><div className="st-loading">Загрузка…</div></StudentPageShell>;
  if (!data) return <StudentEmptyState title="Прогресс появится после первых заданий" icon="chart" />;

  const maxWeekly = Math.max(...(data.weekly || [1]), 1);

  return (
    <StudentPageShell>
      <StudentPageHeader title="Прогресс" subtitle="Ваши результаты." />

      <StudentCardGrid columns={4}>
        <StudentMetricCard label="Общий прогресс" value={`${data.overall_percent}%`} icon="chart" />
        <StudentMetricCard label="Уроков пройдено" value={data.lessons_completed} icon="lessons" tone="lav" />
        <StudentMetricCard label="Заданий выполнено" value={data.assignments_done} icon="check" tone="success" />
        <StudentMetricCard label="Средний результат" value={`${data.average_score}%`} icon="spark" tone="warn" />
      </StudentCardGrid>

      <section className="st-panel">
        <h2>Динамика по неделям</h2>
        <div className="st-week-chart">
          {(data.weekly || []).map((v, i) => (
            <div key={i} className="st-week-chart__bar" style={{ height: `${(v / maxWeekly) * 100}%` }} title={`${v}%`} />
          ))}
        </div>
      </section>

      <section className="st-panel">
        <h2>Темы для повторения</h2>
        <div className="st-topic-grid">
          {(data.weak_topics || []).map((t) => (
            <article key={t.title} className="st-topic-card">
              <h3>{t.title}</h3>
              <p>{t.percent}% · {TOPIC_STATUS[t.status] || "Повторить"}</p>
              <Link to="/cabinet/student/lessons" className="cb-btn cb-btn--outline cb-btn--sm">Повторить</Link>
            </article>
          ))}
        </div>
      </section>
    </StudentPageShell>
  );
}
