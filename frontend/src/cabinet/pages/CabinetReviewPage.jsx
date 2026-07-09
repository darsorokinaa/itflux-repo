import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CabinetHomeworkCard from "../CabinetHomeworkCard";
import {
  CabinetPageShell,
  CabinetPageHeader,
  CabinetFilterBar,
  CabinetMetricsRow,
  CabinetEmptyState,
} from "../CabinetSectionUi";
import { deleteHomework, fetchReviewItems } from "../../utils/cabinetAuth";

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
  { id: "students", label: "По ученикам" },
  { id: "groups", label: "По группам" },
  { id: "overdue", label: "Просроченные" },
  { id: "new", label: "Новые" },
  { id: "done", label: "Проверенные" },
];

function mapReviewItem(item) {
  const initials = (item.student_name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return {
    id: String(item.id),
    homeworkId: item.homework_submission?.homework ?? null,
    filter: ["all", item.status === "pending" ? "new" : "done"],
    coverType: item.source_type === "homework" ? "exam" : "general",
    deadlineLabel: item.status_label || item.status,
    deadlineTone: item.status === "pending" ? "review" : "completed",
    subject: item.source_type_label || item.source_type,
    title: item.title,
    description: item.student_name || "",
    progressLabel: item.status_label,
    progressPercent: item.status === "pending" ? 50 : 100,
    progressTone: item.status === "pending" ? "review" : "completed",
    students: [{ initials }],
    actionLabel: item.status === "pending" ? "Проверить" : "Открыть",
  };
}

export default function CabinetReviewPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchReviewItems();
        if (!cancelled) setWorks((data || []).map(mapReviewItem));
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDelete = useCallback(async (item) => {
    if (!item.homeworkId) return;
    if (!window.confirm(`Удалить домашнее задание «${item.title}»?\n\nЭто действие нельзя отменить. Работа ученика тоже будет удалена.`)) return;
    setDeletingId(item.id);
    try {
      await deleteHomework(item.homeworkId);
      setWorks((prev) => prev.filter((w) => w.id !== item.id));
    } catch (err) {
      setError(err.message || "Не удалось удалить домашнее задание");
    } finally {
      setDeletingId(null);
    }
  }, []);

  const metrics = useMemo(() => [
    { label: "На проверке", value: works.filter((w) => w.deadlineTone === "review").length, icon: "pencil", tone: "review", accent: "review" },
    { label: "Просрочено", value: 0, icon: "alert", tone: "danger", accent: "danger" },
    { label: "Проверено", value: works.filter((w) => w.deadlineTone === "completed").length, icon: "check", tone: "success", accent: "success" },
    { label: "Всего", value: works.length, icon: "tasks", tone: "info", accent: "info" },
  ], [works]);

  const items = useMemo(
    () => works.filter((w) => w.filter.includes(filter) || filter === "all"),
    [works, filter],
  );

  if (loading) {
    return (
      <CabinetPageShell className="cb-section--review">
        <p className="cb-loading">Загрузка работ…</p>
      </CabinetPageShell>
    );
  }

  return (
    <CabinetPageShell className="cb-section--review">
      <CabinetPageHeader title="Проверка" />
      <CabinetMetricsRow metrics={metrics} />
      <CabinetFilterBar filters={FILTERS} active={filter} onChange={setFilter} />
      {error ? <p className="cb-inline-error" role="alert">{error}</p> : null}
      {items.length === 0 ? (
        <CabinetEmptyState
          icon="check"
          title="Нет работ"
          text="Ответы учеников появятся здесь."
        />
      ) : (
        <div className="cb-hw-grid">
          {items.map((item) => (
            <CabinetHomeworkCard
              key={item.id}
              coverType={item.coverType}
              deadlineLabel={item.deadlineLabel}
              deadlineTone={item.deadlineTone}
              subject={item.subject}
              title={item.title}
              description={item.description}
              progressLabel={item.progressLabel}
              progressPercent={item.progressPercent}
              progressTone={item.progressTone}
              students={item.students}
              overflowCount={item.overflowCount}
              actionLabel={deletingId === item.id ? "Удаление…" : item.actionLabel}
              onAction={() => navigate(`/cabinet/review/${item.id}`)}
              dangerActionLabel={item.homeworkId ? "Удалить ДЗ" : undefined}
              onDangerAction={item.homeworkId ? () => handleDelete(item) : undefined}
            />
          ))}
        </div>
      )}
    </CabinetPageShell>
  );
}
