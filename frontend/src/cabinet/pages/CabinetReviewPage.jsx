import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import CabinetHomeworkCard from "../CabinetHomeworkCard";
import ConfirmActionModal from "../components/ConfirmActionModal";
import CabinetSearchableSelect from "../components/CabinetSearchableSelect";
import {
  CabinetPageShell,
  CabinetPageHeader,
  CabinetFilterBar,
  CabinetEmptyState,
} from "../CabinetSectionUi";
import { deleteHomework, fetchReviewItems, normalizeCabinetList } from "../../utils/cabinetAuth";
import HomeworkCopyModal from "../components/HomeworkCopyModal";
import {
  formatAutoCheckLine,
  formatResultCounts,
  formatResultPercent,
  formatSubmittedAtLabel,
} from "../homeworkResultSummary";
import { classifyReviewItem, mapUnsubmittedWork, reviewQueues, reviewTabCounts } from "../reviewUnsubmitted";

const FILTERS = [
  { id: "inbox", label: "На проверке" },
  { id: "done", label: "Проверено" },
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

function formatDueBadge(iso) {
  if (!iso) return "";
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return "";
  return due.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSameLocalDay(iso) {
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return false;
  return due.toDateString() === new Date().toDateString();
}

function isReviewOverdue(item) {
  if (item.status !== "pending") return false;
  const dueAt = resolveDueAt(item);
  if (!dueAt) return item.is_overdue === true;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < Date.now();
}

function homeworkTitle(item) {
  const fromHw = (item.homework_review?.homework_title || "").trim();
  if (fromHw) return fromHw;
  const title = (item.title || "").trim();
  const name = (item.student_name || "").trim();
  if (name && title.endsWith(`— ${name}`)) {
    return title.slice(0, title.length - name.length - 2).replace(/[—–-]\s*$/, "").trim();
  }
  return title || "Домашнее задание";
}

function subjectLabel(item) {
  return (
    item.homework_review?.subject_label
    || item.student_subject_label
    || ""
  ) || "Домашнее задание";
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
  const submittedForReview = item.status === "pending" && Boolean(item.homework_submission?.submitted_at);
  const studentId = item.student ?? item.homework_submission?.student ?? null;
  const groupId = item.group ?? null;
  const groupTitle = (item.group_title || "").trim();
  const summary = item.result_summary || null;

  const classified = classifyReviewItem(item, { overdue });
  const filter = classified.filter;
  const awaitingSubmission = classified.awaitingSubmission;
  const level = (item.homework_review?.level || "").toLowerCase();
  if (level.includes("oge") || level === "огэ") filter.push("oge");
  if (level.includes("ege") || level === "егэ") filter.push("ege");
  if (studentId || studentName) filter.push("students");
  if (groupId || groupTitle) filter.push("groups");

  let deadlineLabel = "На проверке";
  let deadlineTone = "review";
  let actionLabel = "Проверить работу";
  let metaLine = "";
  let result = null;

  if (item.status === "checked") {
    deadlineLabel = "Проверено";
    deadlineTone = "completed";
    actionLabel = "Перейти к результатам";
    const countsLabel = formatResultCounts(summary);
    const percentage = formatResultPercent(summary);
    if (countsLabel || percentage != null) {
      result = { countsLabel, percentage };
    }
  } else if (item.status === "returned") {
    deadlineLabel = "На доработке";
    deadlineTone = "overdue";
    actionLabel = "Открыть работу";
    metaLine = "Нужно исправить работу";
  } else if (awaitingSubmission) {
    deadlineLabel = "Не сдано";
    deadlineTone = "info";
    actionLabel = "Открыть задание";
  } else {
    deadlineLabel = "На проверке";
    deadlineTone = "review";
    actionLabel = "Проверить работу";
    metaLine = formatSubmittedAtLabel(item.homework_submission?.submitted_at);
    const autoLine = formatAutoCheckLine(summary);
    if (autoLine || summary?.needs_manual_review) {
      result = {
        countsLabel: autoLine,
        hint: summary?.needs_manual_review ? "Есть задания для ручной проверки" : "",
      };
    }
  }

  const dueBadge = formatDueBadge(resolveDueAt(item));
  if (awaitingSubmission && dueBadge) {
    deadlineLabel = `До ${dueBadge}`;
    if (overdue) {
      deadlineTone = "overdue";
      metaLine = "Просрочено";
    } else {
      deadlineTone = isSameLocalDay(resolveDueAt(item)) ? "today" : "default";
    }
  }

  return {
    id: String(item.id),
    homeworkId: item.homework_submission?.homework ?? item.homework_review?.homework_id ?? null,
    status: item.status || "",
    canDeleteHomework: item.status !== "checked",
    dueAt: resolveDueAt(item),
    submittedAt: item.homework_submission?.submitted_at || null,
    checkedAt: item.checked_at || null,
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
    subject: subjectLabel(item),
    title: homeworkTitle(item),
    metaLine,
    result,
    students: [{ initials, name: studentName }],
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
            studentName={item.studentName}
            metaLine={item.metaLine}
            result={item.result}
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

function ReviewSkeletonGrid() {
  return (
    <div className="cb-hw-grid" aria-hidden="true">
      {[0, 1, 2].map((key) => (
        <div key={key} className="cb-hw-card cb-hw-card--skeleton" />
      ))}
    </div>
  );
}

function patchSearchParams(params, patch) {
  const next = new URLSearchParams(params);
  Object.entries(patch).forEach(([key, value]) => {
    if (value == null || value === "") next.delete(key);
    else next.set(key, String(value));
  });
  return next;
}

export default function CabinetReviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("tab") || "inbox";
  const studentScope = searchParams.get("student") || "all";
  const groupScope = searchParams.get("group") || "all";
  const subjectScope = searchParams.get("subject") || "";
  const searchQuery = searchParams.get("q") || "";
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const [works, setWorks] = useState([]);
  const [unsubmitted, setUnsubmitted] = useState([]);
  const [studentOptions, setStudentOptions] = useState([]);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [counts, setCounts] = useState({ all: 0, pending: 0, checked: 0, returned: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [copyTarget, setCopyTarget] = useState(null);

  const setFilterValue = useCallback((patch) => {
    setSearchParams(patchSearchParams(searchParams, patch), { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    setSearchDraft(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (searchDraft !== searchQuery) {
        setSearchParams(patchSearchParams(searchParams, { q: searchDraft }), { replace: true });
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchDraft, searchQuery, searchParams, setSearchParams]);

  const load = useCallback(async ({ soft = false } = {}) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchReviewItems({
        student: studentScope !== "all" ? studentScope : undefined,
        subject: subjectScope || undefined,
        q: searchQuery || undefined,
      });
      setWorks(
        normalizeCabinetList(data)
          .map(mapReviewItem)
          .filter((item) => !item.awaitingSubmission),
      );
      setUnsubmitted((Array.isArray(data?.unsubmitted) ? data.unsubmitted : []).map(mapUnsubmittedWork));
      setCounts(data?.counts || { all: 0, pending: 0, checked: 0, returned: 0 });
      setStudentOptions(Array.isArray(data?.students) ? data.students : []);
      setSubjectOptions(Array.isArray(data?.subjects) ? data.subjects : []);
      setError(null);
    } catch (err) {
      setError(err.message || "Не удалось загрузить работы");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [studentScope, subjectScope, searchQuery]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => load({ soft: true });
    const onVisibility = () => {
      if (document.visibilityState === "visible") load({ soft: true });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const requestDelete = useCallback((item) => {
    setDeleteError("");
    setDeleteTarget(item);
  }, []);

  const confirmDelete = useCallback(async () => {
    const item = deleteTarget;
    if (!item?.homeworkId || !item.canDeleteHomework) return;
    setDeletingId(item.id);
    setDeleteError("");
    try {
      await deleteHomework(item.homeworkId);
      setWorks((prev) => prev.filter((w) => w.id !== item.id && w.homeworkId !== item.homeworkId));
      setUnsubmitted((prev) => prev.filter((w) => w.homeworkId !== item.homeworkId));
      setDeleteTarget(null);
      window.dispatchEvent(new Event("cabinet:nav-counts-refresh"));
      load({ soft: true });
    } catch (err) {
      const message = err.message || "Не удалось удалить домашнее задание";
      setDeleteError(message);
      setError(message);
    } finally {
      setDeletingId(null);
    }
  }, [deleteTarget, load]);

  const selectedStudent = studentOptions.find((opt) => String(opt.id) === String(studentScope));
  const studentName = selectedStudent?.label || "";

  const queues = useMemo(
    () => reviewQueues(works, unsubmitted),
    [works, unsubmitted],
  );
  const tabCounts = useMemo(
    () => reviewTabCounts(works, unsubmitted, counts),
    [works, unsubmitted, counts],
  );

  const chipFilters = useMemo(() => ([
    { id: "all", label: "Все", count: tabCounts.all },
    { id: "inbox", label: "На проверке", count: tabCounts.pending },
    { id: "missing", label: "Не сдано", count: tabCounts.unsubmitted },
    { id: "returned", label: "На доработке", count: tabCounts.returned },
    { id: "done", label: "Проверено", count: tabCounts.checked },
    { id: "overdue", label: "Просроченные", count: tabCounts.overdue },
    ...FILTERS.filter((f) => !["all", "inbox", "done", "overdue"].includes(f.id)),
  ]), [tabCounts]);
  const submittedWorks = queues.toReview;

  const groupOptions = useMemo(() => {
    const map = new Map();
    [...works, ...unsubmitted].forEach((w) => {
      if (!w.filter.includes("groups")) return;
      const key = w.groupId || `title:${w.groupTitle}`;
      if (!map.has(key)) map.set(key, { id: key, label: w.groupTitle });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [works, unsubmitted]);

  const studentGrouped = useMemo(() => {
    let list = [...works, ...unsubmitted].filter((w) => w.filter.includes("students"));
    if (studentScope !== "all") {
      list = list.filter((w) => w.studentId === String(studentScope));
    }
    return groupWorksBy(
      list,
      (w) => w.studentId || `name:${w.studentName}`,
      (w) => w.studentName,
    );
  }, [works, unsubmitted, studentScope]);

  const groupGrouped = useMemo(() => {
    let list = [...works, ...unsubmitted].filter((w) => w.filter.includes("groups"));
    if (groupScope !== "all") {
      list = list.filter((w) => (w.groupId || `title:${w.groupTitle}`) === groupScope);
    }
    return groupWorksBy(
      list,
      (w) => w.groupId || `title:${w.groupTitle}`,
      (w) => w.groupTitle,
    );
  }, [works, unsubmitted, groupScope]);

  const tabItems = useMemo(() => {
    if (filter === "inbox" || filter === "students" || filter === "groups" || filter === "missing") return [];
    if (filter === "overdue") return queues.overdue;
    return works.filter((w) => w.filter.includes(filter) || filter === "all");
  }, [works, filter, queues.overdue]);

  const openItem = useCallback((item) => {
    if (item.kind === "unsubmitted" && item.openPath) {
      navigate(item.openPath, {
        state: { from: `${location.pathname}${location.search}` },
      });
      return;
    }
    navigate(`/cabinet/review/${item.id}`, {
      state: { from: `${location.pathname}${location.search}` },
    });
  }, [navigate, location.pathname, location.search]);

  const emptyCopy = useMemo(() => {
    if (works.length === 0 && !studentName && !searchQuery && !subjectScope) {
      return {
        title: "Здесь пока нет работ",
        text: "Когда ученики отправят домашние задания, они появятся в этом разделе.",
      };
    }
    if (filter === "inbox" && studentName) {
      return {
        title: "Работ на проверке нет",
        text: `Все отправленные работы ученика «${studentName}» уже проверены.`,
      };
    }
    if (studentName) {
      return {
        title: "Нет работ",
        text: `По выбранным фильтрам у «${studentName}» ничего не найдено.`,
      };
    }
    return {
      title: "Нет работ",
      text: "В этой вкладке пока ничего нет.",
    };
  }, [works.length, studentName, searchQuery, subjectScope, filter]);

  const inboxEmpty = submittedWorks.length === 0;
  const showSkeleton = loading || (refreshing && works.length === 0);

  return (
    <CabinetPageShell className="cb-section--review">
      <CabinetPageHeader title="Проверка домашних заданий" />

      <div className="cb-review-toolbar">
        <CabinetSearchableSelect
          id="review-student-filter"
          label="Ученик"
          value={studentScope === "all" ? "" : studentScope}
          options={studentOptions}
          allLabel="Все ученики"
          placeholder="Найти ученика"
          onChange={(id) => setFilterValue({ student: id || null })}
        />
        <label className="cb-review-toolbar__field">
          <span className="cb-search-select__label">Предмет</span>
          <select
            className="cb-review-scope__select"
            value={subjectScope}
            aria-label="Предмет"
            onChange={(e) => setFilterValue({ subject: e.target.value || null })}
          >
            <option value="">Все предметы</option>
            {subjectOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="cb-review-toolbar__search">
          <span className="cb-search-select__label">Поиск</span>
          <input
            type="search"
            className="cb-review-toolbar__input"
            placeholder="Поиск…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            aria-label="Поиск по работам"
          />
        </label>
      </div>

      <CabinetFilterBar
        filters={chipFilters}
        active={filter}
        onChange={(id) => setFilterValue({ tab: id === "inbox" ? null : id })}
      />

      {filter === "groups" ? (
        <div className="cb-review-scope">
          <label className="cb-review-scope__label" htmlFor="review-group-scope">
            Группа
          </label>
          <select
            id="review-group-scope"
            className="cb-review-scope__select"
            value={groupScope}
            onChange={(e) => setFilterValue({ group: e.target.value === "all" ? null : e.target.value })}
          >
            <option value="all">Все группы</option>
            {groupOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      ) : null}

      {error ? (
        <div className="cb-review-error" role="alert">
          <p className="cb-inline-error">Не удалось загрузить работы</p>
          <p className="cabinet-auth-muted">{error}</p>
          <button type="button" className="cb-btn cb-btn--outline" onClick={() => load()}>
            Повторить
          </button>
        </div>
      ) : null}

      {showSkeleton ? (
        <ReviewSkeletonGrid />
      ) : filter === "inbox" ? (
        inboxEmpty ? (
          <CabinetEmptyState
            icon="check"
            title={emptyCopy.title}
            text={emptyCopy.text}
          />
        ) : (
          <div className={`cb-review-inbox${refreshing ? " is-refreshing" : ""}`}>
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
                  onDeleteRequest={requestDelete}
                  onCopyRequest={setCopyTarget}
                />
              ) : (
                <p className="cb-review-inbox__empty">
                  {studentName
                    ? `Работ на проверке нет. Все отправленные работы ученика «${studentName}» уже проверены.`
                    : "Пока нет сданных работ"}
                </p>
              )}
            </section>

          </div>
        )
      ) : filter === "missing" ? (
        unsubmitted.length === 0 ? (
          <CabinetEmptyState
            icon="check"
            title="Нет не сданных заданий"
            text={studentName
              ? `У «${studentName}» нет выданных работ без сдачи.`
              : "Все выданные задания уже сданы или ещё не назначены."}
          />
        ) : (
          <ReviewWorksGrid
            items={unsubmitted}
            deletingId={deletingId}
            onOpen={openItem}
            onDeleteRequest={requestDelete}
            onCopyRequest={setCopyTarget}
          />
        )
      ) : filter === "students" ? (
        <ReviewGroupedSections
          groups={studentGrouped}
          deletingId={deletingId}
          onOpen={openItem}
          onDeleteRequest={requestDelete}
          onCopyRequest={setCopyTarget}
          emptyTitle={emptyCopy.title}
          emptyText={emptyCopy.text}
        />
      ) : filter === "groups" ? (
        <ReviewGroupedSections
          groups={groupGrouped}
          deletingId={deletingId}
          onOpen={openItem}
          onDeleteRequest={requestDelete}
          onCopyRequest={setCopyTarget}
          emptyTitle="Нет работ по группам"
          emptyText="Работы, привязанные к группе, появятся здесь."
        />
      ) : tabItems.length === 0 ? (
        <CabinetEmptyState
          icon="check"
          title={emptyCopy.title}
          text={emptyCopy.text}
        />
      ) : (
        <ReviewWorksGrid
          items={tabItems}
          deletingId={deletingId}
          onOpen={openItem}
          onDeleteRequest={requestDelete}
          onCopyRequest={setCopyTarget}
        />
      )}

      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title="Удалить домашнее задание?"
        text={
          deleteTarget
            ? [
              `Удалить домашнее задание «${deleteTarget.title}»? Это действие нельзя отменить. Работа ученика тоже будет удалена.`,
              deleteError,
            ].filter(Boolean).join(" ")
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
            load({ soft: true });
          }}
        />
      ) : null}
    </CabinetPageShell>
  );
}
