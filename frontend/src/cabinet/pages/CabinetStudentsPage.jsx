import { useCallback, useEffect, useMemo, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import {
  CabinetPageShell,
  CabinetPageHeader,
  CabinetFilterBar,
  CabinetEmptyState,
  useSoonToast,
} from "../CabinetSectionUi";
import { mapApiGroup, mapApiStudent } from "../cabinetMappers";
import { GroupFormModal, InviteFormModal, StudentFormModal } from "../components/StudentGroupModals";
import PlanAttachModal from "../components/PlanAttachModal";
import LimitBadge from "../components/LimitBadge";
import UpgradeLimitModal from "../components/UpgradeLimitModal";
import CompactUpgradeModal from "../components/CompactUpgradeModal";
import { useSubscription } from "../hooks/useSubscription";
import { useLimitModal } from "../hooks/useLimitModal";
import { mapApiEnrollment } from "../lessonPlansData";
import {
  addStudentToGroup,
  archiveStudent,
  cancelInvitation,
  createGroup,
  createInvitation,
  fetchGroups,
  fetchInvitations,
  fetchPlanEnrollments,
  fetchStudents,
  removeStudentFromGroup,
  updateGroup,
  updateStudent,
} from "../../utils/cabinetAuth";

const INITIAL_STUDENTS = [];
const INITIAL_GROUPS = [];

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
  { id: "groups", label: "Группы" },
  { id: "individual", label: "Индивидуальные" },
];

const INDIVIDUAL_BLOCK_ID = "individual";

const STATUS_LABELS = {
  active: "Активен",
  review: "Работа на проверке",
  warning: "Требует внимания",
};

