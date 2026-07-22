import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import ConfirmActionModal from "../components/ConfirmActionModal";
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
import HomeworkAssignModal from "../components/HomeworkAssignModal";
import MaterialsAssignModal from "../components/MaterialsAssignModal";
import LimitBadge from "../components/LimitBadge";
import UpgradeLimitModal from "../components/UpgradeLimitModal";
import CompactUpgradeModal from "../components/CompactUpgradeModal";
import { useSubscription } from "../hooks/useSubscription";
import { useLimitModal } from "../hooks/useLimitModal";
import { mapApiEnrollment } from "../lessonPlansData";
import {
  addStudentToGroup,
  archiveStudent,
  buildInvitationUrl,
  deleteInvitation,
  deleteStudent,
  createGroup,
  createInvitation,
  fetchGroups,
  fetchInvitations,
  fetchPlanEnrollments,
  fetchStudents,
  normalizeCabinetList,
  removeStudentFromGroup,
  restoreStudent,
  updateGroup,
  updateStudent,
} from "../../utils/cabinetAuth";
import "../styles/students.css";

const INITIAL_STUDENTS = [];
const INITIAL_GROUPS = [];
const STUDENTS_PREVIEW = 4;
const INVITES_PAGE_SIZE = 10;

const ACTIVE_FILTERS = [
  { id: "all", label: "Все" },
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
];

const VISIBILITY_STORAGE_KEY = "cabinet-students-section-visibility";

function readSectionVisibility() {
  try {
    const raw = localStorage.getItem(VISIBILITY_STORAGE_KEY);
    if (!raw) return { groups: true, individual: true };
    const parsed = JSON.parse(raw);
    return {
      groups: parsed?.groups !== false,
      individual: parsed?.individual !== false,
    };
  } catch {
    return { groups: true, individual: true };
  }
}

