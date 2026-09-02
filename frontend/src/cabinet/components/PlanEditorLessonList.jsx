import { useEffect, useRef, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import PlanEditorResourceBlock from "./PlanEditorResourceBlock";
import { formatPlanDateLabel, formatPlanDateNumeric } from "../planDates";
import {
  sessionHomeworkAttachmentRows,
  sessionLessonAttachmentRows,
  sessionResourceSummary,
} from "../planEditorSession";
import { lessonsWord, uniquePlanTopics } from "../planEditorGrouping";

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  ));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (event) => setMatches(event.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function DragGrip() {
  return (
    <span className="cb-pe-grip" aria-hidden="true">
      <span /><span /><span /><span /><span /><span />
    </span>
  );
}

function MenuDivider() {
  return <div className="cb-pe-menu__divider" role="separator" />;
}

function SessionActionMenu({
  open,
  anchorEl,
  onClose,
  index,
  total,
  title,
  topics,
  currentTopic,
  onEdit,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onMoveToTopic,
  onDelete,
}) {
  const isMobile = useMediaQuery("(max-width: 640px)");
  const [view, setView] = useState("root");
  const otherTopics = (topics || []).filter((topic) => topic !== currentTopic);
  const menuView = open ? view : "root";

  const run = (action) => {
    setView("root");
    onClose();
    action?.();
  };

  const handleClose = () => {
    setView("root");
    onClose();
  };

  return (
    <CabinetFloatingMenu
      open={open}
      anchorEl={anchorEl}
      onClose={handleClose}
      className={`cb-pe-menu${isMobile ? " cb-pe-menu--sheet" : ""}`}
      placement={isMobile ? "sheet" : "anchor"}
      width={240}
    >
      {isMobile ? (
        <p className="cb-pe-menu__title">
          {menuView === "topics" ? "Переместить в тему" : (title || `Урок ${index + 1}`)}
        </p>
      ) : null}

      {menuView === "topics" ? (
        <>
          {otherTopics.map((topic) => (
            <button
              key={topic}
              type="button"
              role="menuitem"
              className="cb-pe-menu__item"
              onClick={() => run(() => onMoveToTopic(topic))}
            >
              {topic}
            </button>
          ))}
          <button type="button" className="cb-pe-menu__item" onClick={() => setView("root")}>
            Назад
          </button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" className="cb-pe-menu__item" onClick={() => run(onEdit)}>
            Редактировать
          </button>
          <button type="button" role="menuitem" className="cb-pe-menu__item" onClick={() => run(onDuplicate)}>
            Дублировать
          </button>
          <MenuDivider />
          <button
            type="button"
            role="menuitem"
            className="cb-pe-menu__item"
            disabled={index === 0}
            onClick={() => run(onMoveUp)}
          >
            Переместить выше
          </button>
          <button
            type="button"
            role="menuitem"
            className="cb-pe-menu__item"
            disabled={index === total - 1}
            onClick={() => run(onMoveDown)}
          >
            Переместить ниже
          </button>
          {otherTopics.length > 0 ? (
            <button
              type="button"
              role="menuitem"
              className="cb-pe-menu__item"
              onClick={() => setView("topics")}
            >
              Переместить в тему…
            </button>
          ) : null}
          <MenuDivider />
          <button
            type="button"
            role="menuitem"
            className="cb-pe-menu__item cb-pe-menu__item--danger"
            onClick={() => run(onDelete)}
          >
            Удалить
          </button>
        </>
      )}

      {isMobile ? (
        <button type="button" className="cb-pe-menu__item cb-pe-menu__item--cancel" onClick={handleClose}>
          Отмена
        </button>
      ) : null}
    </CabinetFloatingMenu>
  );
}

export function PlanEditorSessionCard({
  session,
  index,
  total,
  expanded,
  topics,
  isDragging,
  isOrigin,
  onToggle,
  onChange,
  onDateChange,
  onRestorePlannedDate,
  onMove,
  onMoveToTopic,
  onDuplicate,
  onOpenPicker,
  onRemoveAttachment,
  onSaveSession,
  onDeleteSession,
  onHandlePointerDown,
  attaching,
  savingSession,
  sessionError,
  dateDraft,
  plannedDate,
  dateOverride,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const titleInputRef = useRef(null);
  const summary = sessionResourceSummary(session);
  const displayTitle = session.title.trim() || session.subtopic.trim() || `Урок ${index + 1}`;
  const topicLine = session.topic.trim();
  const showTopic = Boolean(topicLine) && topicLine !== displayTitle;
  const dateLabel = formatPlanDateLabel(session.scheduledDate);
  const metaParts = [
    dateLabel ? (dateOverride ? `${dateLabel} · изменено вручную` : dateLabel) : null,
    summary.materials > 0 ? `Материалы: ${summary.materials}` : null,
    `ДЗ: ${summary.homework}`,
  ].filter(Boolean);

  const openEditor = () => {
    if (!expanded) onToggle();
    window.requestAnimationFrame(() => titleInputRef.current?.focus());
  };

  return (
    <article
      className={[
        "cb-pe-session",
        expanded ? "is-expanded" : "",
        isDragging ? "is-dragging" : "",
        isOrigin ? "is-origin" : "",
      ].filter(Boolean).join(" ")}
      data-plan-index={index}
      data-plan-topic={topicLine}
    >
      <div className="cb-pe-session__head">
        <button
          type="button"
          className="cb-pe-session__drag"
          aria-label="Изменить порядок урока"
          onPointerDown={(event) => onHandlePointerDown(index, event)}
          onClick={(event) => event.stopPropagation()}
        >
          <DragGrip />
        </button>

        <span className="cb-pe-session__num" aria-hidden="true">{index + 1}</span>

        <button type="button" className="cb-pe-session__summary" onClick={onToggle}>
          <strong className="cb-pe-session__title">{displayTitle}</strong>
          {showTopic ? <span className="cb-pe-session__topic">{topicLine}</span> : null}
          {metaParts.length ? (
            <span className="cb-pe-session__meta">{metaParts.join(" · ")}</span>
          ) : null}
        </button>

        <div className="cb-pe-session__tools">
          <button
            type="button"
            className="cb-pe-session__menu-btn"
            aria-label="Действия урока"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              setMenuAnchor(event.currentTarget);
              setMenuOpen((open) => !open);
            }}
          >
            <CabinetIcon name="more" />
          </button>
          <SessionActionMenu
            open={menuOpen}
            anchorEl={menuAnchor}
            onClose={() => setMenuOpen(false)}
            index={index}
            total={total}
            title={displayTitle}
            topics={topics}
            currentTopic={topicLine}
            onEdit={openEditor}
            onDuplicate={() => onDuplicate(index)}
            onMoveUp={() => onMove(index, -1)}
            onMoveDown={() => onMove(index, 1)}
            onMoveToTopic={(topic) => onMoveToTopic(index, topic)}
            onDelete={() => onDeleteSession(index)}
          />
        </div>
      </div>

      {expanded ? (
        <div className="cb-pe-session__body">
          <div className="cb-pe-session__grid cb-pe-session__grid--2">
            <label className="cb-pe-field">
              <span>Название</span>
              <input
                ref={titleInputRef}
                value={session.title}
                onChange={(e) => onChange(index, "title", e.target.value)}
              />
            </label>
            <label className="cb-pe-field">
              <span>Дата занятия</span>
              <input
                type="date"
                value={dateDraft != null ? dateDraft : (session.scheduledDate || "")}
                onChange={(e) => {
                  if (onDateChange) onDateChange(index, e.target.value);
                  else onChange(index, "scheduledDate", e.target.value);
                }}
              />
              {dateOverride && plannedDate ? (
                <small className="cb-pe-field__hint cb-pe-date-note">
                  Плановая дата: {formatPlanDateNumeric(plannedDate)}
                  {onRestorePlannedDate ? (
                    <button type="button" className="cb-pe-date-note__restore" onClick={() => onRestorePlannedDate(index)}>
                      Вернуть плановую
                    </button>
                  ) : null}
                </small>
              ) : index === 0 ? (
                <small className="cb-pe-field__hint">Можно поставить другую дату — остальные занятия не сдвинутся</small>
              ) : (
                <small className="cb-pe-field__hint">Можно поставить любую дату, даже если она отличается от плана</small>
              )}
            </label>
            <label className="cb-pe-field">
              <span>Тема</span>
              <input value={session.topic} onChange={(e) => onChange(index, "topic", e.target.value)} />
            </label>
            <label className="cb-pe-field">
              <span>Подтема</span>
              <input value={session.subtopic} onChange={(e) => onChange(index, "subtopic", e.target.value)} />
            </label>
            <label className="cb-pe-field">
              <span>№ задания</span>
              <input value={session.examTask} onChange={(e) => onChange(index, "examTask", e.target.value)} />
            </label>
          </div>

          <label className="cb-pe-field cb-pe-field--wide">
            <span>Цель</span>
            <textarea
              className="cb-pe-field__compact"
              rows={2}
              value={session.goal}
              onChange={(e) => onChange(index, "goal", e.target.value)}
              placeholder="Цель занятия"
            />
          </label>

          <label className="cb-pe-field cb-pe-field--wide">
            <span>План</span>
            <textarea
              className="cb-pe-field__compact"
              rows={2}
              value={session.brief}
              onChange={(e) => onChange(index, "brief", e.target.value)}
              placeholder="Краткий план"
            />
          </label>

          <div className="cb-pe-session__resources">
            <PlanEditorResourceBlock
              label="Материалы"
              emptyLabel="Нет материалов"
              actionLabel="Прикрепить"
              rows={sessionLessonAttachmentRows(session)}
              notes={session.materialsNotes}
              notesPlaceholder="Заметки к материалам"
              showNotes={sessionLessonAttachmentRows(session).length > 0 || Boolean(session.materialsNotes?.trim())}
              onNotesChange={(e) => onChange(index, "materialsNotes", e.target.value)}
              onAttach={() => onOpenPicker(index, "lesson")}
              onRemove={(row) => onRemoveAttachment(index, "lesson", row)}
            />
            <PlanEditorResourceBlock
              label="ДЗ"
              emptyLabel="ДЗ не задано"
              actionLabel="Настроить"
              rows={sessionHomeworkAttachmentRows(session)}
              notes={session.homeworkDescription}
              notesPlaceholder="Описание ДЗ"
              alwaysShowNotes
              onNotesChange={(e) => onChange(index, "homeworkDescription", e.target.value)}
              onAttach={() => onOpenPicker(index, "homework")}
              onRemove={(row) => onRemoveAttachment(index, "homework", row)}
            />
          </div>

          {attaching ? (
            <p className="cb-pe-session__sync">Сохранение вложений…</p>
          ) : null}

          <label className="cb-pe-field cb-pe-field--wide">
            <span>Комментарий</span>
            <input value={session.comment} onChange={(e) => onChange(index, "comment", e.target.value)} placeholder="Заметка учителя" />
          </label>

          <div className="cb-pe-session__actions">
            {sessionError ? (
              <p className="cb-pe-session__sync cb-pe-session__sync--error" role="alert">{sessionError}</p>
            ) : null}
            <button
              type="button"
              className="cb-btn cb-btn--primary"
              onClick={() => onSaveSession(index)}
              disabled={savingSession || attaching}
            >
              {savingSession ? "Сохранение…" : "Сохранить"}
            </button>
            <button
              type="button"
              className="cb-btn cb-btn--ghost"
              onClick={onToggle}
            >
              Свернуть
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function PlanTopicSection({
  group,
  groupNumber,
  renaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onAddLesson,
  onDeleteTopic,
  children,
}) {
  const [draft, setDraft] = useState(group.topic);
  const inputRef = useRef(null);
  const count = group.indices.length;
  const isMobile = useMediaQuery("(max-width: 640px)");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const title = group.topic || "Без темы";

  return (
    <section className="cb-pe-topic">
      <header className="cb-pe-topic__head">
        <div className="cb-pe-topic__left">
          {group.topic ? (
            <span className="cb-pe-topic__num">Тема {groupNumber}</span>
          ) : null}
          {renaming ? (
            <input
              ref={inputRef}
              className="cb-pe-topic__input"
              value={draft}
              aria-label="Название темы"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => onCommitRename(draft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCommitRename(draft);
                }
                if (e.key === "Escape") onCancelRename();
              }}
            />
          ) : (
            <h3 className="cb-pe-topic__title">{title}</h3>
          )}
        </div>
        <div className="cb-pe-topic__right">
          <span className="cb-pe-topic__count">{count} {lessonsWord(count)}</span>
          {group.topic ? (
            <>
              <button
                type="button"
                className="cb-pe-session__menu-btn"
                aria-label="Действия темы"
                aria-expanded={menuOpen}
                onClick={(event) => {
                  setMenuAnchor(event.currentTarget);
                  setMenuOpen((open) => !open);
                }}
              >
                <CabinetIcon name="more" />
              </button>
              <CabinetFloatingMenu
                open={menuOpen}
                anchorEl={menuAnchor}
                onClose={() => setMenuOpen(false)}
                className={`cb-pe-menu${isMobile ? " cb-pe-menu--sheet" : ""}`}
                placement={isMobile ? "sheet" : "anchor"}
                width={220}
              >
                {isMobile ? <p className="cb-pe-menu__title">{title}</p> : null}
                <button
                  type="button"
                  role="menuitem"
                  className="cb-pe-menu__item"
                  onClick={() => {
                    setMenuOpen(false);
                    setDraft(group.topic);
                    onStartRename();
                  }}
                >
                  Переименовать
                </button>
                {onDeleteTopic ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="cb-pe-menu__item cb-pe-menu__item--danger"
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteTopic(group);
                    }}
                  >
                    Удалить тему
                  </button>
                ) : null}
                {isMobile ? (
                  <button type="button" className="cb-pe-menu__item cb-pe-menu__item--cancel" onClick={() => setMenuOpen(false)}>
                    Отмена
                  </button>
                ) : null}
              </CabinetFloatingMenu>
            </>
          ) : null}
        </div>
      </header>
      <div className="cb-pe-topic__list">
        {children}
      </div>
      <button
        type="button"
        className="cb-pe-topic__add"
        onClick={() => onAddLesson(group.indices[group.indices.length - 1], group.topic)}
      >
        <CabinetIcon name="plus" /> Добавить урок
      </button>
    </section>
  );
}

