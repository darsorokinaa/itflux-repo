import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CabinetHomeworkCard from "../CabinetHomeworkCard";
import ConfirmActionModal from "../components/ConfirmActionModal";
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

function resolveDueAt(item) {
  return (
    item.due_at
    || item.deadline
    || item.homework_review?.due_at
    || item.homework_submission?.due_at
    || null
  );
}

function isReviewOverdue(item) {
  if (item.is_overdue === true) return true;
  if (item.status !== "pending") return false;
  const dueAt = resolveDueAt(item);
  if (!dueAt) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < Date.now();
}

function mapReviewItem(item) {
  const initials = (item.student_name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const overdue = isReviewOverdue(item);
  const filter = ["all", item.status === "pending" ? "new" : "done"];
  if (overdue) filter.push("overdue");
  const level = (item.homework_review?.level || "").toLowerCase();
  if (level.includes("oge") || level === "огэ") filter.push("oge");
  if (level.includes("ege") || level === "егэ") filter.push("ege");
  if (item.student || item.student_name) filter.push("students");
  if (item.group) filter.push("groups");

  return {
    id: String(item.id),
    homeworkId: item.homework_submission?.homework ?? item.homework_review?.homework_id ?? null,
    filter,
    coverType: item.source_type === "homework" ? "exam" : "general",
    deadlineLabel: overdue ? "Просрочено" : (item.status_label || item.status),
    deadlineTone: overdue ? "overdue" : (item.status === "pending" ? "review" : "completed"),
    subject: item.source_type_label || item.source_type,
    title: item.title,
    description: item.student_name || "",
    progressLabel: overdue && item.status === "pending" ? "Просрочено" : item.status_label,
    progressPercent: item.status === "pending" ? 50 : 100,
    progressTone: overdue ? "overdue" : (item.status === "pending" ? "review" : "completed"),
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
  const [deleteTarget, setDeleteTarget] = useState(null);

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

  const confirmDelete = useCallback(async () => {
    const item = deleteTarget;
    if (!item?.homeworkId) return;
    setDeletingId(item.id);
    try {
      await deleteHomework(item.homeworkId);
      setWorks((prev) => prev.filter((w) => w.id !== item.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err.message || "Не удалось удалить домашнее задание");
    } finally {
      setDeletingId(null);
    }
  }, [deleteTarget]);

  const metrics = useMemo(() => [
    { label: "На проверке", value: works.filter((w) => w.filter.includes("new")).length, icon: "pencil", tone: "review", accent: "review" },
    { label: "Просрочено", value: works.filter((w) => w.filter.includes("overdue")).length, icon: "alert", tone: "danger", accent: "danger" },
    { label: "Проверено", value: works.filter((w) => w.filter.includes("done")).length, icon: "check", tone: "success", accent: "success" },
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
              onDangerAction={item.homeworkId ? () => setDeleteTarget(item) : undefined}
            />
          ))}
        </div>
      )}

      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title="Удалить домашнее задание?"
        text={
          deleteTarget
            ? `Удалить домашнее задание «${deleteTarget.title}»? Это действие нельзя отменить. Работа ученика тоже будет удалена.`
            : ""
        }
        confirmLabel="Удалить"
        danger
        loading={Boolean(deletingId)}
        onClose={() => {
          if (!deletingId) setDeleteTarget(null);
        }}
        onConfirm={confirmDelete}
      />
    </CabinetPageShell>
  );
}
