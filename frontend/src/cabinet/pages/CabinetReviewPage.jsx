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
import { deleteHomework, fetchReviewItems, normalizeCabinetList } from "../../utils/cabinetAuth";
import HomeworkCopyModal from "../components/HomeworkCopyModal";

const FILTERS = [
  { id: "inbox", label: "К проверке" },
  { id: "done", label: "Проверенные" },
  { id: "overdue", label: "Просроченные" },
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
  { id: "students", label: "По ученикам" },
  { id: "groups", label: "По группам" },
  { id: "all", label: "Все" },
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
  const studentName = (item.student_name || "").trim();
  const initials = (studentName || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const overdue = isReviewOverdue(item);
  const awaitingSubmission = item.status === "pending" && !item.homework_submission?.submitted_at;
  const submittedForReview = item.status === "pending" && !awaitingSubmission;
  const studentId = item.student ?? item.homework_submission?.student ?? null;
  const groupId = item.group ?? null;
  const groupTitle = (item.group_title || "").trim();

  const filter = ["all"];
  if (item.status === "pending") {
    if (awaitingSubmission) filter.push("assigned");
    else filter.push("new");
    filter.push("inbox");
  } else {
    filter.push("done");
  }
  if (overdue) filter.push("overdue");
  const level = (item.homework_review?.level || "").toLowerCase();
  if (level.includes("oge") || level === "огэ") filter.push("oge");
  if (level.includes("ege") || level === "егэ") filter.push("ege");
  if (studentId || studentName) filter.push("students");
  if (groupId || groupTitle) filter.push("groups");

  let deadlineLabel = item.status_label || item.status;
  let deadlineTone = item.status === "pending" ? "review" : "completed";
  let progressLabel = item.status_label;
  let progressTone = item.status === "pending" ? "review" : "completed";
  let progressPercent = item.status === "pending" ? 50 : 100;
  let actionLabel = item.status === "pending" ? "Проверить" : "Открыть";

  if (awaitingSubmission) {
    deadlineLabel = "Выдано";
    deadlineTone = "info";
    progressLabel = "Ожидает сдачи";
    progressTone = "default";
    progressPercent = 15;
    actionLabel = "Открыть";
  }
  if (overdue) {
    deadlineLabel = "Просрочено";
    deadlineTone = "overdue";
    if (item.status === "pending") {
      progressLabel = "Просрочено";
      progressTone = "overdue";
    }
  }

  return {
    id: String(item.id),
    homeworkId: item.homework_submission?.homework ?? item.homework_review?.homework_id ?? null,
    status: item.status || "",
    canDeleteHomework: item.status !== "checked",
    dueAt: resolveDueAt(item),
    awaitingSubmission,
    submittedForReview,
    studentId: studentId != null ? String(studentId) : "",
    studentName: studentName || "Без ученика",
    groupId: groupId != null ? String(groupId) : "",
    groupTitle: groupTitle || "Без группы",
    filter,
    coverType: item.source_type === "homework" ? "exam" : "general",
    deadlineLabel,
    deadlineTone,
    subject: item.source_type_label || item.source_type,
    title: item.title,
    description: studentName || "",
    progressLabel,
    progressPercent,
    progressTone,
    students: [{ initials }],
    actionLabel,
  };
}

function groupWorksBy(items, keyFn, titleFn, sortTitles = true) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, { key, title: titleFn(item), items: [] });
    }
    map.get(key).items.push(item);
  });
  const groups = Array.from(map.values());
  if (sortTitles) {
    groups.sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }
  groups.forEach((g) => {
    g.items.sort((a, b) => {
      const aNew = a.filter.includes("new") ? 0 : 1;
      const bNew = b.filter.includes("new") ? 0 : 1;
      if (aNew !== bNew) return aNew - bNew;
      return String(a.title || "").localeCompare(String(b.title || ""), "ru");
    });
  });
  return groups;
}

function ReviewWorksGrid({ items, deletingId, onOpen, onDeleteRequest, onCopyRequest }) {
  if (!items.length) return null;
  return (
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
            onAction={() => onOpen(item)}
            secondaryActionLabel={item.homeworkId ? "Скопировать" : undefined}
            onSecondaryAction={
              item.homeworkId ? () => onCopyRequest?.(item) : undefined
            }
            dangerActionLabel={item.homeworkId ? "Удалить ДЗ" : undefined}
            onDangerAction={
              item.homeworkId && item.canDeleteHomework
                ? () => onDeleteRequest(item)
                : undefined
            }
            dangerActionDisabled={Boolean(item.homeworkId) && !item.canDeleteHomework}
            dangerActionDisabledHint="Проверенное и принятое ДЗ удалить нельзя"
          />
      ))}
    </div>
  );
}