function studentInitials(name) {
  const parts = name.replace(/\./g, "").trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarTone(student) {
  if (student.subject === "Python") return "py";
  if (student.direction === "ЕГЭ") return "ege";
  return "oge";
}

function matchesFilter(student, filter) {
  if (filter === "all") return true;
  if (filter === "oge") return student.direction === "ОГЭ";
  if (filter === "ege") return student.direction === "ЕГЭ";
  if (filter === "groups") return Boolean(student.groupId);
  if (filter === "individual") return !student.groupId;
  return true;
}

function SummaryMetrics({ students, groups, attentionCount }) {
  const items = [
    { label: "Всего учеников", value: students.length, icon: "students", tone: "brand" },
    { label: "Групп", value: groups.length, icon: "users", tone: "lav" },
    { label: "Индивидуальных", value: students.filter((s) => !s.groupId).length, icon: "user", tone: "success" },
    { label: "Требуют внимания", value: attentionCount, icon: "alert", tone: "warn" },
  ];

  return (
    <div className="cb-students-summary">
      {items.map((item) => (
        <div key={item.label} className="cb-students-summary__card">
          <div className={`cb-students-summary__icon cb-students-summary__icon--${item.tone}`}>
            <CabinetIcon name={item.icon} />
          </div>
          <div className="cb-students-summary__body">
            <span className="cb-students-summary__value">{item.value}</span>
            <span className="cb-students-summary__label">{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatGrade(grade) {
  return `${grade} класс`;
}

function StudentChip({ student, enrollment, dragging, onDragStart, onDragEnd, onOpen, onAttachPlan }) {
  const tone = avatarTone(student);

  return (
    <div
      className={`cb-student-chip${dragging ? " cb-student-chip--dragging" : ""}`}
      draggable
      onDragStart={(e) => onDragStart(e, student.id)}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="cb-student-chip__main" onClick={() => onOpen?.(student)}>
        <span className={`cb-student-chip__avatar cb-student-chip__avatar--${tone}`}>
          {studentInitials(student.name)}
        </span>
        <span className="cb-student-chip__info">
          <span className="cb-student-chip__name-row">
            <span className="cb-student-chip__name">{student.name}</span>
            {student.grade ? (
              <span className="cb-student-chip__grade">{formatGrade(student.grade)}</span>
            ) : null}
          </span>
          <span className="cb-student-chip__meta">
            {student.subject}
            <span className="cb-student-chip__dot">·</span>
            <span className={`cb-student-chip__dir cb-student-chip__dir--${tone}`}>
              {student.direction}
            </span>
          </span>
          {enrollment?.planTitle ? (
            <span className="cb-student-chip__plan" title="План уроков">
              <CabinetIcon name="plan" />
              {enrollment.planTitle}
            </span>
          ) : null}
        </span>
        <span className={`cb-student-chip__status cb-student-chip__status--${student.status}`} title={STATUS_LABELS[student.status]} />
      </button>
      <button
        type="button"
        className="cb-student-chip__plan-btn"
        onClick={() => onAttachPlan?.(student)}
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => e.preventDefault()}
        title={enrollment ? "Сменить план" : "Привязать план"}
        aria-label={enrollment ? "Сменить план" : "Привязать план"}
      >
        <CabinetIcon name="plan" />
      </button>
    </div>
  );
}

function GroupCard({
  group,
  students,
  enrollment,
  isDragOver,
  draggingId,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpenGroup,
  onOpenStudent,
  onEditGroup,
  onInviteGroup,
  onAttachPlan,
  onAttachPlanStudent,
}) {
  const dirClass = group.direction === "ОГЭ" ? "oge" : "ege";

  return (
    <article
      className={`cb-group-card${isDragOver ? " cb-group-card--over" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="cb-group-card__head">
        <div className="cb-group-card__title-wrap">
          <h3 className="cb-group-card__title">{group.name}</h3>
          <p className="cb-group-card__meta">
            {group.subject}
            <span className="cb-group-card__dot">·</span>
            {students.length}
            {" "}
            {students.length === 1 ? "ученик" : students.length < 5 ? "ученика" : "учеников"}
          </p>
        </div>
        <div className="cb-group-card__head-actions">
          <span className={`cb-group-card__badge cb-group-card__badge--${dirClass}`}>
            {group.direction}
          </span>
          <button type="button" className="cb-group-card__menu" onClick={onEditGroup} aria-label="Настройки группы">
            ⋯
          </button>
        </div>
      </div>

      <div className="cb-group-card__plan-block">
        <div className="cb-group-card__plan-head">
          <span className="cb-group-card__plan-label">План уроков</span>
          <button
            type="button"
            className="cb-btn cb-btn--text cb-btn--sm"
            onClick={() => onAttachPlan?.(group)}
          >
            {enrollment ? "Сменить" : "Привязать"}
          </button>
        </div>
        {enrollment?.planTitle ? (
          <p className="cb-group-card__plan-title">{enrollment.planTitle}</p>
        ) : (
          <p className="cb-group-card__plan-empty">План не назначен</p>
        )}
      </div>

      <div className="cb-group-card__progress-block">
        <div className="cb-group-card__progress-head">
          <span>Прогресс</span>
          <strong>{group.progress}%</strong>
        </div>
        <div className="cb-group-card__progress-bar">
          <div className="cb-group-card__progress-fill" style={{ width: `${group.progress}%` }} />
        </div>
        <p className="cb-group-card__activity">
          {group.lastActivity}
          <span className="cb-group-card__dot">·</span>
          {group.nextLesson}
        </p>
      </div>

      <div className="cb-group-card__students">
        {students.length === 0 ? (
          <p className="cb-group-card__empty">Перетащите сюда</p>
        ) : (
          students.map((st) => (
            <StudentChip
              key={st.id}
              student={st}
              enrollment={enrollmentsByStudent[st.id]}
              dragging={draggingId === st.id}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onOpen={() => onOpenStudent(st)}
              onAttachPlan={onAttachPlanStudent}
            />
          ))
        )}
      </div>

      <div className="cb-group-card__actions">
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={onOpenGroup}>
          Открыть группу
        </button>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={onInviteGroup}>
          Пригласить
        </button>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={onOpenGroup}>
          Запланировать урок
        </button>
        <button type="button" className="cb-btn cb-btn--text cb-btn--sm" onClick={onOpenGroup}>
          Выдать задание
        </button>
      </div>
    </article>
  );
}

function AddGroupCard({ onClick }) {
  return (
    <button type="button" className="cb-add-card" onClick={onClick}>
      <span className="cb-add-card__icon"><CabinetIcon name="plus" /></span>
      <span className="cb-add-card__title">Создать группу</span>
    </button>
  );
}

function AddStudentCard({ onClick }) {
  return (
    <button type="button" className="cb-add-card" onClick={onClick}>
      <span className="cb-add-card__icon"><CabinetIcon name="plus" /></span>
      <span className="cb-add-card__title">Пригласить</span>
    </button>
  );
}

function PendingInvitesPanel({ invitations, onCancel }) {
  if (!invitations.length) return null;

  return (
    <section className="cb-students-pending">
      <h2 className="cb-students-panel__title">
        Ожидают регистрации
        <span className="cb-students-col__count">{invitations.length}</span>
      </h2>
      <ul className="cb-students-pending__list">
        {invitations.map((invite) => (
          <li key={invite.id} className="cb-students-pending__item">
            <div>
              <strong>{invite.email || "Ссылка без email"}</strong>
              <span className="cb-students-pending__meta">
                {invite.group_title ? `Группа: ${invite.group_title}` : "Индивидуально"}
                {invite.direction_label ? ` · ${invite.direction_label}` : ""}
              </span>
            </div>
            <button type="button" className="cb-btn cb-btn--text cb-btn--sm" onClick={() => onCancel(invite.id)}>
              Отменить
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StudentsPanel({
  title,
  count,
  isDragOver = false,
  dropHandlers = {},
  children,
  footer,
}) {
  return (
    <section className="cb-students-col">
      <div
        className={`cb-students-panel${isDragOver ? " cb-students-panel--over" : ""}`}
        {...dropHandlers}
      >
        <h2 className="cb-students-panel__title">
          {title}
          <span className="cb-students-col__count">{count}</span>
        </h2>
        <div className="cb-students-panel__body">
          {children}
        </div>
        {footer}
      </div>
    </section>
  );
}

function ColumnEmpty({ title, text, actionLabel, onAction }) {
  return (
    <div className="cb-students-col-empty">
      <h3 className="cb-students-col-empty__title">{title}</h3>
      <p className="cb-students-col-empty__text">{text}</p>
      <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

export default function CabinetStudentsPage() {
  const [filter, setFilter] = useState("all");
  const [students, setStudents] = useState(INITIAL_STUDENTS);
  const [groups, setGroups] = useState(INITIAL_GROUPS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [studentModal, setStudentModal] = useState(null);
  const [inviteModal, setInviteModal] = useState(null);
  const [groupModal, setGroupModal] = useState(null);
  const [invitations, setInvitations] = useState([]);
  // Архив
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivedStudents, setArchivedStudents] = useState([]);
  const [archivedGroups, setArchivedGroups] = useState([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [enrollmentsByStudent, setEnrollmentsByStudent] = useState({});
  const [enrollmentsByGroup, setEnrollmentsByGroup] = useState({});
  const [planAttachModal, setPlanAttachModal] = useState(null);

  const { toast, showToast } = useSoonToast();
  const subscription = useSubscription();
  const { limitModalProps, upgradeModalProps, handleApiLimitError } = useLimitModal(subscription.currentPlan);

  const loadEnrollments = useCallback(async () => {
    try {
      const data = await fetchPlanEnrollments({ status: "active" });
      const byStudent = {};
      const byGroup = {};
      (data || []).forEach((item) => {
        const mapped = mapApiEnrollment(item);
        if (mapped.studentId && !byStudent[mapped.studentId]) {
          byStudent[mapped.studentId] = mapped;
        }
        if (mapped.groupId && !byGroup[mapped.groupId]) {
          byGroup[mapped.groupId] = mapped;
        }
      });
      setEnrollmentsByStudent(byStudent);
      setEnrollmentsByGroup(byGroup);
    } catch {
      setEnrollmentsByStudent({});
      setEnrollmentsByGroup({});
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [studentsData, groupsData, invitesData] = await Promise.all([
        fetchStudents({ status: "active" }),
        fetchGroups({ status: "active" }),
        fetchInvitations({ status: "pending" }),
      ]);
      setStudents((studentsData || []).map(mapApiStudent));
      setGroups((groupsData || []).map(mapApiGroup));
      setInvitations(invitesData || []);
      await loadEnrollments();
    } catch (err) {
      setError(err.message || "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [loadEnrollments]);

  const loadArchive = useCallback(async () => {
    setArchiveLoading(true);
    try {
      const [archivedSt, archivedGr] = await Promise.all([
        fetchStudents({ status: "archived" }),
        fetchGroups({ status: "archived" }),
      ]);
      setArchivedStudents((archivedSt || []).map(mapApiStudent));
      setArchivedGroups((archivedGr || []).map(mapApiGroup));
    } catch {
      // ignore — не критично
    } finally {
      setArchiveLoading(false);
    }
  }, []);

  const toggleArchive = useCallback(() => {
    setArchiveOpen((prev) => {
      if (!prev) loadArchive();
      return !prev;
    });
  }, [loadArchive]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredStudents = useMemo(
    () => students.filter((s) => matchesFilter(s, filter)),
    [students, filter],
  );

  const individualStudents = useMemo(
    () => filteredStudents.filter((s) => !s.groupId),
    [filteredStudents],
  );

  const groupsWithStudents = useMemo(
    () => groups.map((g) => ({
      ...g,
      students: filteredStudents.filter((s) => s.groupId === g.id),
    })),
    [groups, filteredStudents],
  );

  const visibleGroups = useMemo(() => {
    if (filter === "individual") return [];
    if (filter === "all" || filter === "groups") return groupsWithStudents;
    return groupsWithStudents.filter((g) => g.students.length > 0);
  }, [groupsWithStudents, filter]);

  const showGroupsColumn = filter !== "individual";
  const showIndividualColumn = filter !== "groups";
  const singleColumnBoard = !showGroupsColumn || !showIndividualColumn;

  const attentionCount = useMemo(
    () => students.filter((s) => s.needsAttention).length,
    [students],
  );

  const handleDragStart = useCallback((e, studentId) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", studentId);
    setDraggingId(studentId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const moveStudent = useCallback(async (studentId, groupId) => {
    const student = students.find((s) => s.id === studentId);
    if (!student) return;

    const prevGroupId = student.groupId;
    setStudents((prev) => prev.map((s) => (
      s.id === studentId ? { ...s, groupId } : s
    )));

    try {
      if (prevGroupId && prevGroupId !== groupId) {
        await removeStudentFromGroup(prevGroupId, studentId);
      }
      if (groupId) {
        await addStudentToGroup(groupId, studentId);
      } else if (prevGroupId) {
        await removeStudentFromGroup(prevGroupId, studentId);
      }
    } catch (err) {
      setStudents((prev) => prev.map((s) => (
        s.id === studentId ? { ...s, groupId: prevGroupId } : s
      )));
      setError(err.message || "Не удалось переместить ученика");
    }
  }, [students]);

  const handleDropOnGroup = useCallback((e, groupId) => {
    e.preventDefault();
    const studentId = e.dataTransfer.getData("text/plain") || draggingId;
    if (studentId) moveStudent(studentId, groupId);
    setDraggingId(null);
    setDropTarget(null);
  }, [draggingId, moveStudent]);

  const handleDropOnIndividual = useCallback((e) => {
    e.preventDefault();
    const studentId = e.dataTransfer.getData("text/plain") || draggingId;
    if (studentId) moveStudent(studentId, null);
    setDraggingId(null);
    setDropTarget(null);
  }, [draggingId, moveStudent]);

  const makeDropHandlers = useCallback((blockId, onDrop) => ({
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(blockId);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        setDropTarget((t) => (t === blockId ? null : t));
      }
    },
    onDrop,
  }), []);

  const openCreateStudent = () => {
    if (!subscription.loading && !subscription.canCreateStudent) {
      handleApiLimitError({
        code: "STUDENT_LIMIT_REACHED",
        current: subscription.usage.students,
        limit: subscription.limits.students,
        recommended_plan: "repetitor",
      });
      return;
    }
    setInviteModal({ group: null });
  };
  const openInviteToGroup = (group) => setInviteModal({ group });
  const closeInviteModal = () => {
    setInviteModal(null);
    loadData();
  };
  const openEditStudent = (student) => setStudentModal({ mode: "edit", student });
  const closeStudentModal = () => setStudentModal(null);
  const openCreateGroup = () => {
    if (!subscription.loading && !subscription.canCreateGroup) {
      handleApiLimitError({
        code: "GROUP_LIMIT_REACHED",
        current: subscription.usage.groups,
        limit: subscription.limits.groups,
        recommended_plan: "repetitor",
      });
      return;
    }
    setGroupModal({ mode: "create" });
  };
  const openEditGroup = (group) => setGroupModal({ mode: "edit", group });
  const closeGroupModal = () => setGroupModal(null);
  const openAttachPlanForStudent = (student) => {
    setPlanAttachModal({
      type: "student",
      target: student,
      enrollment: enrollmentsByStudent[student.id] || null,
    });
  };
  const openAttachPlanForGroup = (group) => {
    setPlanAttachModal({
      type: "group",
      target: group,
      enrollment: enrollmentsByGroup[group.id] || null,
    });
  };
  const closePlanAttachModal = () => setPlanAttachModal(null);
  const handlePlanAttached = async () => {
    await loadEnrollments();
    showToast("План обновлён");
  };

  const handleSaveStudent = async (payload) => {
    if (studentModal?.mode === "edit" && studentModal.student) {
      await updateStudent(studentModal.student.id, payload);
      showToast("Ученик обновлён");
      closeStudentModal();
      await loadData();
    }
  };

  const handleCreateInvite = async (payload) => {
    try {
      return await createInvitation(payload);
    } catch (err) {
      const handled = handleApiLimitError(err);
      if (handled) return null;
      throw err;
    }
  };

  const handleCancelInvite = async (inviteId) => {
    await cancelInvitation(inviteId);
    showToast("Приглашение отменено");
    await loadData();
  };

  const handleArchiveStudent = async (studentId) => {
    await archiveStudent(studentId);
    showToast("Ученик перенесён в архив");
    closeStudentModal();
    await loadData();
  };

  const handleSaveGroup = async (payload) => {
    try {
      if (groupModal?.mode === "edit" && groupModal.group) {
        await updateGroup(groupModal.group.id, payload);
        showToast("Группа обновлена");
      } else {
        await createGroup(payload);
        showToast("Группа создана");
      }
    } catch (err) {
      const handled = handleApiLimitError(err);
      if (handled) {
        closeGroupModal();
        return;
      }
      showToast(err.message || "Не удалось сохранить группу");
      return;
    }
    closeGroupModal();
    await loadData();
  };

  const handleArchiveGroup = async (groupId) => {
    await updateGroup(groupId, { status: "archived" });
    showToast("Группа перенесена в архив");
    closeGroupModal();
    await loadData();
  };

  const handleRestoreStudent = async (studentId) => {
    try {
      await updateStudent(studentId, { status: "active" });
      showToast("Ученик восстановлен");
      setArchivedStudents((prev) => prev.filter((s) => s.id !== String(studentId)));
      await loadData();
    } catch (err) {
      showToast(err.message || "Не удалось восстановить");
    }
  };

  const handleRestoreGroup = async (groupId) => {
    try {
      await updateGroup(groupId, { status: "active" });
      showToast("Группа восстановлена");
      setArchivedGroups((prev) => prev.filter((g) => g.id !== String(groupId)));
      await loadData();
    } catch (err) {
      showToast(err.message || "Не удалось восстановить");
    }
  };

  if (loading) {
    return (
      <CabinetPageShell className="cb-section--students">
        <p className="cb-loading">Загрузка учеников…</p>
      </CabinetPageShell>
    );
  }

  if (error && students.length === 0 && groups.length === 0) {
    return (
      <CabinetPageShell className="cb-section--students">
        <CabinetEmptyState
          icon="students"
          title="Не удалось загрузить данные"
          text={error}
          actions={[{ label: "Повторить", onClick: loadData }]}
        />
      </CabinetPageShell>
    );
  }

  if (!loading && students.length === 0 && groups.length === 0) {
    return (
      <CabinetPageShell className="cb-section--students">
        {toast}
        <CabinetPageHeader
          title="Ученики"
          actions={[
            { label: "Пригласить", icon: "plus", primary: true, onClick: openCreateStudent },
            { label: "Создать группу", icon: "users", onClick: openCreateGroup },
          ]}
        />
        <CabinetEmptyState
          icon="students"
          title="Учеников пока нет"
          text="Отправьте приглашение или создайте группу."
          actions={[
            { label: "Пригласить", onClick: openCreateStudent },
            { label: "Создать группу", onClick: openCreateGroup },
          ]}
        />
        <PendingInvitesPanel invitations={invitations} onCancel={handleCancelInvite} />
        {inviteModal ? (
          <InviteFormModal
            group={inviteModal.group}
            onClose={closeInviteModal}
            onCreate={handleCreateInvite}
          />
        ) : null}
        {studentModal ? (
          <StudentFormModal
            student={studentModal.mode === "edit" ? studentModal.student : null}
            enrollment={studentModal.mode === "edit" ? enrollmentsByStudent[studentModal.student?.id] : null}
            onClose={closeStudentModal}
            onSave={handleSaveStudent}
            onArchive={studentModal.mode === "edit" ? handleArchiveStudent : null}
            onAttachPlan={studentModal.mode === "edit" ? openAttachPlanForStudent : null}
          />
        ) : null}
        {groupModal ? (
          <GroupFormModal
            group={groupModal.mode === "edit" ? groupModal.group : null}
            enrollment={groupModal.mode === "edit" ? enrollmentsByGroup[groupModal.group?.id] : null}
            onClose={closeGroupModal}
            onSave={handleSaveGroup}
            onArchive={groupModal.mode === "edit" ? handleArchiveGroup : null}
            onAttachPlan={groupModal.mode === "edit" ? openAttachPlanForGroup : null}
          />
        ) : null}
      </CabinetPageShell>
    );
  }

  return (
    <CabinetPageShell className="cb-section--students">
      {toast}
      {limitModalProps && <UpgradeLimitModal {...limitModalProps} />}
      {upgradeModalProps && <CompactUpgradeModal {...upgradeModalProps} />}
      {error ? (
        <p className="cb-inline-error" role="alert">{error}</p>
      ) : null}
      <div className="cb-students-top">
        <CabinetPageHeader
          title="Ученики"
          actions={[
            { label: "Пригласить", icon: "plus", primary: true, onClick: openCreateStudent },
            { label: "Создать группу", icon: "users", onClick: openCreateGroup },
          ]}
        >
          <div className="cb-limit-row">
            <LimitBadge label="Ученики" used={subscription.usage.students} limit={subscription.limits.students} loading={subscription.loading} />
            <LimitBadge label="Группы" used={subscription.usage.groups} limit={subscription.limits.groups} loading={subscription.loading} />
          </div>
        </CabinetPageHeader>
        <SummaryMetrics students={students} groups={groups} attentionCount={attentionCount} />
      </div>

      <PendingInvitesPanel invitations={invitations} onCancel={handleCancelInvite} />

      <div className="cb-students-toolbar">
        <CabinetFilterBar filters={FILTERS} active={filter} onChange={setFilter} />
      </div>

      <div className={`cb-students-board${singleColumnBoard ? " cb-students-board--single" : ""}`}>
        {showGroupsColumn ? (
          <StudentsPanel
            title="Группы"
            count={visibleGroups.length}
            footer={<AddGroupCard onClick={openCreateGroup} />}
          >
            {visibleGroups.length === 0 ? (
              <ColumnEmpty
                title="Групп нет"
                text="Создайте группу для общих уроков."
                actionLabel="Создать группу"
                onAction={openCreateGroup}
              />
            ) : (
              visibleGroups.map((group) => {
                const drop = makeDropHandlers(group.id, (e) => handleDropOnGroup(e, group.id));
                return (
                  <GroupCard
                    key={group.id}
                    group={group}
                    students={group.students}
                    enrollment={enrollmentsByGroup[group.id]}
                    isDragOver={dropTarget === group.id}
                    draggingId={draggingId}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onOpenGroup={() => openEditGroup(group)}
                    onOpenStudent={(st) => openEditStudent(st)}
                    onEditGroup={() => openEditGroup(group)}
                    onInviteGroup={() => openInviteToGroup(group)}
                    onAttachPlan={openAttachPlanForGroup}
                    onAttachPlanStudent={openAttachPlanForStudent}
                    {...drop}
                  />
                );
              })
            )}
          </StudentsPanel>
        ) : null}

        {showIndividualColumn ? (
          <StudentsPanel
            title="Индивидуальные"
            count={individualStudents.length}
            isDragOver={dropTarget === INDIVIDUAL_BLOCK_ID}
            dropHandlers={makeDropHandlers(INDIVIDUAL_BLOCK_ID, handleDropOnIndividual)}
          >
            {individualStudents.length === 0 ? (
              <ColumnEmpty
                title="Нет учеников"
                text="Отправьте приглашение для индивидуальных занятий."
                actionLabel="Пригласить"
                onAction={openCreateStudent}
              />
            ) : (
              <>
                {individualStudents.map((st) => (
                  <StudentChip
                    key={st.id}
                    student={st}
                    enrollment={enrollmentsByStudent[st.id]}
                    dragging={draggingId === st.id}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onOpen={() => openEditStudent(st)}
                    onAttachPlan={openAttachPlanForStudent}
                  />
                ))}
                <AddStudentCard onClick={openCreateStudent} />
              </>
            )}
          </StudentsPanel>
        ) : null}
      </div>

      {studentModal ? (
        <StudentFormModal
          student={studentModal.mode === "edit" ? studentModal.student : null}
          enrollment={studentModal.mode === "edit" ? enrollmentsByStudent[studentModal.student?.id] : null}
          onClose={closeStudentModal}
          onSave={handleSaveStudent}
          onArchive={studentModal.mode === "edit" ? handleArchiveStudent : null}
          onAttachPlan={studentModal.mode === "edit" ? openAttachPlanForStudent : null}
        />
      ) : null}
      {groupModal ? (
        <GroupFormModal
          group={groupModal.mode === "edit" ? groupModal.group : null}
          enrollment={groupModal.mode === "edit" ? enrollmentsByGroup[groupModal.group?.id] : null}
          onClose={closeGroupModal}
          onSave={handleSaveGroup}
          onArchive={groupModal.mode === "edit" ? handleArchiveGroup : null}
          onAttachPlan={groupModal.mode === "edit" ? openAttachPlanForGroup : null}
        />
      ) : null}
      {planAttachModal ? (
        <PlanAttachModal
          targetType={planAttachModal.type}
          target={planAttachModal.target}
          enrollment={planAttachModal.enrollment}
          onClose={closePlanAttachModal}
          onAttached={handlePlanAttached}
        />
      ) : null}
      {inviteModal ? (
        <InviteFormModal
          group={inviteModal.group}
          onClose={closeInviteModal}
          onCreate={handleCreateInvite}
        />
      ) : null}

      <div className="cb-archive-section">
        <button
          type="button"
          className="cb-archive-toggle"
          onClick={toggleArchive}
          aria-expanded={archiveOpen}
        >
          <CabinetIcon name="folder" />
          <span>Архив</span>
          <span className="cb-archive-toggle__arrow" aria-hidden="true">
            {archiveOpen ? "▾" : "▸"}
          </span>
        </button>

        {archiveOpen && (
          <div className="cb-archive-body">
            {archiveLoading ? (
              <p className="cb-archive-empty">Загрузка…</p>
            ) : (
              <>
                {archivedGroups.length > 0 && (
                  <div className="cb-archive-group">
                    <p className="cb-archive-group__title">Группы</p>
                    <div className="cb-archive-list">
                      {archivedGroups.map((g) => (
                        <div key={g.id} className="cb-archive-card cb-archive-card--group">
                          <span className="cb-archive-card__icon" aria-hidden="true">
                            <CabinetIcon name="users" />
                          </span>
                          <span className="cb-archive-card__name">{g.name}</span>
                          <span className="cb-archive-card__meta">{g.direction}</span>
                          <button
                            type="button"
                            className="cb-archive-card__restore"
                            onClick={() => handleRestoreGroup(g.id)}
                          >
                            Восстановить
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {archivedStudents.length > 0 && (
                  <div className="cb-archive-group">
                    <p className="cb-archive-group__title">Ученики</p>
                    <div className="cb-archive-list">
                      {archivedStudents.map((s) => (
                        <div key={s.id} className="cb-archive-card">
                          <span className={`cb-archive-card__avatar cb-archive-card__avatar--${avatarTone(s)}`}>
                            {studentInitials(s.name)}
                          </span>
                          <span className="cb-archive-card__name">{s.name}</span>
                          <span className="cb-archive-card__meta">{s.direction}{s.grade ? ` · ${s.grade} кл` : ""}</span>
                          <button
                            type="button"
                            className="cb-archive-card__restore"
                            onClick={() => handleRestoreStudent(s.id)}
                          >
                            Восстановить
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {archivedStudents.length === 0 && archivedGroups.length === 0 && (
                  <p className="cb-archive-empty">Архив пуст</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </CabinetPageShell>
  );
}
