import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import CabinetModal from "./CabinetModal";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import {
  mapApiPlanItem,
  planExamLabel,
  planSubjectLabel,
} from "../lessonPlansData";
import {
  homeworkResourceRows,
  lessonResourceRows,
} from "../planItemAttachments";
import { fetchLessonPlanItem, updateLessonPlanItem, addLessonPlanItem } from "../../utils/cabinetAuth";

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


function ResourceCard({ row, canEdit, removing, onRemove }) {
  const href = row.url;
  const external = href && /^https?:\/\//.test(href);
  const icon = row.kind === "interactive"
    ? "interactive"
    : row.kind === "variant"
      ? "tasks"
      : row.kind === "file"
        ? "note"
        : row.kind === "library_lesson" || row.kind === "linked_lesson"
          ? "lessons"
          : "note";

  return (
    <article className="cb-lesson-material-card">
      <div className="cb-lesson-material-card__icon" aria-hidden="true">
        <CabinetIcon name={icon} />
      </div>
      <div className="cb-lesson-material-card__body">
        <strong className="cb-lesson-material-card__title">{row.label}</strong>
        {row.typeLabel ? <p className="cb-lesson-material-card__meta">{row.typeLabel}</p> : null}
      </div>
      <div className="cb-lesson-material-card__actions">
        {href ? (
          <a
            href={href}
            className="cb-btn cb-btn--outline cb-btn--sm cb-lesson-material-card__action"
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer" : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            Открыть
          </a>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-btn--sm cb-lesson-material-card__remove"
            onClick={() => onRemove?.(row)}
            disabled={removing}
            aria-label={`Убрать ${row.label}`}
          >
            Убрать
          </button>
        ) : null}
      </div>
    </article>
  );
}

function hasText(value) {
  return Boolean(typeof value === "string" ? value.trim() : value);
}

function CollapsibleText({ text, maxLines = 3 }) {
  const [expanded, setExpanded] = useState(false);
  if (!hasText(text)) return null;

  const long = text.trim().length > 140 || text.trim().split("\n").length > maxLines;

  return (
    <div className={`cb-lesson-text${expanded ? " is-expanded" : ""}`}>
      <p className="cb-lesson-text__content">{text}</p>
      {long ? (
        <button
          type="button"
          className="cb-lesson-text__toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Свернуть" : "Показать полностью"}
        </button>
      ) : null}
    </div>
  );
}

function PassportCell({ label, value }) {
  if (!hasText(value)) return null;
  return (
    <div className="cb-lesson-passport__cell">
      <span className="cb-lesson-passport__label">{label}</span>
      <strong className="cb-lesson-passport__value">{value}</strong>
    </div>
  );
}

function GoalCard({ title, text }) {
  if (!hasText(text)) return null;
  return (
    <article className="cb-lesson-goal-card">
      <h4 className="cb-lesson-goal-card__title">{title}</h4>
      <CollapsibleText text={text} />
    </article>
  );
}

function LessonBlock({ title, children, empty }) {
  if (!children && !empty) return null;
  return (
    <section className="cb-lesson-block">
      <h3 className="cb-lesson-block__title">{title}</h3>
      {children || empty}
    </section>
  );
}


function PlanContent({ text }) {
  if (!hasText(text)) return null;

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const numbered = lines.length > 1 && lines.every((line) => /^\d+[\.\)]\s/.test(line));

  if (numbered) {
    return (
      <ol className="cb-lesson-plan-list">
        {lines.map((line) => (
          <li key={line}>{line.replace(/^\d+[\.\)]\s*/, "")}</li>
        ))}
      </ol>
    );
  }

  return (
    <div className="cb-lesson-plan-card">
      <CollapsibleText text={text} />
    </div>
  );
}

function getPrimaryAction(item) {
  if (item.status === "completed") {
    return { label: "Открыть материалы", mode: "materials" };
  }
  if (item.scheduledEventStartsAt || item.status === "planned") {
    return { label: "Начать урок", mode: "schedule" };
  }
  return { label: "Открыть урок", mode: "open" };
}

