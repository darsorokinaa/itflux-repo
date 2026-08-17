import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CabinetIcon from "../CabinetIcons";
import BoardLessonBlock from "./BoardLessonBlock";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import { openConnectionCheck, closeConnectionCheck } from "../connectionCheck/openConnectionCheck";
import {
  compactLessonBillingLabel,
  financialStatusMod,
  formatMoney,
} from "../billing/billingFormat";
import {
  fetchStudentSubjects,
  updateScheduleEvent,
  updateScheduleEventContent,
} from "../../utils/cabinetAuth";

function CheckDevicesBtn({ className, label = "Проверить камеру и микрофон", canJoin = false, onJoin }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => openConnectionCheck({ canJoin, onJoin, joinLabel: "Перейти в урок" })}
    >
      {label}
    </button>
  );
}

const RESOURCE_PREVIEW = 2;

function participantInitials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

function resourceIconName(row) {
  const kind = row.kind || "";
  if (kind === "notes") return "note";
  if (kind === "interactive" || kind === "lesson") return "interactives";
  if (kind === "variant" || kind === "task") return "tasks";
  if (kind === "file") return "folder";
  return "book";
}

function resourceCountMeta(count, variant) {
  if (count <= 0) return "";
  if (variant === "homework") {
    if (count === 1) return "1 элемент";
    if (count >= 2 && count <= 4) return `${count} элемента`;
    return `${count} элементов`;
  }
  if (count === 1) return "1 материал";
  if (count >= 2 && count <= 4) return `${count} материала`;
  return `${count} материалов`;
}

export function StatusBadge({ label, mod = "" }) {
  if (!label) return null;
  return (
    <span className={`cb-lesson-card__badge cb-lesson-card__badge--${mod}`}>
      {label}
    </span>
  );
}

function billingBadgeMod(status) {
  const mod = financialStatusMod(status);
  if (mod === "ok") return "ok";
  if (mod === "warn") return "warn";
  if (mod === "alert") return "alert";
  return "muted";
}

function payableBadges(badges = []) {
  return badges.filter((b) => b.is_debt === true);
}

