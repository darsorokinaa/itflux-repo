/**
 * Домашние задания — полный список с фильтрами.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CabinetHomeworkCard from "../../CabinetHomeworkCard";
import { fetchStudentAssignments, fetchStudentInteractives } from "../../../utils/cabinetAuth";
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
import StudentSubjectTabs, { getStoredStudentSubjectId } from "../StudentSubjectTabs";

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "todo", label: "Нужно выполнить" },
  { id: "in_progress", label: "В процессе" },
  { id: "reviewing", label: "На проверке" },
  { id: "checked", label: "Проверено" },
  { id: "overdue", label: "Просрочено" },
];

function matchesFilter(item, filter) {
  if (filter === "all") return true;
  if (filter === "todo") {
    return ["new", "in_progress", "overdue", "needs_fix"].includes(item.status);
  }
  if (filter === "reviewing") {
    return item.status === "submitted" || item.status === "reviewing";
  }
  if (filter === "in_progress") {
    return item.status === "in_progress" || item.status === "needs_fix";
  }
  return item.status === filter;
}

function HomeworkListCard({ item }) {
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
  const order = {
    overdue: 0,
    needs_fix: 1,
    new: 2,
    in_progress: 3,
    submitted: 4,
    reviewing: 4,
    checked: 5,
  };
  tagged.sort((a, b) => (order[a.status] ?? 6) - (order[b.status] ?? 6));
  return tagged;
}

export default function StudentAssignmentsPage() {
  const [assignments, setAssignments] = useState([]);
  const [interactives, setInteractives] = useState([]);
  const [filter, setFilter] = useState("todo");
  const [subjectId, setSubjectId] = useState(() => getStoredStudentSubjectId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadItems = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");

    const [assignmentsRes, interactivesRes] = await Promise.allSettled([
      fetchStudentAssignments({ studentSubjectId: subjectId || undefined }),
      fetchStudentInteractives(),
    ]);

    const errors = [];

    if (assignmentsRes.status === "fulfilled") {
      setAssignments(assignmentsRes.value?.items || []);
    } else {
      setAssignments([]);
      errors.push(assignmentsRes.reason?.message || "Не удалось загрузить домашние задания.");
    }

    if (interactivesRes.status === "fulfilled") {
      setInteractives(interactivesRes.value?.items || []);
    } else {
      setInteractives([]);
      errors.push(interactivesRes.reason?.message || "Не удалось загрузить интерактивы.");
    }

    if (errors.length > 0) {
      setError(errors[0]);
    }
    setLoading(false);
  }, [subjectId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    const reload = () => {
      loadItems({ silent: true });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reload();
      }
    };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadItems]);

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
      <StudentSubjectTabs value={subjectId} onChange={setSubjectId} />
      <StudentFilterPills filters={FILTERS} active={filter} onChange={setFilter} />

      {!loading && error ? (
        <StudentEmptyState
          icon="alert"
          title="Не удалось загрузить задания"
          text={error}
          actionLabel="Повторить"
          onAction={() => loadItems()}
        />
      ) : null}

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
          text="Попробуйте другой фильтр или предмет."
          actionLabel="Показать все"
          onAction={() => setFilter("all")}
        />
      )}

      {!loading && filtered.length > 0 && (
        <div className="st-hw-grid">
          {filtered.map((item) => (
            <HomeworkListCard key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </StudentPageShell>
  );
}
