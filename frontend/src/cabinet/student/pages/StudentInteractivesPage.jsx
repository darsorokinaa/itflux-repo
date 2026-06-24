import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStudentInteractives } from "../../../utils/cabinetAuth";
import { INTERACTIVE_FILTERS, filterInteractives, loadStudentData } from "../studentData";
import {
  StudentCardGrid,
  StudentCover,
  StudentEmptyState,
  StudentFilterPills,
  StudentPageHeader,
  StudentPageShell,
  StudentStatusBadge,
  interactiveActionLabel,
} from "../StudentSectionUi";

function InteractiveCard({ item }) {
  return (
    <article className="st-entity-card">
      <StudentCover theme={item.cover_theme || "interactive"} className="st-entity-card__cover">
        <span className="st-entity-card__type">{item.type_label}</span>
      </StudentCover>
      <div className="st-entity-card__body">
        <h3>{item.title}</h3>
        <p>{item.items_count} элементов</p>
        <div className="st-entity-card__meta">
          <StudentStatusBadge status={item.status} label={item.status_label} />
          {item.score_percent != null ? <span>{item.score_percent}%</span> : null}
        </div>
        <Link to={`/cabinet/student/interactives/${item.id}/play`} className="cb-btn cb-btn--primary cb-btn--sm cb-btn--pill">
          {interactiveActionLabel(item.action)}
        </Link>
      </div>
    </article>
  );
}

export default function StudentInteractivesPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStudentData(fetchStudentInteractives, "interactives")
      .then((d) => setItems(d?.items || []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => filterInteractives(items, filter), [items, filter]);

  return (
    <StudentPageShell>
      <StudentPageHeader title="Интерактивы" subtitle="Задания для практики." />
      <StudentFilterPills filters={INTERACTIVE_FILTERS} active={filter} onChange={setFilter} />
      {loading ? <div className="st-loading">Загрузка…</div> : null}
      {!loading && !items.length ? (
        <StudentEmptyState title="Интерактивов пока нет" icon="interactives" />
      ) : null}
      <StudentCardGrid>
        {filtered.map((item) => <InteractiveCard key={item.id} item={item} />)}
      </StudentCardGrid>
    </StudentPageShell>
  );
}