export function PlanSessionsList({
  sessions,
  groups,
  showTopics,
  expandedIndex,
  draggingIndex,
  dropLineIndex,
  attachingIndex,
  savingSessionIndex,
  sessionErrors,
  renamingTopicId,
  listRef,
  onToggle,
  onChange,
  onDateChange,
  onRestorePlannedDate,
  onMove,
  onMoveToTopic,
  onDuplicate,
  onOpenPicker,
  onRemoveAttachment,
  onSaveSession,
  onDeleteSession,
  onDeleteTopic,
  onHandlePointerDown,
  onStartRenameTopic,
  onCommitRenameTopic,
  onCancelRenameTopic,
  onAddInTopic,
  dateDraftIndex,
  dateDraftValue,
  plannedDates,
}) {
  const topics = uniquePlanTopics(sessions);
  const cards = sessions.map((session, index) => (
    <PlanEditorSessionCard
      key={session.id ? `item-${session.id}` : `draft-${index}`}
      session={session}
      index={index}
      total={sessions.length}
      expanded={expandedIndex === index}
      topics={topics}
      isDragging={draggingIndex === index}
      isOrigin={draggingIndex === index}
      onToggle={() => onToggle(index)}
      onChange={onChange}
      onDateChange={onDateChange}
      onRestorePlannedDate={onRestorePlannedDate}
      onMove={onMove}
      onMoveToTopic={onMoveToTopic}
      onDuplicate={onDuplicate}
      onOpenPicker={onOpenPicker}
      onRemoveAttachment={onRemoveAttachment}
      onSaveSession={onSaveSession}
      onDeleteSession={onDeleteSession}
      onHandlePointerDown={onHandlePointerDown}
      attaching={attachingIndex === index}
      savingSession={savingSessionIndex === index}
      sessionError={sessionErrors[index]}
      dateDraft={dateDraftIndex === index ? dateDraftValue : null}
      plannedDate={plannedDates?.[index] || ""}
      dateOverride={Boolean(plannedDates?.[index] && session.scheduledDate && plannedDates[index] !== session.scheduledDate && index > 0)}
    />
  ));

  const withDropLine = (index, node) => (
    <div key={`wrap-${index}`} className="cb-pe-session-wrap">
      {dropLineIndex === index ? <div className="cb-pe-drop-line" aria-hidden="true" /> : null}
      {node}
    </div>
  );

  return (
    <div className="cb-pe-sessions" ref={listRef}>
      {showTopics ? groups.map((group, groupIndex) => (
        <PlanTopicSection
          key={group.id}
          group={group}
          groupNumber={groups.slice(0, groupIndex + 1).filter((item) => item.topicKey).length || groupIndex + 1}
          renaming={renamingTopicId === group.id}
          onStartRename={() => onStartRenameTopic(group.id)}
          onCommitRename={(next) => onCommitRenameTopic(group, next)}
          onCancelRename={onCancelRenameTopic}
          onAddLesson={onAddInTopic}
          onDeleteTopic={onDeleteTopic}
        >
          {group.indices.map((index) => withDropLine(index, cards[index]))}
        </PlanTopicSection>
      )) : sessions.map((_, index) => withDropLine(index, cards[index]))}
      {dropLineIndex === sessions.length ? <div className="cb-pe-drop-line" aria-hidden="true" /> : null}
    </div>
  );
}

export function PlanEditorSkeleton() {
  return (
    <div className="cb-pe-skeleton" aria-busy="true" aria-live="polite" aria-label="Загрузка плана">
      <div className="cb-pe-skeleton__header" />
      <div className="cb-pe-skeleton__toolbar" />
      <div className="cb-pe-skeleton__topic" />
      <div className="cb-pe-skeleton__card" />
      <div className="cb-pe-skeleton__card" />
      <div className="cb-pe-skeleton__card" />
    </div>
  );
}