function writeSectionVisibility(next) {
  try {
    localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
}

const INVITE_FILTERS = [
  { id: "all", label: "Все" },
  { id: "pending", label: "Ожидают" },
  { id: "accepted", label: "Приняты" },
  { id: "expired", label: "Истёкшие" },
];

const ARCHIVE_FILTERS = [
  { id: "all", label: "Все" },
  { id: "groups", label: "Группы" },
  { id: "individual", label: "Индивидуальные" },
];

const EXAM_LABELS = {
  none: null,
  oge: "ОГЭ",
  ege: "ЕГЭ",
};

function studentInitials(name) {
  const safe = String(name || "").replace(/\./g, "").trim();
  if (!safe) return "??";
  const parts = safe.split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return safe.slice(0, 2).toUpperCase();
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
  return true;
}

function formatGrade(grade) {
  return grade ? `${grade} класс` : "";
}

function pluralStudents(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ученик`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ученика`;
  return `${n} учеников`;
}

function formatInviteDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function inviteDisplayName(invite) {
  return [invite.first_name, invite.last_name].filter(Boolean).join(" ")
    || invite.email
    || "Без имени";
}

function inviteStatusMeta(invite) {
  if (invite.status === "accepted") return { text: "Принято", mod: "accepted" };
  if (invite.status === "expired") return { text: "Срок истёк", mod: "expired" };
  if (invite.status === "cancelled") return { text: "Отменено", mod: "cancelled" };
  return { text: "Ожидает", mod: "pending" };
}

function studentStatusMeta(student) {
  if (student.raw?.status === "paused" || student.status === "warning") {
    return { text: "На паузе", mod: "paused" };
  }
  if (student.raw?.is_registered) {
    return { text: "Присоединился", mod: "joined" };
  }
  return { text: "Ожидает", mod: "pending" };
}

function groupExamLabel(group) {
  const exam = group.raw?.exam_type;
  if (exam && EXAM_LABELS[exam]) return EXAM_LABELS[exam];
  if (group.direction === "ОГЭ" || group.direction === "ЕГЭ") return group.direction;
  return null;
}

function StuMenu({ items, align = "right", ariaLabel = "Ещё" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!items?.length) return null;

  return (
    <div className={`cb-stu-menu${align === "left" ? " cb-stu-menu--left" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="cb-stu-menu__btn"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => e.preventDefault()}
      >
        ⋯
      </button>
      {open ? (
        <div
          className={`cb-stu-menu__list${align === "left" ? " cb-stu-menu__list--left" : ""}`}
          role="menu"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`cb-stu-menu__item${item.danger ? " cb-stu-menu__item--danger" : ""}`}
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                item.onClick?.();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SummaryMetrics({ students, groups, attentionCount }) {
  const items = [
    { label: "Учеников", value: students.length, icon: "students", tone: "brand" },
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

function StudentRow({
  student,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  menuItems,
  variant = "row",
  showOpenButton = false,
  extraMeta = null,
}) {
  const tone = avatarTone(student);
  const status = studentStatusMeta(student);

  return (
    <div
      className={`cb-student-row${variant === "card" ? " cb-student-row--card" : ""}${dragging ? " cb-student-row--dragging" : ""}`}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart ? (e) => onDragStart(e, student.id) : undefined}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="cb-student-row__main" onClick={() => onOpen?.(student)}>
        <span className={`cb-student-row__avatar cb-student-row__avatar--${tone}`}>
          {studentInitials(student.name)}
        </span>
        <span className="cb-student-row__info">
          <span className="cb-student-row__name-line">
            <span className="cb-student-row__name">{student.name}</span>
            <span className={`cb-student-row__status cb-student-row__status--${status.mod}`}>
              {status.text}
            </span>
          </span>
          <span className="cb-student-row__meta">
            {student.grade ? formatGrade(student.grade) : null}
            {student.grade && (student.subject || student.direction) ? (
              <span className="cb-group-card__dot">·</span>
            ) : null}
            {student.subject || null}
            {(student.subject || student.grade) && student.direction ? (
              <span className="cb-group-card__dot">·</span>
            ) : null}
            {student.direction || null}
          </span>
          {extraMeta ? <span className="cb-student-row__lesson">{extraMeta}</span> : null}
        </span>
      </button>
      <div className="cb-student-row__actions">
        {showOpenButton ? (
          <button
            type="button"
            className="cb-btn cb-btn--outline cb-btn--sm cb-student-row__open"
            onClick={() => onOpen?.(student)}
            onMouseDown={(e) => e.stopPropagation()}
            onDragStart={(e) => e.preventDefault()}
          >
            Открыть
          </button>
        ) : null}
        <StuMenu items={menuItems} ariaLabel="Действия ученика" />
      </div>
    </div>
  );
}

function GroupCard({
  group,
  students,
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
  onScheduleLesson,
  onAssignHomeworkStudent,
  onAssignHomeworkGroup,
  onAssignMaterialsStudent,
  onAssignMaterialsGroup,
  onArchiveGroup,
  onArchiveStudent,
  onDeleteStudent,
}) {
  const [expanded, setExpanded] = useState(false);
  const exam = groupExamLabel(group);
  const visibleStudents = expanded ? students : students.slice(0, STUDENTS_PREVIEW);
  const hiddenCount = Math.max(0, students.length - STUDENTS_PREVIEW);

  const headMenu = [
    { label: "Редактировать", onClick: onEditGroup },
    { label: "Настройки", onClick: onEditGroup },
    { label: "Архивировать", onClick: onArchiveGroup, danger: true },
  ];

  const moreMenu = [
    { label: "Выдать задание", onClick: () => onAssignHomeworkGroup?.(group) },
    { label: "Выдать материалы", onClick: () => onAssignMaterialsGroup?.(group) },
    {
      label: "Журнал группы",
      onClick: () => { window.location.href = `/cabinet/journal?group=${group.id}`; },
    },
    { label: "Настройки", onClick: onEditGroup },
    { label: "Архивировать", onClick: onArchiveGroup, danger: true },
  ];

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
            {group.subject || "Информатика"}
            {exam ? (
              <>
                <span className="cb-group-card__dot">·</span>
                {exam}
              </>
            ) : null}
            <span className="cb-group-card__dot">·</span>
            {pluralStudents(students.length)}
          </p>
        </div>
        <div className="cb-group-card__head-actions">
          <span className="cb-group-card__badge">Активна</span>
          <StuMenu items={headMenu} ariaLabel="Настройки группы" />
        </div>
      </div>

      <div className="cb-group-card__students">
        {students.length === 0 ? (
          <p className="cb-group-card__empty">Перетащите ученика сюда</p>
        ) : (
          <>
            {visibleStudents.map((st) => (
              <StudentRow
                key={st.id}
                student={st}
                dragging={draggingId === st.id}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onOpen={() => onOpenStudent(st)}
                menuItems={[
                  { label: "Открыть", onClick: () => onOpenStudent(st) },
                  { label: "Задать ДЗ", onClick: () => onAssignHomeworkStudent?.(st) },
                  { label: "Материалы", onClick: () => onAssignMaterialsStudent?.(st) },
                  {
                    label: "Успеваемость",
                    onClick: () => { window.location.href = `/cabinet/journal?student=${st.id}`; },
                  },
                  {
                    label: "Архивировать",
                    onClick: () => onArchiveStudent?.(st.id),
                    danger: true,
                  },
                  {
                    label: "Удалить",
                    onClick: () => onDeleteStudent?.(st),
                    danger: true,
                  },
                ]}
              />
            ))}
            {!expanded && hiddenCount > 0 ? (
              <button
                type="button"
                className="cb-group-card__more"
                onClick={() => setExpanded(true)}
              >
                Показать ещё {hiddenCount}
              </button>
            ) : null}
            {expanded && hiddenCount > 0 ? (
              <button
                type="button"
                className="cb-group-card__more"
                onClick={() => setExpanded(false)}
              >
                Свернуть
              </button>
            ) : null}
          </>
        )}
        <button
          type="button"
          className="cb-add-card--compact cb-group-card__add-student"
          onClick={onInviteGroup}
        >
          <span className="cb-add-card__icon"><CabinetIcon name="plus" /></span>
          <span className="cb-add-card__title">Добавить ученика</span>
        </button>
      </div>

      <div className="cb-group-card__actions">
        <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={onOpenGroup}>
          Открыть группу
        </button>
        <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={onScheduleLesson}>
          Запланировать урок
        </button>
        <StuMenu items={moreMenu} ariaLabel="Ещё действия" />
      </div>
    </article>
  );
}

function CompactAddCard({ label, onClick, className = "" }) {
  return (
    <button
      type="button"
      className={["cb-add-card--compact", className].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      <span className="cb-add-card__icon"><CabinetIcon name="plus" /></span>
      <span className="cb-add-card__title">{label}</span>
    </button>
  );
}

function InviteActions({ invite, copiedInviteId, onCopy, onResend, onRenew, onDelete }) {
  if (invite.status === "pending") {
    return (
      <>
        <button
          type="button"
          className="cb-btn cb-btn--outline cb-btn--sm"
          onClick={() => onCopy(invite)}
        >
          {copiedInviteId === invite.id ? "Скопировано" : "Скопировать ссылку"}
        </button>
        <button
          type="button"
          className="cb-btn cb-btn--text cb-btn--sm"
          onClick={() => onResend(invite)}
        >
          Отправить повторно
        </button>
        <StuMenu
          items={[
            { label: "Удалить", onClick: () => onDelete(invite.id), danger: true },
          ]}
        />
      </>
    );
  }
  if (invite.status === "accepted") {
    return (
      <StuMenu
        items={[
          { label: "Удалить", onClick: () => onDelete(invite.id), danger: true },
        ]}
      />
    );
  }
  if (invite.status === "expired") {
    return (
      <>
        <button
          type="button"
          className="cb-btn cb-btn--outline cb-btn--sm"
          onClick={() => onRenew(invite)}
        >
          Создать новую ссылку
        </button>
        <StuMenu
          items={[
            { label: "Удалить", onClick: () => onDelete(invite.id), danger: true },
          ]}
        />
      </>
    );
  }
  return (
    <StuMenu
      items={[
        { label: "Удалить", onClick: () => onDelete(invite.id), danger: true },
      ]}
    />
  );
}

function InvitationsTab({
  invitations,
  filter,
  onFilterChange,
  shownCount,
  onShowMore,
  onCopy,
  onResend,
  onRenew,
  onDelete,
  copiedInviteId,
}) {
  const filtered = useMemo(() => {
    if (filter === "all") {
      return invitations.filter((i) => i.status !== "cancelled");
    }
    return invitations.filter((i) => i.status === filter);
  }, [invitations, filter]);

  const visible = filtered.slice(0, shownCount);
  const remaining = Math.max(0, filtered.length - visible.length);

  return (
    <div className="cb-invites">
      <div className="cb-invites__toolbar">
        <div className="cb-students-filters">
          <CabinetFilterBar filters={INVITE_FILTERS} active={filter} onChange={onFilterChange} />
        </div>
        <p className="cb-invites__count">
          Показано {visible.length} из {filtered.length} приглашений
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="cb-students-empty">
          <h3 className="cb-students-empty__title">Приглашений пока нет</h3>
          <p className="cb-students-empty__text">
            Отправьте приглашение ученику — оно появится в этом списке.
          </p>
        </div>
      ) : (
        <>
          <div className="cb-invites-table-wrap">
            <table className="cb-invites-table">
              <thead>
                <tr>
                  <th>Получатель</th>
                  <th>Тип</th>
                  <th>Группа / направление</th>
                  <th>Статус</th>
                  <th>Дата отправки</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((invite) => {
                  const status = inviteStatusMeta(invite);
                  const name = inviteDisplayName(invite);
                  return (
                    <tr key={invite.id}>
                      <td>
                        <span className="cb-invites-table__name">{name}</span>
                        {invite.email && name !== invite.email ? (
                          <span className="cb-invites-table__meta">{invite.email}</span>
                        ) : null}
                      </td>
                      <td>{invite.group_title ? "Группа" : "Индивидуальный"}</td>
                      <td>
                        {invite.group_title || invite.direction_label || "—"}
                        {invite.grade ? (
                          <span className="cb-invites-table__meta">{invite.grade} кл.</span>
                        ) : null}
                      </td>
                      <td>
                        <span className={`cb-invite-status cb-invite-status--${status.mod}`}>
                          {status.text}
                        </span>
                      </td>
                      <td>{formatInviteDate(invite.created_at)}</td>
                      <td>
                        <div className="cb-invites-table__actions">
                          <InviteActions
                            invite={invite}
                            copiedInviteId={copiedInviteId}
                            onCopy={onCopy}
                            onResend={onResend}
                            onRenew={onRenew}
                            onDelete={onDelete}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="cb-invites-cards">
            {visible.map((invite) => {
              const status = inviteStatusMeta(invite);
              const name = inviteDisplayName(invite);
              return (
                <article key={invite.id} className="cb-invite-card">
                  <div className="cb-invite-card__top">
                    <div>
                      <h3 className="cb-invite-card__name">{name}</h3>
                      <p className="cb-invite-card__meta">
                        {invite.group_title ? `Группа · ${invite.group_title}` : "Индивидуальный"}
                        {invite.direction_label ? ` · ${invite.direction_label}` : ""}
                        {invite.grade ? ` · ${invite.grade} кл.` : ""}
                        {` · ${formatInviteDate(invite.created_at)}`}
                      </p>
                    </div>
                    <span className={`cb-invite-status cb-invite-status--${status.mod}`}>
                      {status.text}
                    </span>
                  </div>
                  <div className="cb-invite-card__actions">
                    <InviteActions
                      invite={invite}
                      copiedInviteId={copiedInviteId}
                      onCopy={onCopy}
                      onResend={onResend}
                      onRenew={onRenew}
                      onDelete={onDelete}
                    />
                  </div>
                </article>
              );
            })}
          </div>

          <div className="cb-invites-footer">
            <p className="cb-invites__count">
              Показано {visible.length} из {filtered.length} приглашений
            </p>
            {remaining > 0 ? (
              <button
                type="button"
                className="cb-btn cb-btn--outline cb-btn--sm"
                onClick={onShowMore}
              >
                Показать ещё {Math.min(remaining, INVITES_PAGE_SIZE)}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function ArchiveTab({
  filter,
  onFilterChange,
  loading,
  archivedGroups,
  archivedStudents,
  onRestoreGroup,
  onRestoreStudent,
  onDeleteStudent,
}) {
  const showGroups = filter === "all" || filter === "groups";
  const showStudents = filter === "all" || filter === "individual";
  const groups = showGroups ? archivedGroups : [];
  const students = showStudents ? archivedStudents : [];
  const isEmpty = !loading && groups.length === 0 && students.length === 0;

  return (
    <div className="cb-archive-panel">
      <div className="cb-students-filters">
        <CabinetFilterBar filters={ARCHIVE_FILTERS} active={filter} onChange={onFilterChange} />
      </div>

      {loading ? (
        <p className="cb-loading">Загрузка архива…</p>
      ) : isEmpty ? (
        <div className="cb-archive-empty">
          <h3 className="cb-archive-empty__title">В архиве пока ничего нет</h3>
          <p className="cb-archive-empty__text">
            Здесь будут отображаться завершённые или скрытые группы и ученики.
          </p>
        </div>
      ) : (
        <div className="cb-archive-list">
          {groups.map((g) => (
            <div key={`g-${g.id}`} className="cb-archive-item">
              <span className="cb-archive-item__icon" aria-hidden="true">
                <CabinetIcon name="users" />
              </span>
              <div className="cb-archive-item__body">
                <p className="cb-archive-item__name">{g.name}</p>
                <p className="cb-archive-item__meta">
                  Группа
                  <span className="cb-group-card__dot">·</span>
                  {g.subject || "Информатика"}
                  {groupExamLabel(g) ? (
                    <>
                      <span className="cb-group-card__dot">·</span>
                      {groupExamLabel(g)}
                    </>
                  ) : null}
                  {g.raw?.updated_at ? (
                    <>
                      <span className="cb-group-card__dot">·</span>
                      Архив: {formatInviteDate(g.raw.updated_at)}
                    </>
                  ) : null}
                </p>
              </div>
              <div className="cb-archive-item__actions">
                <button
                  type="button"
                  className="cb-btn cb-btn--outline cb-btn--sm"
                  onClick={() => onRestoreGroup(g.id)}
                >
                  Восстановить
                </button>
                <StuMenu
                  items={[
                    { label: "Восстановить", onClick: () => onRestoreGroup(g.id) },
                  ]}
                />
              </div>
            </div>
          ))}
          {students.map((s) => (
            <div key={`s-${s.id}`} className="cb-archive-item">
              <span className={`cb-archive-item__avatar cb-archive-item__avatar--${avatarTone(s)}`}>
                {studentInitials(s.name)}
              </span>
              <div className="cb-archive-item__body">
                <p className="cb-archive-item__name">{s.name}</p>
                <p className="cb-archive-item__meta">
                  Индивидуальный
                  <span className="cb-group-card__dot">·</span>
                  {s.subject || "Информатика"}
                  {s.grade ? (
                    <>
                      <span className="cb-group-card__dot">·</span>
                      {formatGrade(s.grade)}
                    </>
                  ) : null}
                  {s.raw?.updated_at ? (
                    <>
                      <span className="cb-group-card__dot">·</span>
                      Архив: {formatInviteDate(s.raw.updated_at)}
                    </>
                  ) : null}
                </p>
              </div>
              <div className="cb-archive-item__actions">
                <button
                  type="button"
                  className="cb-btn cb-btn--outline cb-btn--sm"
                  onClick={() => onRestoreStudent(s.id)}
                >
                  Восстановить
                </button>
                <StuMenu
                  items={[
                    { label: "Восстановить", onClick: () => onRestoreStudent(s.id) },
                    {
                      label: "Удалить навсегда",
                      onClick: () => onDeleteStudent?.(s),
                      danger: true,
                    },
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CabinetStudentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mainTab, setMainTab] = useState("active");
  const [filter, setFilter] = useState("all");
  const [sectionVisibility, setSectionVisibility] = useState(readSectionVisibility);
  const [inviteFilter, setInviteFilter] = useState("all");
  const [archiveFilter, setArchiveFilter] = useState("all");
  const [invitesShown, setInvitesShown] = useState(INVITES_PAGE_SIZE);
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
  const [archivedStudents, setArchivedStudents] = useState([]);
  const [archivedGroups, setArchivedGroups] = useState([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [enrollmentsByStudent, setEnrollmentsByStudent] = useState({});
  const [enrollmentsByGroup, setEnrollmentsByGroup] = useState({});
  const [planAttachModal, setPlanAttachModal] = useState(null);
  const [homeworkAssignModal, setHomeworkAssignModal] = useState(null);
  const [materialsAssignModal, setMaterialsAssignModal] = useState(null);
  const [deleteInviteConfirm, setDeleteInviteConfirm] = useState(null);
  const [archiveConfirm, setArchiveConfirm] = useState(null);
  const [deleteStudentConfirm, setDeleteStudentConfirm] = useState(null);
  const [copiedInviteId, setCopiedInviteId] = useState(null);

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
      const [studentsData, groupsData] = await Promise.all([
        fetchStudents({ status: "active" }),
        fetchGroups({ status: "active" }),
      ]);
      setStudents(normalizeCabinetList(studentsData).map(mapApiStudent));
      setGroups(normalizeCabinetList(groupsData).map(mapApiGroup));

      try {
        const [pendingInvites, acceptedInvites, expiredInvites] = await Promise.all([
          fetchInvitations({ status: "pending" }),
          fetchInvitations({ status: "accepted" }),
          fetchInvitations({ status: "expired" }),
        ]);
        const mergedInvites = [
          ...normalizeCabinetList(pendingInvites),
          ...normalizeCabinetList(acceptedInvites),
          ...normalizeCabinetList(expiredInvites),
        ]
          .filter((inv) => inv && inv.id != null)
          .sort((a, b) => {
            const aTime = Date.parse(a.created_at || "") || 0;
            const bTime = Date.parse(b.created_at || "") || 0;
            return bTime - aTime;
          });
        setInvitations(mergedInvites);
      } catch {
        setInvitations([]);
      }

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
      setArchivedStudents(normalizeCabinetList(archivedSt).map(mapApiStudent));
      setArchivedGroups(normalizeCabinetList(archivedGr).map(mapApiGroup));
    } catch {
      // ignore — не критично
    } finally {
      setArchiveLoaded(true);
      setArchiveLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadArchive();
  }, [loadData, loadArchive]);

  useEffect(() => {
    if (!archiveLoaded) {
      loadArchive();
    }
  }, [archiveLoaded, loadArchive]);

  useEffect(() => {
    setInvitesShown(INVITES_PAGE_SIZE);
  }, [inviteFilter]);

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
    if (!sectionVisibility.groups) return [];
    if (filter === "all") return groupsWithStudents;
    return groupsWithStudents.filter((g) => g.students.length > 0);
  }, [groupsWithStudents, filter, sectionVisibility.groups]);

  const showIndividuals = sectionVisibility.individual;

  const toggleSectionVisibility = useCallback((key) => {
    setSectionVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // Не даём скрыть обе секции сразу — иначе страница пустая без понятного выхода.
      if (!next.groups && !next.individual) {
        return prev;
      }
      writeSectionVisibility(next);
      return next;
    });
  }, []);

  const attentionCount = useMemo(
    () => students.filter((s) => (
      s.needsAttention
      || s.status === "warning"
      || !s.raw?.is_registered
    )).length,
    [students],
  );

  const invitesBadgeCount = useMemo(
    () => invitations.filter((i) => i.status !== "cancelled").length,
    [invitations],
  );

  const archiveCount = archivedStudents.length + archivedGroups.length;

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

  const openCreateStudent = useCallback(() => {
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
  }, [subscription.loading, subscription.canCreateStudent, subscription.usage.students, subscription.limits.students, handleApiLimitError]);

  useEffect(() => {
    if (searchParams.get("invite") === "1" || searchParams.get("openInvite") === "1") {
      openCreateStudent();
      const next = new URLSearchParams(searchParams);
      next.delete("invite");
      next.delete("openInvite");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, openCreateStudent]);

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
  const openAssignHomeworkForStudent = (student) => {
    setHomeworkAssignModal({
      student,
      enrollment: enrollmentsByStudent[student.id] || null,
    });
  };
  const openAssignHomeworkForGroup = (group) => {
    setHomeworkAssignModal({
      group,
      students: group.students || [],
      enrollment: enrollmentsByGroup[group.id] || null,
    });
  };
  const closeHomeworkAssignModal = () => setHomeworkAssignModal(null);
  const handleHomeworkAssigned = async () => {
    showToast("Домашнее задание выдано");
    await loadData();
  };
  const openAssignMaterialsForStudent = (student) => {
    setMaterialsAssignModal({ student });
  };
  const openAssignMaterialsForGroup = (group) => {
    setMaterialsAssignModal({ group });
  };
  const closeMaterialsAssignModal = () => setMaterialsAssignModal(null);
  const handleMaterialsAssigned = async () => {
    showToast("Материалы выданы");
  };
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

  const handleDeleteInvite = (inviteId) => {
    setDeleteInviteConfirm(inviteId);
  };

  const confirmDeleteInvite = async () => {
    const inviteId = deleteInviteConfirm;
    if (!inviteId) return;
    try {
      await deleteInvitation(inviteId);
      showToast("Приглашение удалено");
      await loadData();
    } catch {
      showToast("Не удалось удалить приглашение");
    } finally {
      setDeleteInviteConfirm(null);
    }
  };

  const handleCopyInvite = async (invite) => {
    const inviteUrl = buildInvitationUrl(invite.join_path);
    if (!inviteUrl) return false;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedInviteId(invite.id);
      window.setTimeout(() => {
        setCopiedInviteId((prev) => (prev === invite.id ? null : prev));
      }, 1500);
      return true;
    } catch {
      setCopiedInviteId(null);
      showToast("Не удалось скопировать ссылку");
      return false;
    }
  };

  const handleResendInvite = async (invite) => {
    const ok = await handleCopyInvite(invite);
    if (ok) showToast("Ссылка скопирована — отправьте её ученику повторно");
  };

  const handleRenewInvite = async (invite) => {
    try {
      const created = await createInvitation({
        first_name: invite.first_name || "",
        last_name: invite.last_name || "",
        email: invite.email || "",
        direction: invite.direction || "other",
        grade: invite.grade ?? null,
        group_id: invite.group || null,
        message: invite.message || "",
      });
      if (!created) return;
      showToast("Новая ссылка создана");
      await loadData();
      if (created.join_path) {
        await handleCopyInvite(created);
      }
    } catch (err) {
      const handled = handleApiLimitError(err);
      if (!handled) showToast(err.message || "Не удалось создать ссылку");
    }
  };

  const handleArchiveStudent = async (studentId) => {
    await archiveStudent(studentId);
    showToast("Ученик перенесён в архив");
    closeStudentModal();
    setArchiveLoaded(false);
    await loadData();
  };

  const handleDeleteStudent = async (studentId) => {
    await deleteStudent(studentId);
    showToast("Ученик удалён");
    closeStudentModal();
    setArchivedStudents((prev) => prev.filter((s) => s.id !== String(studentId)));
    setArchiveLoaded(false);
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

  const requestArchiveGroup = (groupId) => setArchiveConfirm({ type: "group", id: groupId });
  const requestArchiveStudent = (studentId) => setArchiveConfirm({ type: "student", id: studentId });
  const requestDeleteStudent = (student) => setDeleteStudentConfirm(student);

  const confirmArchiveAction = async () => {
    const target = archiveConfirm;
    setArchiveConfirm(null);
    if (!target) return;
    if (target.type === "group") {
      await handleArchiveGroup(target.id);
    } else if (target.type === "student") {
      await handleArchiveStudent(target.id);
    }
  };

  const confirmDeleteStudentAction = async () => {
    const target = deleteStudentConfirm;
    setDeleteStudentConfirm(null);
    if (!target?.id) return;
    try {
      await handleDeleteStudent(target.id);
    } catch (err) {
      showToast(err.message || "Не удалось удалить ученика");
    }
  };

  const handleArchiveGroup = async (groupId) => {
    await updateGroup(groupId, { status: "archived" });
    showToast("Группа перенесена в архив");
    closeGroupModal();
    setArchiveLoaded(false);
    await loadData();
  };

  const handleRestoreStudent = async (studentId) => {
    try {
      await restoreStudent(studentId);
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

  const renderModals = () => (
    <>
      {studentModal ? (
        <StudentFormModal
          student={studentModal.mode === "edit" ? studentModal.student : null}
          enrollment={studentModal.mode === "edit" ? enrollmentsByStudent[studentModal.student?.id] : null}
          onClose={closeStudentModal}
          onSave={handleSaveStudent}
          onArchive={studentModal.mode === "edit" ? handleArchiveStudent : null}
          onDelete={studentModal.mode === "edit" ? handleDeleteStudent : null}
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
      {homeworkAssignModal ? (
        <HomeworkAssignModal
          student={homeworkAssignModal.student || null}
          students={homeworkAssignModal.students || null}
          group={homeworkAssignModal.group || null}
          enrollment={homeworkAssignModal.enrollment}
          onClose={closeHomeworkAssignModal}
          onAssigned={handleHomeworkAssigned}
          onAttachPlan={(target) => {
            closeHomeworkAssignModal();
            if (homeworkAssignModal.group) {
              openAttachPlanForGroup(homeworkAssignModal.group);
            } else if (target) {
              openAttachPlanForStudent(target);
            }
          }}
        />
      ) : null}
      {materialsAssignModal ? (
        <MaterialsAssignModal
          student={materialsAssignModal.student || null}
          group={materialsAssignModal.group || null}
          onClose={closeMaterialsAssignModal}
          onAssigned={handleMaterialsAssigned}
        />
      ) : null}
      {inviteModal ? (
        <InviteFormModal
          group={inviteModal.group}
          onClose={closeInviteModal}
          onCreate={handleCreateInvite}
        />
      ) : null}
      <ConfirmActionModal
        open={Boolean(deleteInviteConfirm)}
        title="Удалить приглашение?"
        text="Если ученик ещё не вошёл — его предварительный профиль тоже будет удалён."
        confirmLabel="Удалить"
        danger
        onClose={() => setDeleteInviteConfirm(null)}
        onConfirm={confirmDeleteInvite}
      />
      <ConfirmActionModal
        open={Boolean(archiveConfirm)}
        title={archiveConfirm?.type === "group" ? "Архивировать группу?" : "Архивировать ученика?"}
        text="Элемент можно будет восстановить во вкладке «Архив»."
        confirmLabel="Архивировать"
        danger
        onClose={() => setArchiveConfirm(null)}
        onConfirm={confirmArchiveAction}
      />
      <ConfirmActionModal
        open={Boolean(deleteStudentConfirm)}
        title="Удалить ученика навсегда?"
        text={`Ученик ${deleteStudentConfirm?.name || ""} и все связанные данные будут удалены безвозвратно.`}
        confirmLabel="Удалить навсегда"
        danger
        onClose={() => setDeleteStudentConfirm(null)}
        onConfirm={confirmDeleteStudentAction}
      />
    </>
  );

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

  const hasActiveContent =
    (sectionVisibility.groups && (filter === "all" ? groups.length > 0 : visibleGroups.length > 0))
    || (sectionVisibility.individual && (filter === "all" || individualStudents.length > 0));
  const isBrandNew = students.length === 0 && groups.length === 0;

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

      <div className="cb-students-tabs" role="tablist" aria-label="Разделы учеников">
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "active"}
          className={`cb-students-tabs__btn${mainTab === "active" ? " cb-students-tabs__btn--active" : ""}`}
          onClick={() => setMainTab("active")}
        >
          Активные
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "invites"}
          className={`cb-students-tabs__btn${mainTab === "invites" ? " cb-students-tabs__btn--active" : ""}`}
          onClick={() => setMainTab("invites")}
        >
          Приглашения
          <span className="cb-students-tabs__badge">{invitesBadgeCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "archive"}
          className={`cb-students-tabs__btn${mainTab === "archive" ? " cb-students-tabs__btn--active" : ""}`}
          onClick={() => setMainTab("archive")}
        >
          Архив
          <span className="cb-students-tabs__badge">{archiveCount}</span>
        </button>
      </div>

      {mainTab === "active" ? (
        <>
          <div className="cb-students-filters">
            <CabinetFilterBar filters={ACTIVE_FILTERS} active={filter} onChange={setFilter} />
          </div>

          {isBrandNew ? (
            <div className="cb-students-empty">
              <h3 className="cb-students-empty__title">Учеников пока нет</h3>
              <p className="cb-students-empty__text">
                Отправьте приглашение или создайте группу.
              </p>
              <div className="cb-students-empty__actions">
                <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={openCreateStudent}>
                  Пригласить
                </button>
                <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={openCreateGroup}>
                  Создать группу
                </button>
              </div>
            </div>
          ) : !hasActiveContent ? (
            <div className="cb-students-empty">
              <h3 className="cb-students-empty__title">Ничего не найдено</h3>
              <p className="cb-students-empty__text">Попробуйте изменить фильтр.</p>
            </div>
          ) : (
            <div className={`cb-students-sections${!sectionVisibility.groups || !sectionVisibility.individual ? " cb-students-sections--single" : ""}`}>
              <section
                className={`cb-students-section${!sectionVisibility.groups ? " cb-students-section--collapsed" : ""}`}
                aria-label="Группы"
              >
                <div className="cb-students-section__header">
                  <h2 className="cb-students-section__title">Группы</h2>
                  <button
                    type="button"
                    className="cb-students-section__eye"
                    aria-pressed={!sectionVisibility.groups}
                    aria-label={sectionVisibility.groups ? "Скрыть группы" : "Показать группы"}
                    title={sectionVisibility.groups ? "Скрыть группы" : "Показать группы"}
                    onClick={() => toggleSectionVisibility("groups")}
                    disabled={sectionVisibility.groups && !sectionVisibility.individual}
                  >
                    <CabinetIcon name={sectionVisibility.groups ? "eye" : "eyeOff"} />
                  </button>
                </div>
                {sectionVisibility.groups ? (
                  <>
                    {visibleGroups.length ? (
                      <div className="cb-students-grid cb-students-grid--col">
                        {visibleGroups.map((group) => {
                          const drop = makeDropHandlers(group.id, (e) => handleDropOnGroup(e, group.id));
                          return (
                            <GroupCard
                              key={group.id}
                              group={group}
                              students={group.students}
                              isDragOver={dropTarget === group.id}
                              draggingId={draggingId}
                              onDragStart={handleDragStart}
                              onDragEnd={handleDragEnd}
                              onOpenGroup={() => openEditGroup(group)}
                              onOpenStudent={(st) => openEditStudent(st)}
                              onEditGroup={() => openEditGroup(group)}
                              onInviteGroup={() => openInviteToGroup(group)}
                              onScheduleLesson={() => navigate("/cabinet/schedule", {
                                state: { createWithGroupId: group.id },
                              })}
                              onAssignHomeworkStudent={openAssignHomeworkForStudent}
                              onAssignHomeworkGroup={openAssignHomeworkForGroup}
                              onAssignMaterialsStudent={openAssignMaterialsForStudent}
                              onAssignMaterialsGroup={openAssignMaterialsForGroup}
                              onArchiveGroup={() => requestArchiveGroup(group.id)}
                              onArchiveStudent={requestArchiveStudent}
                              onDeleteStudent={requestDeleteStudent}
                              {...drop}
                            />
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="cb-students-section__actions">
                      <CompactAddCard label="Создать группу" onClick={openCreateGroup} />
                    </div>
                  </>
                ) : null}
              </section>

              <section
                className={`cb-students-section${!showIndividuals ? " cb-students-section--collapsed" : ""}`}
                aria-label="Индивидуальные ученики"
              >
                <div className="cb-students-section__header">
                  <h2 className="cb-students-section__title">Индивидуальные</h2>
                  <button
                    type="button"
                    className="cb-students-section__eye"
                    aria-pressed={!showIndividuals}
                    aria-label={showIndividuals ? "Скрыть индивидуальные" : "Показать индивидуальные"}
                    title={showIndividuals ? "Скрыть индивидуальные" : "Показать индивидуальные"}
                    onClick={() => toggleSectionVisibility("individual")}
                    disabled={showIndividuals && !sectionVisibility.groups}
                  >
                    <CabinetIcon name={showIndividuals ? "eye" : "eyeOff"} />
                  </button>
                </div>
                {showIndividuals ? (
                  <>
                    {individualStudents.length ? (
                      <div className="cb-students-grid cb-students-grid--col">
                        {individualStudents.map((st) => (
                          <StudentRow
                            key={st.id}
                            student={st}
                            variant="card"
                            showOpenButton
                            dragging={draggingId === st.id}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            onOpen={() => openEditStudent(st)}
                            extraMeta={
                              enrollmentsByStudent[st.id]?.planTitle
                                ? `План: ${enrollmentsByStudent[st.id].planTitle}`
                                : "Нет запланированного урока"
                            }
                            menuItems={[
                              { label: "Редактировать", onClick: () => openEditStudent(st) },
                              { label: "Задать ДЗ", onClick: () => openAssignHomeworkForStudent(st) },
                              { label: "Материалы", onClick: () => openAssignMaterialsForStudent(st) },
                              { label: "План уроков", onClick: () => openAttachPlanForStudent(st) },
                              {
                                label: "Успеваемость",
                                onClick: () => { window.location.href = `/cabinet/journal?student=${st.id}`; },
                              },
                              {
                                label: "Архивировать",
                                onClick: () => requestArchiveStudent(st.id),
                                danger: true,
                              },
                              {
                                label: "Удалить",
                                onClick: () => requestDeleteStudent(st),
                                danger: true,
                              },
                            ]}
                          />
                        ))}
                      </div>
                    ) : null}
                    <div className="cb-students-section__actions">
                      <CompactAddCard label="Пригласить ученика" onClick={openCreateStudent} />
                    </div>
                  </>
                ) : null}
              </section>
            </div>
          )}
        </>
      ) : null}

      {mainTab === "invites" ? (
        <InvitationsTab
          invitations={invitations}
          filter={inviteFilter}
          onFilterChange={setInviteFilter}
          shownCount={invitesShown}
          onShowMore={() => setInvitesShown((n) => n + INVITES_PAGE_SIZE)}
          onCopy={async (invite) => {
            const ok = await handleCopyInvite(invite);
            if (ok) showToast("Ссылка скопирована");
          }}
          onResend={handleResendInvite}
          onRenew={handleRenewInvite}
          onDelete={handleDeleteInvite}
          copiedInviteId={copiedInviteId}
        />
      ) : null}

      {mainTab === "archive" ? (
        <ArchiveTab
          filter={archiveFilter}
          onFilterChange={setArchiveFilter}
          loading={archiveLoading}
          archivedGroups={archivedGroups}
          archivedStudents={archivedStudents}
          onRestoreGroup={handleRestoreGroup}
          onRestoreStudent={handleRestoreStudent}
          onDeleteStudent={requestDeleteStudent}
        />
      ) : null}

      {renderModals()}
    </CabinetPageShell>
  );
}