function LessonBillingBlock({
  badges = [],
  isGroup = false,
  onRegisterPayment,
  event,
}) {
  const payable = payableBadges(badges);

  if (!badges.length) {
    return (
      <section className="cb-lesson-card__section cb-lesson-card__section--compact cb-lesson-billing">
        <h3 className="cb-lesson-card__section-title cb-lesson-card__section-title--plain">
          Оплата
        </h3>
        <div className="cb-lesson-billing__empty">
          <p>Статус оплаты появится после окончания урока</p>
        </div>
      </section>
    );
  }

  return (
    <section className="cb-lesson-card__section cb-lesson-card__section--compact cb-lesson-billing">
      <h3 className="cb-lesson-card__section-title cb-lesson-card__section-title--plain">
        Оплата
      </h3>
      <ul className="cb-lesson-billing__list">
        {badges.map((b) => {
          const amount = Number(b.amount || 0);
          const showAmount =
            amount > 0
            && !["paid", "paid_from_package", "not_billable"].includes(b.financial_status);
          return (
            <li key={`${b.student_id}-${b.financial_status}-${b.record_id || ""}`} className="cb-lesson-billing__row">
              <div className="cb-lesson-billing__main">
                {isGroup && b.student_name ? (
                  <span className="cb-lesson-billing__student">{b.student_name}</span>
                ) : null}
                <span className={`pay-event-badge pay-event-badge--${billingBadgeMod(b.financial_status)}`}>
                  {compactLessonBillingLabel(b)}
                </span>
                {showAmount && b.financial_status === "not_charged" ? (
                  <span className="cb-lesson-billing__amount">
                    {formatMoney(amount, b.currency)}
                  </span>
                ) : null}
              </div>
              {b.price_source_label ? (
                <span className="cb-lesson-billing__source">{b.price_source_label}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {payable.length && onRegisterPayment ? (
        <div className="cb-lesson-billing__actions">
          <button
            type="button"
            className="cb-lesson-billing__action cb-lesson-billing__action--primary"
            onClick={() => onRegisterPayment(event, payable)}
          >
            Оплачено
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PassportTimeHero({ dateLabel, timeRange }) {
  const main = [dateLabel, timeRange].filter(Boolean).join(" · ");
  return (
    <div className="cb-lesson-card__passport-time">
      <span className="cb-lesson-card__passport-time-label">Время</span>
      <span className="cb-lesson-card__passport-time-main" title={main}>{main || "—"}</span>
    </div>
  );
}

function PassportMiniCell({ label, value, meta }) {
  const display = meta ? `${value} · ${meta}` : value;
  return (
    <div className="cb-lesson-card__passport-cell">
      <span className="cb-lesson-card__passport-label">{label}</span>
      <span className="cb-lesson-card__passport-value" title={display}>{display}</span>
    </div>
  );
}

function AboutField({ label, value, empty = "Не указан", multiline = false, onEdit = null }) {
  const text = value && String(value).trim() ? String(value).trim() : empty;
  const isEmpty = !value || !String(value).trim();
  return (
    <div className={`cb-lesson-card__about-field${multiline ? " cb-lesson-card__about-field--multiline" : ""}${onEdit ? " cb-lesson-card__about-field--editable" : ""}`}>
      <span className="cb-lesson-card__about-label">{label}</span>
      <span
        className={`cb-lesson-card__about-value${isEmpty ? " is-empty" : ""}${multiline ? " is-multiline" : ""}${onEdit ? " is-clickable" : ""}`}
        title={onEdit ? "Дважды нажмите, чтобы изменить" : undefined}
        onDoubleClick={onEdit || undefined}
      >
        {text}
      </span>
      {onEdit ? (
        <button
          type="button"
          className="cb-lesson-card__about-edit"
          onClick={onEdit}
          aria-label={`Изменить: ${label}`}
          title="Изменить"
        >
          <CabinetIcon name="pencil" />
        </button>
      ) : null}
    </div>
  );
}

function subjectOptionLabel(item) {
  return item?.display_label || item?.subject_label || item?.subject || item?.title || "Предмет";
}

function AboutEditor({
  event,
  topic,
  subtopic,
  subjectLabel,
  courseTitle,
  description,
  onEventUpdated,
}) {
  const [topicDraft, setTopicDraft] = useState(topic || "");
  const [subtopicDraft, setSubtopicDraft] = useState(subtopic || "");
  const [descriptionDraft, setDescriptionDraft] = useState(description || "");
  const [subjectId, setSubjectId] = useState(event.studentSubjectId ? String(event.studentSubjectId) : "");
  const [subjects, setSubjects] = useState([]);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [focusField, setFocusField] = useState(null);
  const topicInputRef = useRef(null);
  const subtopicInputRef = useRef(null);
  const descriptionInputRef = useRef(null);
  const subjectInputRef = useRef(null);
  const savedRef = useRef({
    topic: topic || "",
    subtopic: subtopic || "",
    description: description || "",
    subjectId: event.studentSubjectId ? String(event.studentSubjectId) : "",
  });

  useEffect(() => {
    setEditing(false);
    setFocusField(null);
    setTopicDraft(topic || "");
    setSubtopicDraft(subtopic || "");
    setDescriptionDraft(description || "");
    setSubjectId(event.studentSubjectId ? String(event.studentSubjectId) : "");
    savedRef.current = {
      topic: topic || "",
      subtopic: subtopic || "",
      description: description || "",
      subjectId: event.studentSubjectId ? String(event.studentSubjectId) : "",
    };
    setStatus("");
  }, [event.id]);

  useEffect(() => {
    if (!event.studentId) {
      setSubjects([]);
      return undefined;
    }
    let cancelled = false;
    fetchStudentSubjects(event.studentId)
      .then((data) => {
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : data?.items || [])
          .filter((item) => item.status !== "archived");
        setSubjects(list);
      })
      .catch(() => {
        if (!cancelled) setSubjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [event.studentId]);

  const hasRealPlanLink = Boolean(event.linkedPlanId) && !event.isAutoMaterialsPlan;
  const shouldSyncToPlan = event.planSyncEnabled !== false && (
    hasRealPlanLink || Boolean(event.studentId)
  );

  const startEditing = (field = "topic") => {
    const nextSaved = {
      topic: topic || "",
      subtopic: subtopic || "",
      description: description || "",
      subjectId: event.studentSubjectId ? String(event.studentSubjectId) : "",
    };
    savedRef.current = nextSaved;
    setTopicDraft(nextSaved.topic);
    setSubtopicDraft(nextSaved.subtopic);
    setDescriptionDraft(nextSaved.description);
    setSubjectId(nextSaved.subjectId);
    setStatus("");
    setFocusField(field);
    setEditing(true);
  };

  const cancelEditing = () => {
    setTopicDraft(savedRef.current.topic || "");
    setSubtopicDraft(savedRef.current.subtopic || "");
    setDescriptionDraft(savedRef.current.description || "");
    setSubjectId(savedRef.current.subjectId || "");
    setFocusField(null);
    setStatus("");
    setEditing(false);
  };

  useEffect(() => {
    if (!editing || !focusField) return;
    const map = {
      subject: subjectInputRef,
      topic: topicInputRef,
      subtopic: subtopicInputRef,
      description: descriptionInputRef,
    };
    const el = map[focusField]?.current;
    if (!el) return;
    el.focus();
    if (typeof el.select === "function" && el.tagName === "INPUT") el.select();
  }, [editing, focusField]);

  const saveContent = async (fields) => {
    if (!Object.keys(fields).length) return false;
    const payload = {
      ...fields,
      sync_action: shouldSyncToPlan ? "lesson_and_plan" : "lesson_only",
    };
    let data;
    let savedOnlyOnLesson = false;
    try {
      data = await updateScheduleEventContent(event.id, payload);
    } catch (err) {
      if (err?.status === 409) {
        data = await updateScheduleEventContent(event.id, {
          ...fields,
          sync_action: "lesson_only",
        });
        savedOnlyOnLesson = true;
      } else {
        throw err;
      }
    }
    if (data?.scheduleEvent) onEventUpdated?.(data.scheduleEvent);
    if (fields.topic !== undefined) savedRef.current.topic = fields.topic;
    if (fields.subtopic !== undefined) savedRef.current.subtopic = fields.subtopic;
    if (fields.description !== undefined) savedRef.current.description = fields.description;
    return savedOnlyOnLesson;
  };

  const saveSubject = async (nextId) => {
    if (nextId === savedRef.current.subjectId) return;
    const selected = subjects.find((item) => String(item.id) === nextId);
    await updateScheduleEvent(event.id, {
      student_subject: nextId ? Number(nextId) : null,
      student_subject_id: nextId ? Number(nextId) : null,
      notify_participants: false,
    });
    savedRef.current.subjectId = nextId;
    onEventUpdated?.({
      id: event.id,
      studentSubjectId: nextId ? Number(nextId) : null,
      studentSubjectLabel: selected ? subjectOptionLabel(selected) : "",
    });
  };

  const commitAbout = async () => {
    const topicNext = topicDraft.trim();
    const subtopicNext = subtopicDraft.trim();
    const descriptionNext = descriptionDraft.trim();
    const contentFields = {};
    if (topicNext !== (savedRef.current.topic || "").trim()) contentFields.topic = topicNext;
    if (subtopicNext !== (savedRef.current.subtopic || "").trim()) contentFields.subtopic = subtopicNext;
    if (descriptionNext !== (savedRef.current.description || "").trim()) contentFields.description = descriptionNext;
    const subjectChanged = subjectId !== savedRef.current.subjectId;

    if (!Object.keys(contentFields).length && !subjectChanged) {
      setEditing(false);
      setFocusField(null);
      setStatus("");
      return;
    }

    setSaving(true);
    setStatus("");
    try {
      const savedOnlyOnLesson = Object.keys(contentFields).length
        ? await saveContent(contentFields)
        : false;
      if (subjectChanged) await saveSubject(subjectId);
      setEditing(false);
      setFocusField(null);
      setStatus(savedOnlyOnLesson ? "Сохранено только в занятии" : "Сохранено");
    } catch (err) {
      setStatus(err?.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const handleAboutKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
      return;
    }
    if (e.key === "Enter" && e.target?.tagName === "INPUT") {
      e.preventDefault();
      commitAbout();
    }
  };

  const statusLine = saving ? "Сохранение…" : status;

  return (
    <>
      <div className="cb-lesson-card__section-head">
        <h3 className="cb-lesson-card__section-title cb-lesson-card__section-title--plain">О занятии</h3>
        {!editing ? (
          <button
            type="button"
            className="cb-lesson-card__section-add"
            onClick={() => startEditing("topic")}
          >
            Изменить
          </button>
        ) : null}
      </div>
      {editing ? (
        <div
          className="cb-lesson-card__about cb-lesson-card__about--edit"
          onKeyDown={handleAboutKeyDown}
        >
          <label className="cb-lesson-card__about-field">
            <span className="cb-lesson-card__about-label">Предмет</span>
            {event.studentId ? (
              <select
                ref={subjectInputRef}
                className={`cb-lesson-card__about-input${!subjectId ? " is-empty" : ""}`}
                value={subjectId}
                onChange={(e) => { setSubjectId(e.target.value); setStatus(""); }}
                disabled={saving}
              >
                <option value="">Не указан</option>
                {subjects.length
                  ? subjects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {subjectOptionLabel(item)}
                    </option>
                  ))
                  : subjectId
                    ? <option value={subjectId}>{subjectLabel || "Предмет"}</option>
                    : null}
              </select>
            ) : (
              <span className={`cb-lesson-card__about-value${!subjectLabel ? " is-empty" : ""}`}>
                {subjectLabel || "Не указан"}
              </span>
            )}
          </label>
          <AboutField label="Курс" value={courseTitle} empty="Не указан" />
          <label className="cb-lesson-card__about-field">
            <span className="cb-lesson-card__about-label">Тема</span>
            <input
              ref={topicInputRef}
              type="text"
              className={`cb-lesson-card__about-input${!topicDraft.trim() ? " is-empty" : ""}`}
              value={topicDraft}
              placeholder="Не указана"
              onChange={(e) => { setTopicDraft(e.target.value); setStatus(""); }}
              disabled={saving}
            />
          </label>
          <label className="cb-lesson-card__about-field">
            <span className="cb-lesson-card__about-label">Подтема</span>
            <input
              ref={subtopicInputRef}
              type="text"
              className={`cb-lesson-card__about-input${!subtopicDraft.trim() ? " is-empty" : ""}`}
              value={subtopicDraft}
              placeholder="Не указана"
              onChange={(e) => { setSubtopicDraft(e.target.value); setStatus(""); }}
              disabled={saving}
            />
          </label>
          <label className="cb-lesson-card__about-field cb-lesson-card__about-field--multiline">
            <span className="cb-lesson-card__about-label">Описание</span>
            <textarea
              ref={descriptionInputRef}
              className={`cb-lesson-card__about-input cb-lesson-card__about-textarea${!descriptionDraft.trim() ? " is-empty" : ""}`}
              rows={2}
              value={descriptionDraft}
              placeholder="Описание не добавлено"
              onChange={(e) => { setDescriptionDraft(e.target.value); setStatus(""); }}
              disabled={saving}
            />
          </label>
          <div className="cb-lesson-card__about-actions">
            <button
              type="button"
              className="cb-lesson-card__about-cancel"
              onClick={cancelEditing}
              disabled={saving}
            >
              Отмена
            </button>
            <button
              type="button"
              className="cb-lesson-card__about-save"
              onClick={commitAbout}
              disabled={saving}
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
          </div>
          {statusLine ? (
            <p className="cb-lesson-card__about-status" role="status">{statusLine}</p>
          ) : null}
        </div>
      ) : (
        <div className="cb-lesson-card__about">
          {event.studentId ? (
            <AboutField
              label="Предмет"
              value={subjectLabel}
              empty="Не указан"
              onEdit={() => startEditing("subject")}
            />
          ) : (
            <AboutField label="Предмет" value={subjectLabel} empty="Не указан" />
          )}
          <AboutField label="Курс" value={courseTitle} empty="Не указан" />
          <AboutField
            label="Тема"
            value={topic}
            empty="Не указана"
            onEdit={() => startEditing("topic")}
          />
          <AboutField
            label="Подтема"
            value={subtopic}
            empty="Не указана"
            onEdit={() => startEditing("subtopic")}
          />
          <AboutField
            label="Описание"
            value={description}
            empty="Описание не добавлено"
            multiline
            onEdit={() => startEditing("description")}
          />
          {statusLine ? (
            <p className="cb-lesson-card__about-status" role="status">{statusLine}</p>
          ) : null}
        </div>
      )}
    </>
  );
}

function ParticipantChip({ participant }) {
  const role = participant.roleLabel || participant.name || "Участник";
  return (
    <span className="cb-lesson-card__participant" title={participant.name}>
      <span className="cb-lesson-card__participant-avatar" aria-hidden="true">
        {participantInitials(participant.name)}
      </span>
      <span className="cb-lesson-card__participant-role">{role}</span>
    </span>
  );
}

function ParticipantsRow({ participants }) {
  const list = Array.isArray(participants) ? participants : [];
  if (!list.length) return null;

  const visible = list.slice(0, 2);
  const rest = list.length - visible.length;

  return (
    <div className="cb-lesson-card__participants">
      {visible.map((participant, index) => (
        <ParticipantChip
          key={`${participant.role}-${participant.name}-${index}`}
          participant={participant}
        />
      ))}
      {rest > 0 ? (
        <span className="cb-lesson-card__participant cb-lesson-card__participant--more">
          + ещё {rest}
        </span>
      ) : null}
    </div>
  );
}

function SectionHead({ title, count, variant = "material", onAdd = null, addLabel = "Добавить" }) {
  return (
    <div className="cb-lesson-card__section-head">
      <h3 className="cb-lesson-card__section-title">
        <span className="cb-lesson-card__section-title-text">{title}</span>
        {count > 0 ? (
          <span className={`cb-lesson-card__count-badge cb-lesson-card__count-badge--${variant}`}>
            {count}
          </span>
        ) : null}
      </h3>
      <div className="cb-lesson-card__section-head-aside">
        {count > 0 ? (
          <span className="cb-lesson-card__section-meta">{resourceCountMeta(count, variant)}</span>
        ) : null}
        {onAdd ? (
          <button type="button" className="cb-lesson-card__section-add" onClick={onAdd}>
            {addLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ResourceCard({ row, variant = "material", onRemove = null }) {
  const external = row.url && /^https?:\/\//.test(row.url);
  const isNotes = row.kind === "notes";
  const canRemove = Boolean(onRemove) && !isNotes && (row.materialId || row.interactiveId);
  return (
    <li className={`cb-lesson-card__resource cb-lesson-card__resource--${variant}${isNotes ? " cb-lesson-card__resource--notes" : ""}`}>
      <span className="cb-lesson-card__resource-icon" aria-hidden="true">
        <CabinetIcon name={resourceIconName(row)} />
      </span>
      <div className="cb-lesson-card__resource-body">
        <span className="cb-lesson-card__resource-title" title={row.label}>{row.label}</span>
        {row.typeLabel && !isNotes ? (
          <span className="cb-lesson-card__resource-type">{row.typeLabel}</span>
        ) : null}
        {row.text && isNotes ? (
          <p className="cb-lesson-card__resource-note">{row.text}</p>
        ) : null}
      </div>
      <div className="cb-lesson-card__resource-actions">
        {row.submitted ? (
          <span className="cb-lesson-card__resource-submitted">
            <CabinetIcon name="check" />
            Сдано
          </span>
        ) : row.url ? (
          <a
            href={row.url}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            className="cb-lesson-card__resource-open"
          >
            Открыть
          </a>
        ) : null}
        {canRemove ? (
          <button
            type="button"
            className="cb-lesson-card__resource-remove"
            onClick={() => onRemove(row)}
            aria-label="Убрать из урока"
            title="Убрать из урока"
          >
            <CabinetIcon name="close" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function CollapsibleBlock({ title, count, countVariant, isMobile, children, className = "", onAdd = null, addLabel = "Добавить", forceOpen = false }) {
  const [open, setOpen] = useState(!isMobile || forceOpen);

  useEffect(() => {
    setOpen(!isMobile || forceOpen);
  }, [isMobile, forceOpen]);

  const head = (
    <SectionHead
      title={title}
      count={count}
      variant={countVariant || "material"}
      onAdd={onAdd}
      addLabel={addLabel}
    />
  );

  if (!isMobile) {
    return (
      <section className={`cb-lesson-card__section cb-lesson-card__section--compact ${className}`.trim()}>
        {head}
        {children}
      </section>
    );
  }

  return (
    <section className={`cb-lesson-card__accordion ${className}`.trim()}>
      <div className="cb-lesson-card__accordion-bar">
        <button
          type="button"
          className="cb-lesson-card__accordion-trigger"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className="cb-lesson-card__accordion-trigger-main">
            <span className="cb-lesson-card__section-title-text">{title}</span>
            {count > 0 ? (
              <span className={`cb-lesson-card__count-badge cb-lesson-card__count-badge--${countVariant || "material"}`}>
                {count}
              </span>
            ) : null}
          </span>
          <span className={`cb-lesson-card__accordion-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
        </button>
        {onAdd ? (
          <button
            type="button"
            className="cb-lesson-card__section-add"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            {addLabel}
          </button>
        ) : null}
      </div>
      {open ? <div className="cb-lesson-card__accordion-body">{children}</div> : null}
    </section>
  );
}

function ResourceSection({
  title,
  rows,
  emptyLabel,
  emptyActionLabel,
  onEmptyAction,
  onAdd = null,
  onRemove = null,
  addLabel = "Добавить",
  variant = "material",
  isMobile,
  extra = null,
  /** Не показывать «пусто», если есть доп. контент (например доска) */
  suppressEmpty = false,
  /** Учитывать в бейдже счётчика (например +1 за прикреплённую доску) */
  extraCount = 0,
  highlight = false,
  emptyExtra = null,
  defaultOpen = null,
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, RESOURCE_PREVIEW);
  const hiddenCount = rows.length - RESOURCE_PREVIEW;
  const scrollable = rows.length > RESOURCE_PREVIEW && showAll;
  const totalCount = rows.length + (extraCount > 0 ? extraCount : 0);
  const showEmpty = !rows.length && !suppressEmpty;
  const addHandler = onAdd || onEmptyAction || null;

  const content = (
    <>
      {rows.length ? (
        <>
          <ul
            className={[
              "cb-lesson-card__resources",
              scrollable ? "cb-lesson-card__resources--scroll" : "",
            ].filter(Boolean).join(" ")}
          >
            {visibleRows.map((row) => (
              <ResourceCard key={row.key} row={row} variant={variant} onRemove={onRemove} />
            ))}
          </ul>
          {hiddenCount > 0 && !showAll ? (
            <button
              type="button"
              className="cb-lesson-card__show-more"
              onClick={() => setShowAll(true)}
            >
              Показать ещё ({hiddenCount})
            </button>
          ) : null}
        </>
      ) : showEmpty ? (
        <div className={`cb-lesson-card__empty cb-lesson-card__empty--${variant}${highlight ? " is-highlight" : ""}`}>
          <p>{emptyLabel}</p>
          {addHandler ? (
            <button type="button" className="cb-lesson-card__empty-btn" onClick={addHandler}>
              {emptyActionLabel || addLabel}
            </button>
          ) : null}
          {emptyExtra}
        </div>
      ) : addHandler && !rows.length && !onAdd ? (
        <div className={`cb-lesson-card__empty cb-lesson-card__empty--${variant} cb-lesson-card__empty--compact`}>
          <button type="button" className="cb-lesson-card__empty-btn" onClick={addHandler}>
            {emptyActionLabel || addLabel}
          </button>
        </div>
      ) : null}
      {extra}
    </>
  );

  return (
    <CollapsibleBlock
      title={title}
      count={totalCount}
      countVariant={variant}
      isMobile={isMobile}
      className={`cb-lesson-card__section--${variant}${highlight ? " is-highlight" : ""}`}
      onAdd={addHandler}
      addLabel={addLabel || emptyActionLabel || "Добавить"}
      forceOpen={Boolean(highlight || defaultOpen)}
    >
      {content}
    </CollapsibleBlock>
  );
}

function MoreMenu({ open, onClose, items = [], isMobile, anchorEl }) {
  const regular = items.filter((item) => !item.danger);
  const danger = items.filter((item) => item.danger);
  return (
    <CabinetFloatingMenu
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      className={`cb-lesson-card__menu${isMobile ? " cb-lesson-card__menu--sheet" : ""}`}
      placement={isMobile ? "sheet" : "anchor"}
      width={200}
    >
      {regular.map((item) => (
        <button
          key={item.label}
          type="button"
          className="cb-lesson-card__menu-item"
          role="menuitem"
          onClick={() => {
            onClose();
            item.onClick();
          }}
          >
            {item.label}
          </button>
        ))}
        {danger.length ? <div className="cb-lesson-card__menu-divider" role="separator" /> : null}
        {danger.map((item) => (
          <button
            key={item.label}
            type="button"
            className="cb-lesson-card__menu-item cb-lesson-card__menu-item--danger"
            role="menuitem"
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
    </CabinetFloatingMenu>
  );
}

function ActionBar({
  readOnly,
  studentMode,
  assignmentId,
  isCancelled,
  isDone,
  hasMaterials,
  meetingStatus,
  canConnect,
  footerPrimaryLabel,
  footerPrimaryDisabled,
  journalAvailable,
  starting,
  creating,
  isMobile,
  onOpenLesson,
  onFooterPrimary,
  onEdit,
  onOpenJournal,
  moreItems,
  onCheckDevices,
  showCheckDevices = false,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef(null);

  if (studentMode) {
    return (
      <footer className="cb-lesson-card__footer">
        <div className={`cb-lesson-card__footer-row${isMobile ? " cb-lesson-card__footer-row--mobile" : ""}`}>
          {assignmentId ? (
            <button
              type="button"
              className={`cb-lesson-card__btn cb-lesson-card__btn--primary${isMobile ? " cb-lesson-card__btn--wide" : ""}`}
              onClick={onOpenLesson}
            >
              {isDone && hasMaterials ? "Открыть материалы" : "Открыть урок"}
            </button>
          ) : null}
          {canConnect ? (
            <button
              type="button"
              className="cb-lesson-card__btn cb-lesson-card__btn--secondary"
              onClick={onFooterPrimary}
            >
              Подключиться к уроку
            </button>
          ) : meetingStatus === "scheduled" ? (
            <span className="cb-lesson-card__btn cb-lesson-card__btn--ghost" style={{ cursor: "default" }}>
              Урок ещё не начался
            </span>
          ) : meetingStatus === "finished" || meetingStatus === "cancelled" ? (
            <span className="cb-lesson-card__btn cb-lesson-card__btn--ghost" style={{ cursor: "default" }}>
              {meetingStatus === "cancelled" ? "Урок отменён" : "Урок завершён"}
            </span>
          ) : null}
          {showCheckDevices ? (
            <button
              type="button"
              className="cb-lesson-card__btn cb-lesson-card__btn--ghost"
              onClick={onCheckDevices}
            >
              Проверить связь
            </button>
          ) : null}
        </div>
      </footer>
    );
  }

  if (readOnly) {
    return (
      <footer className="cb-lesson-card__footer">
        <a
          href="https://calendar.yandex.ru/"
          target="_blank"
          rel="noopener noreferrer"
          className="cb-lesson-card__btn cb-lesson-card__btn--primary cb-lesson-card__btn--wide"
        >
          Яндекс Календарь
        </a>
      </footer>
    );
  }

  const primaryBusy = starting || creating;
  const primaryDisabled = Boolean(footerPrimaryDisabled) || primaryBusy;

  return (
    <footer className="cb-lesson-card__footer">
      <div className={`cb-lesson-card__footer-row${isMobile ? " cb-lesson-card__footer-row--mobile" : ""}`}>
        {footerPrimaryLabel ? (
          <button
            type="button"
            className={`cb-lesson-card__btn cb-lesson-card__btn--primary${isMobile ? " cb-lesson-card__btn--wide" : ""}`}
            disabled={primaryDisabled}
            onClick={onFooterPrimary}
          >
            {primaryBusy ? "…" : footerPrimaryLabel}
          </button>
        ) : null}
        {showCheckDevices ? (
          <button
            type="button"
            className="cb-lesson-card__btn cb-lesson-card__btn--ghost"
            onClick={onCheckDevices}
          >
            Проверить камеру и микрофон
          </button>
        ) : null}
        {!isCancelled ? (
          <button
            type="button"
            className="cb-lesson-card__btn cb-lesson-card__btn--secondary"
            disabled={!journalAvailable}
            title={journalAvailable ? "Итоги урока" : "Итоги доступны после завершения урока"}
            onClick={onOpenJournal}
          >
            Итоги урока
          </button>
        ) : null}
        {!isCancelled ? (
          <button type="button" className="cb-lesson-card__btn cb-lesson-card__btn--ghost" onClick={onEdit}>
            Редактировать
          </button>
        ) : null}
        <div className="cb-lesson-card__more-wrap">
          <button
            ref={moreBtnRef}
            type="button"
            className="cb-lesson-card__btn cb-lesson-card__btn--ghost"
            onClick={() => setMoreOpen((value) => !value)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            Ещё
          </button>
          <MoreMenu
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            items={moreItems}
            isMobile={isMobile}
            anchorEl={moreBtnRef.current}
          />
        </div>
      </div>
    </footer>
  );
}

export default function EventDetailCard({
  event,
  isMobile,
  studentMode = false,
  assignmentId = null,
  typeLabel,
  accentColor,
  profileName,
  dateLabel,
  timeRange,
  statusMeta,
  recurring,
  isOnline,
  isCancelled,
  isDone,
  canStart,
  hasLink,
  hasMeetingLinkPending = false,
  canEditLink,
  materials,
  homework,
  planItem,
  hasAbout,
  topic,
  participants,
  participantsFallback,
  shortenMeetingUrl,
  onClose,
  onEdit,
  onOpenLesson,
  onAddMaterials,
  onRemoveMaterial,
  onAddHomework,
  onStart,
  subjectLabel = "",
  courseTitle: courseTitleProp = "",
  description: descriptionProp = "",
  topicPlaceholder = "Тема урока не указана",
  onCreateLink,
  onOpenMeetingPage,
  onRequestDelete,
  onRequestCancel,
  onDuplicate,
  onSaveLink,
  savingLinkId,
  startingId,
  creatingLinkId,
  onRegisterPayment,
  onOpenJournal,
  billingBadges = [],
  highlightMaterials = false,
  onSkipMaterials = null,
  onEventUpdated = null,
}) {
  const [linkDraft, setLinkDraft] = useState(event.link || "");
  const [copied, setCopied] = useState(false);
  const [copyHint, setCopyHint] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [boardPresence, setBoardPresence] = useState({ loading: true, board: null });

  const handleBoardPresenceChange = useCallback((next) => {
    setBoardPresence(next);
  }, []);

  const meetingStatus = event.videoMeeting?.status || null;
  const meetingPageUrl = event.videoMeeting?.pageUrl || event.videoMeeting?.joinUrl || "";
  const isJitsiMeeting = Boolean(event.videoMeeting?.uuid || event.meetingProvider === "jitsi");

  useEffect(() => {
    setLinkDraft(event.link || "");
    setCopied(false);
    setCopyHint("");
  }, [event.id, event.link, meetingPageUrl]);

  const handleCopyLink = async () => {
    const raw = meetingPageUrl || event.link || "";
    if (!raw) return;
    const absolute = raw.startsWith("http") ? raw : `${window.location.origin}${raw}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absolute);
      } else {
        const input = document.createElement("textarea");
        input.value = absolute;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopied(true);
      setCopyHint("Ссылка скопирована");
      window.setTimeout(() => {
        setCopied(false);
        setCopyHint("");
      }, 2000);
    } catch {
      setCopyHint("Не удалось скопировать ссылку");
      window.setTimeout(() => setCopyHint(""), 2500);
    }
  };

  const handleOpenExternalOrMeeting = () => {
    closeConnectionCheck();
    const link = meetingPageUrl || event.link || "";
    const isInternalJitsi = typeof link === "string" && link.startsWith("/cabinet/meetings/");
    if (hasLink && link && !isInternalJitsi && !event.videoMeeting?.uuid) {
      window.open(link, "_blank", "noopener,noreferrer");
      return;
    }
    if (onOpenMeetingPage) {
      onOpenMeetingPage(event);
      return;
    }
    onStart?.(event);
  };

  const canJoinAfterCheck = studentMode
    ? Boolean(hasLink) && meetingStatus === "live"
    : Boolean(isOnline && !isCancelled && meetingStatus !== "finished" && meetingStatus !== "cancelled" && (hasLink || meetingStatus));

  const openDeviceCheck = () => {
    openConnectionCheck({
      canJoin: canJoinAfterCheck,
      joinLabel: "Перейти в урок",
      onJoin: () => {
        if (!canJoinAfterCheck) return;
        handleOpenExternalOrMeeting();
      },
    });
  };

  const lessonTopic = topic?.trim() || "";
  const headerTitle = lessonTopic || topicPlaceholder;
  const subtitle = studentMode
    ? (profileName || "")
    : [typeLabel, profileName].filter(Boolean).join(" · ");

  const courseTitle = (courseTitleProp || "").trim() || "";
  const subject = (subjectLabel || "").trim() || "";
  const description = (descriptionProp || "").trim() || "";
  const subtopic = (planItem?.subtopic || event.subtopic || "").trim() || "";
  const showAbout = true;
  const canEditAbout = !studentMode && !event.readOnly && !isCancelled;

  const participantList = Array.isArray(participants) ? participants : [];
  const participantCount = participantList.length
    ? String(participantList.length)
    : (participantsFallback && participantsFallback !== "—" ? "1" : "—");

  const formatValue = isOnline ? "Онлайн" : "Офлайн";
  const formatMeta = isOnline
    ? (isDone
      ? "Проведено"
      : meetingStatus === "live"
        ? "Идёт сейчас"
        : meetingStatus === "finished"
          ? "Завершён"
          : meetingStatus === "cancelled"
            ? "Отменён"
            : isJitsiMeeting
              ? "Видеокомната"
              : hasLink
                ? "Телемост"
                : (studentMode && hasMeetingLinkPending ? "Скоро" : "Без ссылки"))
    : null;

  const lessonFinished = Boolean(isDone || meetingStatus === "finished");
  const journalAvailable = lessonFinished && !isCancelled;
  const hasAnyMaterials = materials.length > 0 || Boolean(boardPresence.board);
  const openLesson = () => onOpenLesson(Boolean(isDone && hasAnyMaterials));

  let footerPrimaryLabel = "";
  let footerPrimaryDisabled = false;
  if (!studentMode && !isCancelled) {
    footerPrimaryLabel = "Начать урок";
    if (lessonFinished) {
      footerPrimaryDisabled = true;
    }
  }
  const studentCanConnect = studentMode && Boolean(hasLink) && meetingStatus === "live";

  const handleFooterPrimary = () => {
    if (footerPrimaryDisabled) return;
    if (!isOnline) {
      openLesson();
      return;
    }
    if (!studentMode && !meetingStatus && !hasLink) {
      onCreateLink?.(event);
      return;
    }
    handleOpenExternalOrMeeting();
  };

  const showStatusBadge = !studentMode && statusMeta && ["moved", "cancelled", "done"].includes(statusMeta.mod);

  const moreItems = isCancelled
    ? [{ label: "Удалить", danger: true, onClick: onRequestDelete }]
    : [
        { label: "Перенести", onClick: onEdit },
        { label: "Отменить", danger: true, onClick: onRequestCancel },
        { label: "Дублировать", onClick: onDuplicate },
        { label: "Удалить", danger: true, onClick: onRequestDelete },
      ];

  const overlayClass = [
    "cb-sch-overlay",
    "cb-sch-overlay--lesson",
    isMobile ? "cb-sch-overlay--sheet" : "",
  ].filter(Boolean).join(" ");

  const cardClass = [
    "cb-sch-popover",
    "cb-lesson-card",
    !studentMode && statusMeta ? `cb-lesson-card--${statusMeta.mod}` : "",
  ].filter(Boolean).join(" ");

  const handleAddMaterials = () => {
    if (onAddMaterials) {
      onAddMaterials(event);
      return;
    }
    onOpenLesson?.(true);
  };
  const handleAddHomework = () => {
    if (onAddHomework) {
      onAddHomework(event);
      return;
    }
    onOpenLesson?.(true);
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={overlayClass} onClick={onClose} role="presentation">
      <div
        className={cardClass}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="sch-lesson-title"
      >
        <header className="cb-lesson-card__header">
          <div className="cb-lesson-card__header-main">
            <span
              className="cb-lesson-card__type-dot"
              style={{ background: accentColor || "#2563EB" }}
              aria-hidden="true"
            />
            <div className="cb-lesson-card__header-text">
              <h2 id="sch-lesson-title" className="cb-lesson-card__title">{headerTitle}</h2>
              {subtitle ? <p className="cb-lesson-card__subtitle">{subtitle}</p> : null}
              {(showStatusBadge || (!studentMode && (recurring || isOnline))) ? (
                <div className="cb-lesson-card__badges">
                  {showStatusBadge ? (
                    <StatusBadge label={statusMeta.label} mod={statusMeta.mod} />
                  ) : null}
                  {!studentMode && recurring ? <StatusBadge label="Повторяется" mod="recurring" /> : null}
                  {!studentMode && isOnline ? <StatusBadge label="Онлайн" mod="online" /> : null}
                  {!studentMode && (billingBadges || []).slice(0, 2).map((b) => (
                    <span
                      key={`${b.student_id}-${b.financial_status}`}
                      className={`pay-event-badge pay-event-badge--${billingBadgeMod(b.financial_status)}`}
                    >
                      {compactLessonBillingLabel(b)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <button type="button" className="cb-sch-popover__close" onClick={onClose} aria-label="Закрыть">
            <CabinetIcon name="close" />
          </button>
        </header>

        <div className="cb-lesson-card__body">
          <div className="cb-lesson-card__grid">
            <div className="cb-lesson-card__col cb-lesson-card__col--main">
              <div className="cb-lesson-card__passport">
                <PassportTimeHero dateLabel={dateLabel} timeRange={timeRange} />
                <div className="cb-lesson-card__passport-mini">
                  <PassportMiniCell label="Формат" value={formatValue} meta={formatMeta} />
                  <PassportMiniCell label="Тип" value={typeLabel || "—"} />
                  <PassportMiniCell label="Участники" value={participantCount} />
                </div>
              </div>

              {showAbout ? (
                <section className="cb-lesson-card__section cb-lesson-card__section--compact cb-lesson-card__section--about">
                  {canEditAbout ? (
                    <AboutEditor
                      event={event}
                      topic={lessonTopic}
                      subtopic={subtopic}
                      subjectLabel={subject}
                      courseTitle={courseTitle}
                      description={description}
                      onEventUpdated={onEventUpdated}
                    />
                  ) : (
                    <>
                      <h3 className="cb-lesson-card__section-title cb-lesson-card__section-title--plain">О занятии</h3>
                      <div className="cb-lesson-card__about">
                        <AboutField label="Предмет" value={subject} empty="Не указан" />
                        <AboutField label="Курс" value={courseTitle} empty="Не указан" />
                        <AboutField label="Тема" value={lessonTopic} empty="Не указана" />
                        {subtopic ? <AboutField label="Подтема" value={subtopic} /> : null}
                        <AboutField
                          label="Описание"
                          value={description}
                          empty="Описание не добавлено"
                          multiline
                        />
                      </div>
                    </>
                  )}
                </section>
              ) : null}

              <ParticipantsRow participants={participantList} />

              {isOnline ? (
                <section className="cb-lesson-card__meeting-wrap">
                  <h3 className="cb-lesson-card__section-title cb-lesson-card__section-title--plain">Онлайн-встреча</h3>
                  <div className="cb-lesson-card__meeting">
                    {!studentMode && isJitsiMeeting && meetingStatus ? (
                      <>
                        {meetingStatus === "scheduled" || meetingStatus === "live" ? (
                          <p className="cb-lesson-card__meeting-empty" style={{ marginBottom: 8 }}>
                            {meetingStatus === "scheduled" ? "Ссылка создана" : "Идёт сейчас"}
                          </p>
                        ) : null}
                        {meetingStatus === "finished" ? (
                          <p className="cb-lesson-card__meeting-empty">Урок завершён</p>
                        ) : null}
                        {meetingStatus === "cancelled" ? (
                          <p className="cb-lesson-card__meeting-empty">Урок отменён</p>
                        ) : null}
                        {(meetingStatus === "scheduled" || meetingStatus === "live" || meetingStatus === "finished") ? (
                          <>
                            <div className="cb-lesson-card__meeting-info">
                              <span className="cb-lesson-card__meeting-provider">Видеокомната</span>
                              <span className="cb-lesson-card__meeting-url" title={meetingPageUrl || event.link}>
                                {shortenMeetingUrl(meetingPageUrl || event.link)}
                              </span>
                            </div>
                            <div className="cb-lesson-card__meeting-actions">
                              {meetingStatus === "scheduled" ? (
                                <button
                                  type="button"
                                  className="cb-lesson-card__meeting-btn cb-lesson-card__meeting-btn--primary"
                                  disabled={startingId === event.id}
                                  onClick={handleOpenExternalOrMeeting}
                                >
                                  {startingId === event.id ? "…" : "Начать урок"}
                                </button>
                              ) : null}
                              {meetingStatus === "live" ? (
                                <button
                                  type="button"
                                  className="cb-lesson-card__meeting-btn cb-lesson-card__meeting-btn--primary"
                                  disabled={startingId === event.id}
                                  onClick={handleOpenExternalOrMeeting}
                                >
                                  Войти в урок
                                </button>
                              ) : null}
                              {meetingStatus === "finished" ? (
                                <button
                                  type="button"
                                  className="cb-lesson-card__meeting-btn cb-lesson-card__meeting-btn--primary"
                                  onClick={handleOpenExternalOrMeeting}
                                >
                                  Посмотреть аналитику
                                </button>
                              ) : null}
                              <button type="button" className="cb-lesson-card__meeting-btn" onClick={handleCopyLink}>
                                {copied ? "Ссылка скопирована" : "Копировать"}
                              </button>
                              {meetingStatus === "scheduled" || meetingStatus === "live" ? (
                                <CheckDevicesBtn
                                  className="cb-lesson-card__meeting-btn"
                                  canJoin={canJoinAfterCheck}
                                  onJoin={() => handleOpenExternalOrMeeting()}
                                />
                              ) : null}
                              {meetingStatus === "scheduled" ? (
                                <button
                                  type="button"
                                  className="cb-lesson-card__meeting-btn"
                                  onClick={handleOpenExternalOrMeeting}
                                >
                                  Открыть страницу ожидания
                                </button>
                              ) : null}
                            </div>
                            {copyHint ? <p className="cb-lesson-card__meeting-empty">{copyHint}</p> : null}
                          </>
                        ) : null}
                      </>
                    ) : !studentMode && !isJitsiMeeting && hasLink ? (
                      <>
                        <div className="cb-lesson-card__meeting-info">
                          <span className="cb-lesson-card__meeting-provider">Телемост</span>
                          <span className="cb-lesson-card__meeting-url" title={event.link}>
                            {shortenMeetingUrl(event.link)}
                          </span>
                        </div>
                        <div className="cb-lesson-card__meeting-actions">
                          <button
                            type="button"
                            className="cb-lesson-card__meeting-btn cb-lesson-card__meeting-btn--primary"
                            onClick={handleOpenExternalOrMeeting}
                          >
                            Начать
                          </button>
                          <button type="button" className="cb-lesson-card__meeting-btn" onClick={handleCopyLink}>
                            {copied ? "Ссылка скопирована" : "Копировать"}
                          </button>
                          <CheckDevicesBtn
                            className="cb-lesson-card__meeting-btn"
                            canJoin={canJoinAfterCheck}
                            onJoin={() => handleOpenExternalOrMeeting()}
                          />
                        </div>
                      </>
                    ) : studentMode && meetingStatus === "live" && hasLink ? (
                      <div className="cb-lesson-card__meeting-actions">
                        <button
                          type="button"
                          className="cb-lesson-card__meeting-btn cb-lesson-card__meeting-btn--primary"
                          onClick={handleOpenExternalOrMeeting}
                        >
                          Подключиться к уроку
                        </button>
                        <CheckDevicesBtn
                          className="cb-lesson-card__meeting-btn"
                          label="Проверить связь"
                          canJoin
                          onJoin={() => handleOpenExternalOrMeeting()}
                        />
                      </div>
                    ) : studentMode && meetingStatus === "scheduled" ? (
                      <>
                        <p className="cb-lesson-card__meeting-empty">Урок ещё не начался</p>
                        <CheckDevicesBtn
                          className="cb-lesson-card__meeting-btn"
                          label="Проверить связь"
                        />
                      </>
                    ) : studentMode && meetingStatus === "finished" ? (
                      <p className="cb-lesson-card__meeting-empty">Урок завершён</p>
                    ) : studentMode && meetingStatus === "cancelled" ? (
                      <p className="cb-lesson-card__meeting-empty">Урок отменён</p>
                    ) : studentMode && hasMeetingLinkPending && !isDone ? (
                      <>
                        <p className="cb-lesson-card__meeting-empty">
                          Подключение откроется, когда учитель начнёт урок
                        </p>
                        <CheckDevicesBtn
                          className="cb-lesson-card__meeting-btn"
                          label="Проверить связь"
                        />
                      </>
                    ) : !studentMode && !hasLink ? (
                      <>
                        <p className="cb-lesson-card__meeting-empty">Ссылка не создана</p>
                        {canStart ? (
                          <button
                            type="button"
                            className="cb-lesson-card__meeting-btn cb-lesson-card__meeting-btn--primary"
                            disabled={creatingLinkId === event.id}
                            onClick={() => onCreateLink?.(event)}
                          >
                            {creatingLinkId === event.id ? "…" : "Создать ссылку на онлайн-урок"}
                          </button>
                        ) : null}
                        <CheckDevicesBtn className="cb-lesson-card__meeting-btn" />
                        {canEditLink ? (
                          <div className="cb-lesson-card__link-form" style={{ marginTop: 8 }}>
                            <input
                              type="url"
                              value={linkDraft}
                              onChange={(e) => setLinkDraft(e.target.value)}
                              placeholder="или вставьте https://telemost.yandex.ru/j/…"
                              aria-label="Ссылка на встречу"
                            />
                            <button
                              type="button"
                              className="cb-lesson-card__meeting-btn"
                              disabled={savingLinkId === event.id}
                              onClick={() => onSaveLink(event, linkDraft.trim())}
                            >
                              {savingLinkId === event.id ? "…" : "Добавить вручную"}
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {hasAbout ? (
                isMobile ? (
                  <section className="cb-lesson-card__accordion">
                    <button
                      type="button"
                      className="cb-lesson-card__accordion-trigger"
                      onClick={() => setNotesOpen((value) => !value)}
                      aria-expanded={notesOpen}
                    >
                      <span>Заметки</span>
                      <span className={`cb-lesson-card__accordion-chevron${notesOpen ? " is-open" : ""}`} aria-hidden="true" />
                    </button>
                    {notesOpen ? (
                      <div className="cb-lesson-card__accordion-body">
                        <div className="cb-lesson-card__notes">
                          {(planItem?.goal || event.goal) ? (
                            <div className="cb-lesson-card__note">
                              <span className="cb-lesson-card__note-label">Цель</span>
                              <p>{planItem?.goal || event.goal}</p>
                            </div>
                          ) : null}
                          {(planItem?.teacherComment || event.teacherComment) ? (
                            <div className="cb-lesson-card__note">
                              <span className="cb-lesson-card__note-label">Комментарий</span>
                              <p>{planItem?.teacherComment || event.teacherComment}</p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : (
                  <section className="cb-lesson-card__section cb-lesson-card__section--compact cb-lesson-card__section--notes">
                    <h3 className="cb-lesson-card__section-title cb-lesson-card__section-title--plain">Заметки</h3>
                    <div className="cb-lesson-card__notes cb-lesson-card__notes--scroll">
                      {(planItem?.goal || event.goal) ? (
                        <div className="cb-lesson-card__note">
                          <span className="cb-lesson-card__note-label">Цель</span>
                          <p>{planItem?.goal || event.goal}</p>
                        </div>
                      ) : null}
                      {(planItem?.teacherComment || event.teacherComment) ? (
                        <div className="cb-lesson-card__note">
                          <span className="cb-lesson-card__note-label">Комментарий</span>
                          <p>{planItem?.teacherComment || event.teacherComment}</p>
                        </div>
                      ) : null}
                    </div>
                  </section>
                )
              ) : null}
            </div>

            <div className="cb-lesson-card__col cb-lesson-card__col--side">
              <ResourceSection
                title="Материалы занятия"
                rows={materials}
                emptyLabel="Добавьте готовый урок, интерактив, вариант, доску или файл"
                emptyActionLabel="Добавить материал"
                addLabel="Добавить"
                onAdd={event.readOnly || studentMode ? null : handleAddMaterials}
                onRemove={event.readOnly || studentMode ? null : onRemoveMaterial || null}
                variant="material"
                isMobile={isMobile}
                highlight={highlightMaterials && !hasAnyMaterials}
                emptyExtra={
                  !studentMode && !event.readOnly && onSkipMaterials && !hasAnyMaterials ? (
                    <button
                      type="button"
                      className="cb-lesson-card__empty-btn cb-lesson-card__empty-btn--ghost"
                      onClick={onSkipMaterials}
                    >
                      Продолжить без материалов
                    </button>
                  ) : null
                }
                suppressEmpty={
                  boardPresence.loading
                  || Boolean(boardPresence.board)
                }
                extraCount={boardPresence.board ? 1 : 0}
                extra={
                  <BoardLessonBlock
                    embedded
                    scheduleEventId={event.id}
                    lessonId={event.lesson || event.lessonId || null}
                    studentId={event.student || event.studentId || null}
                    groupId={event.group || event.groupId || null}
                    studentMode={studentMode || Boolean(event.readOnly)}
                    onPresenceChange={handleBoardPresenceChange}
                  />
                }
              />

              <ResourceSection
                title="Домашнее задание"
                rows={homework}
                emptyLabel="Домашнее задание не выдано"
                emptyActionLabel="Выдать ДЗ"
                addLabel="Выдать ДЗ"
                onAdd={event.readOnly || studentMode ? null : handleAddHomework}
                onEmptyAction={event.readOnly || studentMode ? null : handleAddHomework}
                variant="homework"
                isMobile={isMobile}
              />

              {!studentMode && !event.readOnly ? (
                <LessonBillingBlock
                  badges={billingBadges}
                  isGroup={Boolean(event.group || event.groupId || event.eventType === "group" || event.eventType === "group_lesson")}
                  event={event}
                  onRegisterPayment={onRegisterPayment}
                />
              ) : null}
            </div>
          </div>
        </div>

        <ActionBar
          readOnly={event.readOnly}
          studentMode={studentMode}
          assignmentId={assignmentId}
          isCancelled={isCancelled}
          isDone={isDone}
          hasMaterials={hasAnyMaterials}
          meetingStatus={meetingStatus}
          canConnect={studentCanConnect}
          footerPrimaryLabel={footerPrimaryLabel}
          footerPrimaryDisabled={footerPrimaryDisabled}
          journalAvailable={journalAvailable}
          starting={startingId === event.id}
          creating={creatingLinkId === event.id}
          isMobile={isMobile}
          onOpenLesson={openLesson}
          onFooterPrimary={handleFooterPrimary}
          onEdit={onEdit}
          onOpenJournal={() => onOpenJournal?.(event)}
          moreItems={moreItems}
          showCheckDevices={Boolean(isOnline && !isCancelled && !isDone)}
          onCheckDevices={openDeviceCheck}
        />
      </div>
    </div>,
    document.body
  );
}
