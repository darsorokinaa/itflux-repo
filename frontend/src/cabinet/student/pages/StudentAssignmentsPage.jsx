/**
 * Задания — домашние работы и интерактивы ученика.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CabinetHomeworkCard from "../../CabinetHomeworkCard";
import { fetchStudentAssignments, fetchStudentInteractives } from "../../../utils/cabinetAuth";
import { loadStudentData } from "../studentData";
import {
  getStudentAssignmentPath,
  mapStudentAssignmentToHwCard,
} from "../studentAssignmentCards";
import {
  StudentEmptyState,
  StudentFilterPills,
  StudentLoadingState,
  StudentPageShell,
} from "../StudentSectionUi";

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "new", label: "Новые" },
  { id: "in_progress", label: "В работе" },
  { id: "submitted", label: "Сдано" },
  { id: "checked", label: "Проверено" },
];

function AssignmentCard({ item }) {
  const navigate = useNavigate();
  const card = mapStudentAssignmentToHwCard(item);

  return (
    <CabinetHomeworkCard
      {...card}
      onAction={() => navigate(getStudentAssignmentPath(item))}
    />
  );
}

function mergeItems(assignments, interactives) {
  const tagged = [
    ...assignments.map((a) => ({ ...a, kind: "assignment" })),
    ...interactives.map((i) => ({ ...i, kind: "interactive" })),
  ];
  tagged.sort((a, b) => {
    const order = { new: 0, in_progress: 1, submitted: 2, reviewing: 2, checked: 3, overdue: 0 };
    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
  });
  return tagged;
}

function matchesFilter(item, filter) {
  if (filter === "all") return true;
  if (filter === "submitted") return item.status === "submitted" || item.status === "reviewing";
  return item.status === filter;
}

export default function StudentAssignmentsPage() {
  const [assignments, setAssignments] = useState([]);
  const [interactives, setInteractives] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let done = 0;
    const finish = () => { done += 1; if (done === 2) setLoading(false); };

    loadStudentData(fetchStudentAssignments, "assignments", false)
      .then((d) => setAssignments(d?.items || []))
      .finally(finish);

    loadStudentData(fetchStudentInteractives, "interactives", false)
      .then((d) => setInteractives(d?.items || []))
      .finally(finish);
  }, []);

  const allItems = useMemo(
    () => mergeItems(assignments, interactives),
    [assignments, interactives],
  );

  const filtered = useMemo(
    () => allItems.filter((item) => matchesFilter(item, filter)),
    [allItems, filter],
  );

  return (
    <StudentPageShell className="st-assignments-page">
      <StudentFilterPills filters={FILTERS} active={filter} onChange={setFilter} />

      {loading && <StudentLoadingState />}

      {!loading && allItems.length === 0 && (
        <StudentEmptyState
          icon="check"
          title="Заданий пока нет"
          text="Когда учитель выдаст задание или интерактив, они появятся здесь."
        />
      )}

      {!loading && allItems.length > 0 && filtered.length === 0 && (
        <StudentEmptyState
          icon="check"
          title="Ничего не найдено"
          actionLabel="Показать все"
          onAction={() => setFilter("all")}
        />
      )}

      {!loading && filtered.length > 0 && (
        <div className="cb-hw-grid st-assignments-grid">
          {filtered.map((item) => (
            <AssignmentCard key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </StudentPageShell>
  );
}