export default function PlanItemDetailModal({
  itemId,
  initialItem,
  planId,
  plan,
  canEdit = false,
  initialFocusSection,
  onClose,
  onItemUpdated,
}) {
  const [item, setItem] = useState(initialItem || null);
  const [loading, setLoading] = useState(!initialItem);
  const [moreAnchor, setMoreAnchor] = useState(null);
  const [materialsSaving, setMaterialsSaving] = useState(false);
  const [materialsError, setMaterialsError] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const materialsRef = useRef(null);
  const scrollRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    setLoading(true);
    fetchLessonPlanItem(itemId)
      .then((data) => {
        if (!cancelled) setItem(mapApiPlanItem(data));
      })
      .catch(() => {
        if (!cancelled && initialItem) setItem(initialItem);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [itemId, initialItem]);

  useEffect(() => {
    if (!item || loading || initialFocusSection !== "materials") return undefined;
    const timer = window.setTimeout(() => {
      materialsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [item, loading, initialFocusSection]);

  const subject = planSubjectLabel(plan?.direction);
  const exam = planExamLabel(plan);
  const primaryAction = useMemo(() => (item ? getPrimaryAction(item) : null), [item]);

  const scheduleLabel = useMemo(() => {
    if (!item) return "";
    if (item.scheduledEventStartsAt) return formatDateTime(item.scheduledEventStartsAt);
    if (item.scheduledDate) return item.scheduledDate;
    return "";
  }, [item]);

  const materialsCount = lessonResourceRows(item).length;
  const homeworkResourcesCount = homeworkResourceRows(item).length;
  const hasHomework = hasText(item?.homeworkDescription) || homeworkResourcesCount > 0;
  const hasGoalBlock = hasText(item?.goal) || hasText(item?.plannedResults);
  const hasPlanBlock = hasText(item?.description);
  const hasMaterialsBlock = materialsCount > 0 || hasText(item?.materialsNotes);

  const passportEntries = useMemo(() => ([
    { label: "Предмет", value: subject },
    { label: "Экзамен", value: exam },
    { label: "Тема", value: item?.topic },
    { label: "Подтема", value: item?.subtopic },
    { label: "№ задания", value: item?.taskNumber },
    { label: "Дата и время", value: scheduleLabel },
    { label: "Событие", value: item?.scheduledEventTitle },
  ].filter((entry) => hasText(entry.value))), [item, subject, exam, scheduleLabel]);
  const hasComment = hasText(item?.teacherComment);

  const applyItemUpdate = useCallback((nextItem) => {
    setItem(nextItem);
    onItemUpdated?.(nextItem);
  }, [onItemUpdated]);

  const savePlanItemAttachments = useCallback(async (payload) => {
    setMaterialsSaving(true);
    setMaterialsError("");
    try {
      const data = await updateLessonPlanItem(itemId, payload);
      applyItemUpdate(mapApiPlanItem(data));
    } catch (err) {
      setMaterialsError(err?.message || "Не удалось сохранить материалы");
      throw err;
    } finally {
      setMaterialsSaving(false);
    }
  }, [applyItemUpdate, itemId]);

  const handleRemoveLessonResource = useCallback(async (row) => {
    if (!item) return;
    if (row.materialId) {
      await savePlanItemAttachments({
        material_ids: item.materials.map((entry) => entry.id).filter((id) => id !== row.materialId),
      });
      return;
    }
    if (row.interactiveId) {
      await savePlanItemAttachments({
        interactive_ids: item.attachedInteractives.map((entry) => entry.id).filter((id) => id !== row.interactiveId),
      });
    }
  }, [item, savePlanItemAttachments]);

  const handleRemoveHomeworkResource = useCallback(async (row) => {
    if (!item) return;
    if (row.materialId) {
      await savePlanItemAttachments({
        homework_material_ids: item.homeworkMaterials
          .map((entry) => entry.id)
          .filter((id) => id !== row.materialId),
      });
      return;
    }
    if (row.interactiveId) {
      await savePlanItemAttachments({
        homework_interactive_ids: item.homeworkInteractives
          .map((entry) => entry.id)
          .filter((id) => id !== row.interactiveId),
      });
    }
  }, [item, savePlanItemAttachments]);

  const handlePrimary = () => {
    if (!item || !primaryAction) return;
    if (primaryAction.mode === "materials") {
      materialsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (primaryAction.mode === "schedule") {
      window.location.href = "/cabinet/schedule";
      return;
    }
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleDuplicateItem = async () => {
    if (!item || !planId) return;
    setDuplicating(true);
    setMaterialsError("");
    try {
      await addLessonPlanItem(planId, {
        order: (plan?.items?.length || item.order || 0) + 1,
        title: item.title ? `${item.title} (копия)` : "Новое занятие",
        topic: item.topic,
        subtopic: item.subtopic,
        task_number: item.taskNumber,
        goal: item.goal,
        planned_results: item.plannedResults,
        description: item.description,
        lesson_materials_notes: item.materialsNotes,
        homework_description: item.homeworkDescription,
        teacher_comment: item.teacherComment,
      });
      setMoreAnchor(null);
      onClose?.();
      navigate(`/cabinet/plans/${planId}/edit`);
    } catch (err) {
      setMaterialsError(err?.message || "Не удалось дублировать занятие");
    } finally {
      setDuplicating(false);
    }
  };

  if (!item && loading) {
    return (
      <CabinetModal lesson hideHead onClose={onClose}>
        <p className="cb-loading cb-lesson-card__loading">Загрузка занятия…</p>
      </CabinetModal>
    );
  }

  if (!item) return null;

  const footer = (
    <div className="cb-lesson-card__footer-inner">
      <div className="cb-lesson-card__footer-main">
        <button type="button" className="cb-btn cb-btn--primary" onClick={handlePrimary}>
          {primaryAction.label}
        </button>
        {canEdit ? (
          <Link
            to={`/cabinet/plans/${planId}/edit`}
            className="cb-btn cb-btn--outline"
            onClick={onClose}
          >
            Редактировать
          </Link>
        ) : null}
        <button type="button" className="cb-btn cb-btn--ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {canEdit ? (
        <div className="cb-lesson-card__footer-more">
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-btn--sm"
            aria-expanded={Boolean(moreAnchor)}
            onClick={(e) => setMoreAnchor(moreAnchor ? null : e.currentTarget)}
          >
            Ещё
          </button>
          <CabinetFloatingMenu
            open={Boolean(moreAnchor)}
            anchorEl={moreAnchor}
            onClose={() => setMoreAnchor(null)}
            className="cb-lesson-card__more-menu"
            width={220}
          >
            <button
              type="button"
              className="cb-lesson-card__more-item"
              role="menuitem"
              onClick={handleDuplicateItem}
              disabled={duplicating}
            >
              {duplicating ? "…" : "Дублировать в редакторе"}
            </button>
          </CabinetFloatingMenu>
        </div>
      ) : null}
    </div>
  );

  return (
    <CabinetModal lesson hideHead onClose={onClose} footer={footer}>
      <div className="cb-lesson-card">
        <header className="cb-lesson-card__header">
          <div className="cb-lesson-card__header-top">
            <div className="cb-lesson-card__header-copy">
              <p className="cb-lesson-card__eyebrow">Занятие {item.order}</p>
              <h2 className="cb-lesson-card__title">{item.title}</h2>
              {(item.topic || item.subtopic) && (
                <p className="cb-lesson-card__topic-line">
                  Тема: {[item.topic, item.subtopic].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <button type="button" className="cb-modal__close" onClick={onClose} aria-label="Закрыть">
              <CabinetIcon name="close" />
            </button>
          </div>

          <div className="cb-lesson-card__badges">
            <span className="cb-plan-meta-badge cb-plan-meta-badge--gray">Занятие</span>
            {exam ? <span className="cb-plan-meta-badge cb-plan-meta-badge--info">{exam}</span> : null}
            {subject ? <span className="cb-plan-meta-badge cb-plan-meta-badge--lav">{subject}</span> : null}
            {item.topic ? <span className="cb-plan-meta-badge cb-plan-meta-badge--gray">{item.topic}</span> : null}
          </div>

          {loading ? <p className="cb-lesson-card__sync">Обновление данных…</p> : null}
        </header>

        <div className="cb-lesson-card__scroll" ref={scrollRef}>
          {passportEntries.length > 0 ? (
            <div className="cb-lesson-passport">
              {passportEntries.map((entry) => (
                <PassportCell key={entry.label} label={entry.label} value={entry.value} />
              ))}
            </div>
          ) : null}

          {hasGoalBlock ? (
            <LessonBlock title="Цель и результат">
              <div className="cb-lesson-goals">
                <GoalCard title="Цель" text={item.goal} />
                <GoalCard title="Результат" text={item.plannedResults} />
              </div>
            </LessonBlock>
          ) : null}

          {hasPlanBlock ? (
            <LessonBlock title="План занятия">
              <PlanContent text={item.description} />
            </LessonBlock>
          ) : null}

          <div ref={materialsRef}>
            <LessonBlock
              title="Материалы"
              empty={
                !hasMaterialsBlock ? (
                  <div className="cb-lesson-empty">
                    <p>Материалов пока нет</p>
                  </div>
                ) : null
              }
            >
              {hasMaterialsBlock ? (
                <div className="cb-lesson-materials">
                  {materialsError ? (
                    <p className="cb-modal-form__error" role="alert">{materialsError}</p>
                  ) : null}
                  {materialsSaving ? (
                    <p className="cb-lesson-card__sync">Сохранение…</p>
                  ) : null}
                  {hasText(item.materialsNotes) ? (
                    <div className="cb-lesson-plan-card">
                      <CollapsibleText text={item.materialsNotes} />
                    </div>
                  ) : null}
                  {lessonResourceRows(item).map((row) => (
                    <ResourceCard
                      key={row.key}
                      row={row}
                      canEdit={canEdit}
                      removing={materialsSaving}
                      onRemove={handleRemoveLessonResource}
                    />
                  ))}
                </div>
              ) : null}
            </LessonBlock>
          </div>

          <LessonBlock
            title="Домашнее задание"
            empty={
              !hasHomework ? (
                <div className="cb-lesson-empty">
                  <p>Домашнее задание не выдано</p>
                </div>
              ) : null
            }
          >
            {hasHomework ? (
              <div className="cb-lesson-materials">
                {hasText(item.homeworkDescription) ? (
                  <article className="cb-lesson-hw-card">
                    <div className="cb-lesson-hw-card__icon" aria-hidden="true">
                      <CabinetIcon name="tasks" />
                    </div>
                    <div className="cb-lesson-hw-card__body">
                      <strong className="cb-lesson-hw-card__title">Описание</strong>
                      <CollapsibleText text={item.homeworkDescription} />
                    </div>
                  </article>
                ) : null}
                {homeworkResourceRows(item).map((row) => (
                  <ResourceCard
                    key={row.key}
                    row={row}
                    canEdit={canEdit}
                    removing={materialsSaving}
                    onRemove={handleRemoveHomeworkResource}
                  />
                ))}
              </div>
            ) : null}
          </LessonBlock>

          {hasComment ? (
            <LessonBlock title="Комментарий учителя">
              <div className="cb-lesson-plan-card">
                <CollapsibleText text={item.teacherComment} />
              </div>
            </LessonBlock>
          ) : null}
        </div>
      </div>
    </CabinetModal>
  );
}