function ReviewGroupedSections({
  groups,
  deletingId,
  onOpen,
  onDeleteRequest,
  onCopyRequest,
  emptyTitle,
  emptyText,
}) {
  if (!groups.length) {
    return (
      <CabinetEmptyState
        icon="check"
        title={emptyTitle}
        text={emptyText}
      />
    );
  }
  return (
    <div className="cb-review-inbox">
      {groups.map((group) => (
        <section
          key={group.key}
          className="cb-review-inbox__section"
          aria-labelledby={`review-group-${group.key}`}
        >
          <div className="cb-review-inbox__head">
            <h2 id={`review-group-${group.key}`} className="cb-review-inbox__title">
              {group.title}
            </h2>
            <span className="cb-review-inbox__count">{group.items.length}</span>
          </div>
          <ReviewWorksGrid
            items={group.items}
            deletingId={deletingId}
            onOpen={onOpen}
            onDeleteRequest={onDeleteRequest}
            onCopyRequest={onCopyRequest}
          />
        </section>
      ))}
    </div>
  );
}

export default function CabinetReviewPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("inbox");
  const [studentScope, setStudentScope] = useState("all");
  const [groupScope, setGroupScope] = useState("all");
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [copyTarget, setCopyTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async ({ soft = false } = {}) => {
      if (!soft) setLoading(true);
      try {
        const data = await fetchReviewItems();
        if (!cancelled) {
          setWorks(normalizeCabinetList(data).map(mapReviewItem));
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const onFocus = () => load({ soft: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") load({ soft: true });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    setStudentScope("all");
    setGroupScope("all");
  }, [filter]);

  const confirmDelete = useCallback(async () => {
    const item = deleteTarget;
    if (!item?.homeworkId || !item.canDeleteHomework) return;
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
    { label: "На проверке", shortLabel: "Проверка", value: works.filter((w) => w.filter.includes("new")).length, icon: "pencil", tone: "review", accent: "review" },
    { label: "Ожидают сдачи", shortLabel: "Ожидают", value: works.filter((w) => w.filter.includes("assigned")).length, icon: "tasks", tone: "info", accent: "info" },
    { label: "Просрочено", value: works.filter((w) => w.filter.includes("overdue")).length, icon: "alert", tone: "danger", accent: "danger" },
    { label: "Проверено", value: works.filter((w) => w.filter.includes("done")).length, icon: "check", tone: "success", accent: "success" },
  ], [works]);

  const submittedWorks = useMemo(
    () => works.filter((w) => w.filter.includes("new")),
    [works],
  );
  const awaitingWorks = useMemo(
    () => works.filter((w) => w.filter.includes("assigned")),
    [works],
  );

  const studentOptions = useMemo(() => {
    const map = new Map();
    works.forEach((w) => {
      if (!w.filter.includes("students")) return;
      const key = w.studentId || `name:${w.studentName}`;
      if (!map.has(key)) map.set(key, { id: key, label: w.studentName });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [works]);

  const groupOptions = useMemo(() => {
    const map = new Map();
    works.forEach((w) => {
      if (!w.filter.includes("groups")) return;
      const key = w.groupId || `title:${w.groupTitle}`;
      if (!map.has(key)) map.set(key, { id: key, label: w.groupTitle });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [works]);

  const studentGrouped = useMemo(() => {
    let list = works.filter((w) => w.filter.includes("students"));
    if (studentScope !== "all") {
      list = list.filter((w) => (w.studentId || `name:${w.studentName}`) === studentScope);
    }
    return groupWorksBy(
      list,
      (w) => w.studentId || `name:${w.studentName}`,
      (w) => w.studentName,
    );
  }, [works, studentScope]);

  const groupGrouped = useMemo(() => {
    let list = works.filter((w) => w.filter.includes("groups"));
    if (groupScope !== "all") {
      list = list.filter((w) => (w.groupId || `title:${w.groupTitle}`) === groupScope);
    }
    return groupWorksBy(
      list,
      (w) => w.groupId || `title:${w.groupTitle}`,
      (w) => w.groupTitle,
    );
  }, [works, groupScope]);

  const tabItems = useMemo(() => {
    if (filter === "inbox" || filter === "students" || filter === "groups") return [];
    return works.filter((w) => w.filter.includes(filter) || filter === "all");
  }, [works, filter]);

  const openItem = useCallback((item) => {
    navigate(`/cabinet/review/${item.id}`);
  }, [navigate]);

  if (loading) {
    return (
      <CabinetPageShell className="cb-section--review">
        <p className="cb-loading">Загрузка работ…</p>
      </CabinetPageShell>
    );
  }

  const inboxEmpty = submittedWorks.length === 0 && awaitingWorks.length === 0;

  return (
    <CabinetPageShell className="cb-section--review">
      <CabinetPageHeader title="Проверка" />
      <CabinetMetricsRow metrics={metrics} />
      <CabinetFilterBar filters={FILTERS} active={filter} onChange={setFilter} />

      {filter === "students" ? (
        <div className="cb-review-scope">
          <label className="cb-review-scope__label" htmlFor="review-student-scope">
            Ученик
          </label>
          <select
            id="review-student-scope"
            className="cb-review-scope__select"
            value={studentScope}
            onChange={(e) => setStudentScope(e.target.value)}
          >
            <option value="all">Все ученики</option>
            {studentOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      ) : null}

      {filter === "groups" ? (
        <div className="cb-review-scope">
          <label className="cb-review-scope__label" htmlFor="review-group-scope">
            Группа
          </label>
          <select
            id="review-group-scope"
            className="cb-review-scope__select"
            value={groupScope}
            onChange={(e) => setGroupScope(e.target.value)}
          >
            <option value="all">Все группы</option>
            {groupOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      ) : null}

      {error ? <p className="cb-inline-error" role="alert">{error}</p> : null}

      {filter === "inbox" ? (
        inboxEmpty ? (
          <CabinetEmptyState
            icon="check"
            title="Нет работ к проверке"
            text="Сданные и ожидающие сдачи домашние задания появятся здесь."
          />
        ) : (
          <div className="cb-review-inbox">
            <section className="cb-review-inbox__section" aria-labelledby="review-submitted-heading">
              <div className="cb-review-inbox__head">
                <h2 id="review-submitted-heading" className="cb-review-inbox__title">Сданные</h2>
                <span className="cb-review-inbox__count">{submittedWorks.length}</span>
              </div>
              {submittedWorks.length ? (
                <ReviewWorksGrid
                  items={submittedWorks}
                  deletingId={deletingId}
                  onOpen={openItem}
                  onDeleteRequest={setDeleteTarget}
                  onCopyRequest={setCopyTarget}
                />
              ) : (
                <p className="cb-review-inbox__empty">Пока нет сданных работ</p>
              )}
            </section>

            <section className="cb-review-inbox__section" aria-labelledby="review-awaiting-heading">
              <div className="cb-review-inbox__head">
                <h2 id="review-awaiting-heading" className="cb-review-inbox__title">Ожидают сдачи</h2>
                <span className="cb-review-inbox__count">{awaitingWorks.length}</span>
              </div>
              {awaitingWorks.length ? (
                <ReviewWorksGrid
                  items={awaitingWorks}
                  deletingId={deletingId}
                  onOpen={openItem}
                  onDeleteRequest={setDeleteTarget}
                  onCopyRequest={setCopyTarget}
                />
              ) : (
                <p className="cb-review-inbox__empty">Нет выданных заданий без ответа</p>
              )}
            </section>
          </div>
        )
      ) : filter === "students" ? (
        <ReviewGroupedSections
          groups={studentGrouped}
          deletingId={deletingId}
          onOpen={openItem}
          onDeleteRequest={setDeleteTarget}
          onCopyRequest={setCopyTarget}
          emptyTitle="Нет работ по ученикам"
          emptyText="Когда появятся работы с указанным учеником, они сгруппируются здесь."
        />
      ) : filter === "groups" ? (
        <ReviewGroupedSections
          groups={groupGrouped}
          deletingId={deletingId}
          onOpen={openItem}
          onDeleteRequest={setDeleteTarget}
          onCopyRequest={setCopyTarget}
          emptyTitle="Нет работ по группам"
          emptyText="Работы, привязанные к группе, появятся здесь."
        />
      ) : tabItems.length === 0 ? (
        <CabinetEmptyState
          icon="check"
          title="Нет работ"
          text="В этой вкладке пока ничего нет."
        />
      ) : (
        <ReviewWorksGrid
          items={tabItems}
          deletingId={deletingId}
          onOpen={openItem}
          onDeleteRequest={setDeleteTarget}
          onCopyRequest={setCopyTarget}
        />
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

      {copyTarget?.homeworkId ? (
        <HomeworkCopyModal
          homeworkId={copyTarget.homeworkId}
          homeworkTitle={copyTarget.title || ""}
          sourceStudentId={copyTarget.studentId || null}
          sourceDueAt={copyTarget.dueAt || null}
          onClose={() => setCopyTarget(null)}
          onCopied={() => {
            setCopyTarget(null);
            window.dispatchEvent(new Event("cabinet:nav-counts-refresh"));
          }}
        />
      ) : null}
    </CabinetPageShell>
  );
}
