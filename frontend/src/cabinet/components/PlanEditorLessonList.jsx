import { forwardRef, memo, useEffect, useRef, useState } from "react";
import CabinetIcon from "../CabinetIcons";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import PlanEditorResourceBlock from "./PlanEditorResourceBlock";
import { calendarDateKey, formatPlanDateLabel, formatPlanDateNumeric } from "../planDates";
import {
  sessionHomeworkAttachmentRows,
  sessionLessonAttachmentRows,
  sessionListKey,
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

const FocusedDraftInput = forwardRef(function FocusedDraftInput({ value = "", onChange, as = "input", ...props }, ref) {
  const [draft, setDraft] = useState(null);
  const shown = draft == null ? value : draft;
  const Tag = as === "textarea" ? "textarea" : "input";

  return (
    <Tag
      {...props}
      ref={ref}
      value={shown}
      onFocus={(event) => {
        setDraft(value);
        props.onFocus?.(event);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        onChange?.(next);
      }}
      onBlur={(event) => {
        const next = draft == null ? value : draft;
        setDraft(null);
        if (next !== value) onChange?.(next);
        props.onBlur?.(event);
      }}
    />
  );
});

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

export const PlanEditorSessionCard = memo(function PlanEditorSessionCard({
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
    dateLabel ? (dateOverride ? `${dateLabel} · вручную` : dateLabel) : null,
    summary.homework === "есть" ? "ДЗ есть" : "ДЗ нет",
  ].filter(Boolean);

  const openEditor = () => {
    if (!expanded) onToggle(index);
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
          aria-label="Перетащить урок"
          title="Перетащить урок"
          onPointerDown={(event) => onHandlePointerDown(index, event)}
          onClick={(event) => event.stopPropagation()}
        >
          <DragGrip />
        </button>

        <span className="cb-pe-session__num" aria-hidden="true">
          <span className="cb-pe-session__num-prefix">Урок </span>
          {index + 1}
        </span>

        <button type="button" className="cb-pe-session__summary" onClick={() => onToggle(index)}>
          <span className="cb-pe-session__kicker">Название</span>
          <strong className="cb-pe-session__title">{displayTitle}</strong>
          {showTopic ? <span className="cb-pe-session__topic">{topicLine}</span> : null}
          {metaParts.length ? (
            <span className="cb-pe-session__meta">{metaParts.join(" · ")}</span>
          ) : null}
        </button>

        <div className="cb-pe-session__tools">
          {expanded ? (
            <button
              type="button"
              className="cb-pe-session__collapse"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(index);
              }}
            >
              Свернуть
            </button>
          ) : null}
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
          <div className="cb-pe-fg">
            <h4 className="cb-pe-fg__title">Основное</h4>
            <div className="cb-pe-session__grid cb-pe-session__grid--2">
              <label className="cb-pe-field">
                <span>Название</span>
                <FocusedDraftInput
                  ref={titleInputRef}
                  value={session.title}
                  onChange={(next) => onChange(index, "title", next)}
                />
              </label>
              <label className="cb-pe-field">
                <span>Дата занятия</span>
                <input
                  type="date"
                  value={dateDraft != null ? dateDraft : (calendarDateKey(session.scheduledDate) || "")}
                  onChange={(e) => {
                    const next = calendarDateKey(e.target.value) || e.target.value;
                    if (onDateChange) onDateChange(index, next);
                    else onChange(index, "scheduledDate", next);
                  }}
                  onInput={(e) => {
                    const next = calendarDateKey(e.target.value) || e.target.value;
                    if (onDateChange) onDateChange(index, next);
                    else onChange(index, "scheduledDate", next);
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
                ) : (
                  <small className="cb-pe-field__hint cb-pe-field__hint--info">
                    Индивидуальная дата. Остальные занятия не сдвинутся.
                  </small>
                )}
              </label>
              <label className="cb-pe-field">
                <span>Тема</span>
                <FocusedDraftInput
                  value={session.topic}
                  onChange={(next) => onChange(index, "topic", next)}
                />
                <small className="cb-pe-field__hint">Тема определяет, в какой группе будет отображаться урок.</small>
              </label>
              <label className="cb-pe-field">
                <span>Подтема</span>
                <FocusedDraftInput
                  value={session.subtopic}
                  onChange={(next) => onChange(index, "subtopic", next)}
                />
              </label>
              <label className="cb-pe-field cb-pe-field--wide">
                <span>№ задания</span>
                <FocusedDraftInput
                  value={session.examTask}
                  onChange={(next) => onChange(index, "examTask", next)}
                />
                <small className="cb-pe-field__hint">Можно указать номер задания экзамена, например 13.</small>
              </label>
            </div>
          </div>

          <div className="cb-pe-fg">
            <h4 className="cb-pe-fg__title">Содержание урока</h4>
            <label className="cb-pe-field cb-pe-field--wide">
              <span>Цель</span>
              <FocusedDraftInput
                as="textarea"
                className="cb-pe-field__compact"
                rows={2}
                value={session.goal}
                onChange={(next) => onChange(index, "goal", next)}
                placeholder="Цель занятия"
              />
            </label>
            <label className="cb-pe-field cb-pe-field--wide">
              <span>План</span>
              <FocusedDraftInput
                as="textarea"
                className="cb-pe-field__compact"
                rows={2}
                value={session.brief}
                onChange={(next) => onChange(index, "brief", next)}
                placeholder="Краткий план"
              />
            </label>
          </div>

          <div className="cb-pe-fg">
            <h4 className="cb-pe-fg__title">Материалы и домашнее задание</h4>
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
                label="Домашнее задание"
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
          </div>

          {attaching ? (
            <p className="cb-pe-session__sync">Сохранение вложений…</p>
          ) : null}

          <div className="cb-pe-fg">
            <h4 className="cb-pe-fg__title">Заметка</h4>
            <label className="cb-pe-field cb-pe-field--wide">
              <span>Комментарий учителя</span>
              <FocusedDraftInput
                value={session.comment}
                onChange={(next) => onChange(index, "comment", next)}
                placeholder="Видно только вам"
              />
            </label>
          </div>

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
              onClick={() => onToggle(index)}
            >
              Свернуть
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
});

