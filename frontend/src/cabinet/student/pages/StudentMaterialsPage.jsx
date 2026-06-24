import { useEffect, useMemo, useState } from "react";
import { fetchStudentMaterials } from "../../../utils/cabinetAuth";
import { MATERIAL_FILTERS, filterMaterials, loadStudentData } from "../studentData";
import {
  StudentCardGrid,
  StudentCover,
  StudentEmptyState,
  StudentFilterPills,
  StudentPageHeader,
  StudentPageShell,
} from "../StudentSectionUi";

function MaterialCard({ item }) {
  const href = item.external_url || item.file_url || "#";
  const external = Boolean(item.external_url);

  return (
    <article className="st-entity-card">
      <StudentCover theme={item.cover_theme || "material"} className="st-entity-card__cover">
        <span className="st-entity-card__type">{item.type_label}</span>
      </StudentCover>
      <div className="st-entity-card__body">
        <h3>{item.title}</h3>
        <p>{item.topic || "Материал"}</p>
        {href !== "#" ? (
          <a
            href={href}
            className="cb-btn cb-btn--primary cb-btn--sm cb-btn--pill"
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
          >
            Открыть
          </a>
        ) : (
          <span className="st-schedule-card__pending">Скоро</span>
        )}
      </div>
    </article>
  );
}

export default function StudentMaterialsPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStudentData(fetchStudentMaterials, "materials")
      .then((d) => setItems(d?.items || []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => filterMaterials(items, filter), [items, filter]);

  return (
    <StudentPageShell>
      <StudentPageHeader title="Материалы" subtitle="Теория и файлы от учителя." />
      <StudentFilterPills filters={MATERIAL_FILTERS} active={filter} onChange={setFilter} />
      {loading ? <div className="st-loading">Загрузка…</div> : null}
      {!loading && !items.length ? (
        <StudentEmptyState title="Материалы пока не добавлены" icon="folder" />
      ) : null}
      <StudentCardGrid>
        {filtered.map((item) => <MaterialCard key={item.id} item={item} />)}
      </StudentCardGrid>
    </StudentPageShell>
  );
}