export function PlanTopicSection({
  group,
  groupNumber,
  renaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDeleteTopic,
}) {
  const [draft, setDraft] = useState(group.topic);
  const inputRef = useRef(null);
  const committedRef = useRef(false);
  const count = group.indices.length;
  const isMobile = useMediaQuery("(max-width: 640px)");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);

  useEffect(() => {
    if (!renaming) return undefined;
    committedRef.current = false;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [renaming]);

  const commitRename = (nextValue) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommitRename(nextValue);
  };

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
              onBlur={() => commitRename(draft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename(draft);
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  committedRef.current = true;
                  onCancelRename();
                }
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
    </section>
  );
}

function PlanTopicAddButton({ group, onAddLesson }) {
  return (
    <button
      type="button"
      className="cb-pe-topic__add"
      onClick={() => onAddLesson(group.indices[group.indices.length - 1], group.topic)}
    >
      <CabinetIcon name="plus" /> Добавить урок
    </button>
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
  const topicSignature = sessions.map((session) => String(session?.topic || "").trim()).join("\0");
  const topicsCacheRef = useRef({ signature: "", list: [] });
  if (topicsCacheRef.current.signature !== topicSignature) {
    topicsCacheRef.current = { signature: topicSignature, list: uniquePlanTopics(sessions) };
  }
  const topics = topicsCacheRef.current.list;
  const cards = sessions.map((session, index) => (
    <PlanEditorSessionCard
      session={session}
      index={index}
      total={sessions.length}
      expanded={expandedIndex === index}
      topics={topics}
      isDragging={draggingIndex === index}
      isOrigin={draggingIndex === index}
      onToggle={onToggle}
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
      dateOverride={Boolean(
        plannedDates?.[index]
        && calendarDateKey(session.scheduledDate)
        && plannedDates[index] !== calendarDateKey(session.scheduledDate)
        && index > 0
      )}
    />
  ));

  const withDropLine = (index, node) => (
    <div key={sessionListKey(sessions[index], index)} className="cb-pe-session-wrap">
      {dropLineIndex === index ? <div className="cb-pe-drop-line" aria-hidden="true" /> : null}
      {node}
    </div>
  );

  const nodes = [];
  if (showTopics) {
    groups.forEach((group, groupIndex) => {
      nodes.push(
        <PlanTopicSection
          key={`head-${group.id}`}
          group={group}
          groupNumber={groups.slice(0, groupIndex + 1).filter((item) => item.topicKey).length || groupIndex + 1}
          renaming={renamingTopicId === group.id}
          onStartRename={() => onStartRenameTopic(group.id)}
          onCommitRename={(next) => onCommitRenameTopic(group, next)}
          onCancelRename={onCancelRenameTopic}
          onDeleteTopic={onDeleteTopic}
        />,
      );
      group.indices.forEach((index) => {
        nodes.push(withDropLine(index, cards[index]));
      });
      nodes.push(
        <PlanTopicAddButton
          key={`add-${group.id}`}
          group={group}
          onAddLesson={onAddInTopic}
        />,
      );
    });
  } else {
    sessions.forEach((_, index) => {
      nodes.push(withDropLine(index, cards[index]));
    });
  }

  return (
    <div className="cb-pe-sessions" ref={listRef}>
      {nodes}
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
