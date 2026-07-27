import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import { CabinetPageShell, useSoonToast } from "../CabinetSectionUi";
import ConfirmActionModal from "../components/ConfirmActionModal";
import PlanEditorResourceBlock from "../components/PlanEditorResourceBlock";
import PlanEditorPreviewModal from "../components/PlanEditorPreviewModal";
import CreateScheduleLessonModal from "../components/CreateScheduleLessonModal";
import PlanItemResourcesPicker from "../components/PlanItemResourcesPicker";
import {
  addLessonPlanItem,
  createLessonPlan,
  createScheduleEvent,
  fetchLessonPlanLevels,
  fetchLessonPlanSubjects,
  deleteLessonPlanItem,
  fetchCabinetSession,
  fetchLessonPlan,
  reorderLessonPlanItems,
  updateLessonPlan,
  updateLessonPlanItem,
} from "../../utils/cabinetAuth";
import { canPublishCatalogPlans } from "../planCatalogPublish";
import {
  mapApiMaterial,
  PLAN_LEVELS,
  PLAN_STATUS_LABELS,
  PLAN_SUBJECTS,
  defaultSubjectForDirection,
  planSubjectLabelFromId,
} from "../lessonPlansData";
import { mapApiInteractiveAttachment } from "../planItemAttachments";
import {
  EMPTY_PLAN_SESSION,
  buildPlanItemApiPayload,
  clonePlanSession,
  editorSessionToPlanItem,
  mapApiItemResponseToSession,
  mapPlanItemToEditorSession,
  planEditorStats,
  sessionHomeworkAttachmentRows,
  sessionLessonAttachmentRows,
  sessionResourceSummary,
} from "../planEditorSession";
import { useAutoSave } from "../hooks/useAutoSave";

function planTypeLabel(id, options = PLAN_LEVELS) {
  return options.find((t) => t.id === id)?.label || id;
}

function planSubjectLabel(id) {
  return planSubjectLabelFromId(id) || id;
}

function calculateProgress({ title, sessions }) {
  let score = 0;
  if (title.trim()) score += 25;
  score += 15;
  if (sessions.length > 0) score += 20;
  if (sessions.length > 0) {
    const withTopic = sessions.filter((s) => s.topic.trim()).length;
    score += Math.round(40 * (withTopic / sessions.length));
  }
  return Math.min(100, score);
}

function PlanEditorSessionCard({
  session,
  index,
  total,
  expanded,
  onToggle,
  onChange,
  onMove,
  onDuplicate,
  onOpenPicker,
  onRemoveAttachment,
  onSaveSession,
  onDeleteSession,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  attaching,
  savingSession,
  sessionError,
}) {
  const summary = sessionResourceSummary(session);
  const displayTitle = session.title.trim() || `Занятие ${index + 1}`;
  const topicLine = session.topic.trim() ? `Тема: «${session.topic.trim()}»` : "Тема не указана";

  return (
    <article
      className={`cb-pe-session${expanded ? " is-expanded" : ""}${isDragging ? " is-dragging" : ""}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="cb-pe-session__head">
        <button
          type="button"
          className="cb-pe-session__drag"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          aria-label="Перетащить"
          onClick={(e) => e.stopPropagation()}
        >
          <CabinetIcon name="order" />
        </button>

        <button type="button" className="cb-pe-session__summary" onClick={onToggle}>
          <span className="cb-pe-session__num">Занятие {index + 1}</span>
          <strong className="cb-pe-session__title">{displayTitle}</strong>
          <span className="cb-pe-session__topic">{topicLine}</span>
          <span className="cb-pe-session__meta">
            Материалы: {summary.materials} · ДЗ: {summary.homework}
          </span>
        </button>

        <div className="cb-pe-session__tools">
          <button
            type="button"
            className="cb-pe-session__tool"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? "Свернуть" : "Развернуть"}
          >
            <span className={`cb-pe-session__chevron${expanded ? " is-open" : ""}`} aria-hidden="true" />
          </button>
          <button type="button" className="cb-pe-session__tool" onClick={() => onDuplicate(index)} aria-label="Дублировать">
            ⧉
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="cb-pe-session__body">
          <div className="cb-pe-session__grid cb-pe-session__grid--2">
            <label className="cb-pe-field">
              <span>Название</span>
              <input value={session.title} onChange={(e) => onChange(index, "title", e.target.value)} />
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
              className="cb-btn cb-btn--ghost cb-btn--danger"
              onClick={() => onDeleteSession(index)}
              disabled={savingSession || attaching}
            >
              Удалить
            </button>
          </div>

          <div className="cb-pe-session__reorder">
            <button type="button" className="cb-btn cb-btn--ghost cb-btn--xs" disabled={index === 0} onClick={() => onMove(index, -1)}>
              ↑ Вверх
            </button>
            <button type="button" className="cb-btn cb-btn--ghost cb-btn--xs" disabled={index === total - 1} onClick={() => onMove(index, 1)}>
              ↓ Вниз
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function PlanEditorSummary({
  progress,
  stats,
  directionLabel,
  subjectLabel,
  grade,
  saving,
  isNew,
  planId,
  onSave,
  onAddSession,
  onPreview,
  onScheduleFirst,
  schedulingFirst,
}) {
  return (
    <aside className="cb-pe-sidebar">
      <div className="cb-pe-sidebar__card">
        <h2 className="cb-pe-sidebar__title">Сводка</h2>

        <div className="cb-pe-progress">
          <div className="cb-pe-progress__head">
            <span>План заполнен на {progress}%</span>
          </div>
          <div className="cb-pe-progress__track">
            <div className="cb-pe-progress__fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <dl className="cb-pe-stats">
          <div><dt>Занятий</dt><dd>{stats.sessions}</dd></div>
          <div><dt>Материалов</dt><dd>{stats.materials}</dd></div>
          <div><dt>ДЗ</dt><dd>{stats.homework}</dd></div>
          <div><dt>Предмет</dt><dd>{subjectLabel}</dd></div>
          <div><dt>Направление</dt><dd>{directionLabel}</dd></div>
          {grade ? <div><dt>Класс</dt><dd>{grade}</dd></div> : null}
        </dl>

        <div className="cb-pe-sidebar__section">
          <h3 className="cb-pe-sidebar__subtitle">Быстрые действия</h3>
          <div className="cb-pe-sidebar__actions">
            <button type="button" className="cb-btn cb-btn--secondary cb-btn--block" onClick={onAddSession}>
              <CabinetIcon name="plus" /> Добавить занятие
            </button>
            <button type="button" className="cb-btn cb-btn--primary cb-btn--block" onClick={onSave} disabled={saving}>
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
            <button type="button" className="cb-btn cb-btn--ghost cb-btn--block" onClick={onPreview}>
              Предпросмотр
            </button>
            <button
              type="button"
              className="cb-btn cb-btn--ghost cb-btn--block"
              onClick={onScheduleFirst}
              disabled={schedulingFirst || stats.sessions === 0}
            >
              {schedulingFirst ? "Подготовка…" : "Запланировать первое"}
            </button>
          </div>
        </div>

        {!isNew ? (
          <p className="cb-pe-sidebar__hint">
            <Link to={`/cabinet/plans/${planId}`}>Открыть карточку плана</Link>
          </p>
        ) : null}
      </div>
    </aside>
  );
}

export default function CabinetLessonPlanEditorPage() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const isNew = !planId || planId === "new";
  const { toast, showToast } = useSoonToast();

  const [loadingExisting, setLoadingExisting] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [planStatus, setPlanStatus] = useState("draft");

  const [title, setTitle] = useState("");
  const [type, setType] = useState("oge");
  const [subject, setSubject] = useState(defaultSubjectForDirection("oge"));
  const [subjectOptions, setSubjectOptions] = useState(PLAN_SUBJECTS);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [levelOptions, setLevelOptions] = useState(PLAN_LEVELS);
  const [levelsLoading, setLevelsLoading] = useState(true);
  const [goal, setGoal] = useState("");
  const [description, setDescription] = useState("");
  const [grade, setGrade] = useState("");
  const [sessions, setSessions] = useState(() => (isNew ? [clonePlanSession(EMPTY_PLAN_SESSION)] : []));
  const [expandedIndex, setExpandedIndex] = useState(isNew ? 0 : null);
  const [extraOpen, setExtraOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingSessionIndex, setSavingSessionIndex] = useState(null);
  const [sessionErrors, setSessionErrors] = useState({});
  const [activePlanId, setActivePlanId] = useState(isNew ? null : planId);
  const [attachingIndex, setAttachingIndex] = useState(null);
  const [resourcesPicker, setResourcesPicker] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState(null);
  const [schedulingFirst, setSchedulingFirst] = useState(false);
  const [deleteSessionIndex, setDeleteSessionIndex] = useState(null);
  const [makePublic, setMakePublic] = useState(false);
  const [canPublishCatalog, setCanPublishCatalog] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSavedAt, setAutoSavedAt] = useState(null);
  const skipDirtyRef = useRef(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((data) => {
        if (!cancelled && data?.user) {
          setCanPublishCatalog(canPublishCatalogPlans(data.user));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  const defaultSubjectFromOptions = useCallback((direction, options) => {
    const list = Array.isArray(options) && options.length ? options : PLAN_SUBJECTS;
    const ids = new Set(list.map((item) => String(item.id)));

    if (direction === "school") {
      if (ids.has("prog")) return "prog";
      if (ids.has("inf")) return "inf";
    }

    if (direction === "vpr") {
      if (ids.has("math")) return "math";
      if (ids.has("math_base")) return "math_base";
    }

    if (ids.has("inf")) return "inf";
    const fallback = defaultSubjectForDirection(direction);
    if (ids.has(fallback)) return fallback;
    return list[0]?.id || fallback;
  }, []);

  const normalizeSubjectSelection = useCallback((value, direction, options) => {
    const list = Array.isArray(options) && options.length ? options : PLAN_SUBJECTS;
    const ids = new Set(list.map((item) => String(item.id)));
    const current = String(value || "").trim();
    const normalized = current.toLowerCase();

    if (!normalized) {
      return defaultSubjectFromOptions(direction, list);
    }
    if (ids.has(current)) return current;
    if (ids.has(normalized)) return normalized;
    if (normalized === "informatics" && ids.has("inf")) return "inf";
    if (normalized === "inf" && ids.has("informatics")) return "informatics";
    if (normalized === "math" && ids.has("math_base") && !ids.has("math")) return "math_base";

    return defaultSubjectFromOptions(direction, list);
  }, [defaultSubjectFromOptions]);

  const normalizeLevelSelection = useCallback((value, options) => {
    const list = Array.isArray(options) && options.length ? options : PLAN_LEVELS;
    const ids = new Set(list.map((item) => String(item.id)));
    const current = String(value || "").trim().toLowerCase();

    if (!current) {
      if (ids.has("oge")) return "oge";
      return list[0]?.id || "oge";
    }
    if (ids.has(current)) return current;
    // Старое значение (python/other и т.п.) не перетираем — покажем его в select отдельно.
    return current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLessonPlanSubjects()
      .then((data) => {
        if (cancelled) return;
        const next = (data?.subjects || [])
          .map((item) => ({
            id: String(item?.id || "").trim(),
            label: String(item?.label || item?.id || "").trim(),
          }))
          .filter((item) => item.id && item.label);
        setSubjectOptions(next.length ? next : PLAN_SUBJECTS);
      })
      .catch(() => {
        if (!cancelled) setSubjectOptions(PLAN_SUBJECTS);
      })
      .finally(() => {
        if (!cancelled) setSubjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLessonPlanLevels()
      .then((data) => {
        if (cancelled) return;
        const next = (data?.levels || [])
          .map((item) => ({
            id: String(item?.id || "").trim(),
            label: String(item?.label || item?.id || "").trim(),
          }))
          .filter((item) => item.id && item.label);
        setLevelOptions(next.length ? next : PLAN_LEVELS);
      })
      .catch(() => {
        if (!cancelled) setLevelOptions(PLAN_LEVELS);
      })
      .finally(() => {
        if (!cancelled) setLevelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!subjectOptions.length) return;
    setSubject((prev) => {
      const next = normalizeSubjectSelection(prev, type, subjectOptions);
      return next === prev ? prev : next;
    });
  }, [normalizeSubjectSelection, subjectOptions, type]);

  useEffect(() => {
    if (!levelOptions.length) return;
    setType((prev) => {
      const next = normalizeLevelSelection(prev, levelOptions);
      return next === prev ? prev : next;
    });
  }, [levelOptions, normalizeLevelSelection]);

  useEffect(() => {
    if (!sessionReady || isNew) {
      if (isNew && sessionReady) setLoadingExisting(false);
      return;
    }
    fetchLessonPlan(planId)
      .then((data) => {
        if (data.is_public && !canPublishCatalog) {
          navigate(`/cabinet/plans/${planId}`, { replace: true });
          return;
        }
        setTitle(data.title || "");
        setType(data.direction || "oge");
        setSubject(data.subject || defaultSubjectForDirection(data.direction || "oge"));
        setGoal(data.goal || "");
        setDescription(data.description || "");
        setGrade(data.grade || "");
        setPlanStatus(data.status || "draft");
        setMakePublic(Boolean(data.is_public));
        setExtraOpen(Boolean(data.goal?.trim() || data.description?.trim()));
        if (data.items?.length) {
          setSessions(data.items.map((item) => mapApiItemResponseToSession(item)));
          setExpandedIndex(0);
        } else {
          setSessions([clonePlanSession(EMPTY_PLAN_SESSION)]);
          setExpandedIndex(0);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoadingExisting(false));
  }, [canPublishCatalog, isNew, navigate, planId, sessionReady]);

  const progress = useMemo(
    () => calculateProgress({ title, sessions }),
    [title, sessions],
  );

  const stats = useMemo(() => planEditorStats(sessions), [sessions]);

  const previewPlan = useMemo(() => ({
    id: activePlanId || planId,
    title: title.trim() || "Без названия",
    direction: type,
    subject,
    grade,
    goal,
    description,
    items: sessions.map((session, index) => editorSessionToPlanItem(session, index + 1)),
  }), [activePlanId, description, goal, grade, planId, sessions, subject, title, type]);

  const levelSelectOptions = useMemo(() => {
    if (!type || levelOptions.some((item) => item.id === type)) return levelOptions;
    return [...levelOptions, { id: type, label: planTypeLabel(type, levelOptions) }];
  }, [levelOptions, type]);

  const replaceSession = useCallback((index, nextSession) => {
    skipDirtyRef.current = true;
    setSessions((prev) => prev.map((s, i) => (i === index ? nextSession : s)));
  }, []);

  const persistSessionIfSaved = useCallback(async (index, nextSession) => {
    if (!nextSession.id) return nextSession;
    setAttachingIndex(index);
    try {
      const data = await updateLessonPlanItem(nextSession.id, buildPlanItemApiPayload(nextSession, index + 1));
      return mapApiItemResponseToSession(data);
    } finally {
      setAttachingIndex(null);
    }
  }, []);

  const updateSession = useCallback((index, field, value) => {
    setSessions((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }, []);

  const applySessionUpdate = useCallback(async (index, updater) => {
    let nextSession;
    setSessions((prev) => {
      nextSession = updater(prev[index]);
      return prev.map((s, i) => (i === index ? nextSession : s));
    });
    if (nextSession?.id) {
      const saved = await persistSessionIfSaved(index, nextSession);
      replaceSession(index, saved);
      return saved;
    }
    return nextSession;
  }, [persistSessionIfSaved, replaceSession]);

  const openResourcesPicker = useCallback((sessionIndex, scope, initialTab) => {
    setResourcesPicker({ sessionIndex, scope, initialTab: initialTab || (scope === "tasks" ? "variant" : scope === "lesson" ? "library" : "interactives") });
  }, []);

  const handleAttachMaterial = useCallback(async (material) => {
    if (!resourcesPicker) return;
    const { sessionIndex, scope } = resourcesPicker;
    const mapped = mapApiMaterial(material);
    const isVariant = mapped.materialType === "task_set";
    await applySessionUpdate(sessionIndex, (session) => {
      if (scope === "tasks" || (scope === "lesson" && isVariant)) {
        if (session.taskMaterials.some((m) => m.id === mapped.id)) return session;
        // Убрать из обычных материалов, если раньше лежал там.
        return {
          ...session,
          lessonMaterials: session.lessonMaterials.filter((m) => m.id !== mapped.id),
          taskMaterials: [...session.taskMaterials, mapped],
        };
      }
      if (scope === "homework") {
        if (session.homeworkMaterials.some((m) => m.id === mapped.id)) return session;
        return { ...session, homeworkMaterials: [...session.homeworkMaterials, mapped] };
      }
      if (session.lessonMaterials.some((m) => m.id === mapped.id)) return session;
      return {
        ...session,
        taskMaterials: session.taskMaterials.filter((m) => m.id !== mapped.id),
        lessonMaterials: [...session.lessonMaterials, mapped],
      };
    });
    setResourcesPicker(null);
  }, [applySessionUpdate, resourcesPicker]);

  const handleAttachInteractive = useCallback(async (interactive) => {
    if (!resourcesPicker) return;
    const { sessionIndex, scope } = resourcesPicker;
    const mapped = mapApiInteractiveAttachment(interactive);
    await applySessionUpdate(sessionIndex, (session) => {
      if (scope === "homework") {
        if (session.homeworkInteractives.some((i) => i.id === mapped.id)) return session;
        return { ...session, homeworkInteractives: [...session.homeworkInteractives, mapped] };
      }
      if (session.lessonInteractives.some((i) => i.id === mapped.id)) return session;
      return { ...session, lessonInteractives: [...session.lessonInteractives, mapped] };
    });
    setResourcesPicker(null);
  }, [applySessionUpdate, resourcesPicker]);

  const handleRemoveAttachment = useCallback(async (sessionIndex, scope, row) => {
    await applySessionUpdate(sessionIndex, (session) => {
      if (scope === "homework") {
        if (row.materialId) {
          return {
            ...session,
            homeworkMaterials: session.homeworkMaterials.filter((m) => m.id !== row.materialId),
          };
        }
        if (row.interactiveId) {
          return {
            ...session,
            homeworkInteractives: session.homeworkInteractives.filter((i) => i.id !== row.interactiveId),
          };
        }
      }
      if (row.materialId) {
        return {
          ...session,
          lessonMaterials: session.lessonMaterials.filter((m) => m.id !== row.materialId),
          taskMaterials: session.taskMaterials.filter((m) => m.id !== row.materialId),
        };
      }
      if (row.interactiveId) {
        return {
          ...session,
          lessonInteractives: session.lessonInteractives.filter((i) => i.id !== row.interactiveId),
        };
      }
      return session;
    });
  }, [applySessionUpdate]);

  const moveSession = useCallback((index, dir) => {
    setSessions((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setExpandedIndex((prev) => {
      if (prev === index) return index + dir;
      if (prev === index + dir) return index;
      return prev;
    });
  }, []);

  const removeSession = useCallback((index) => {
    setSessions((prev) => prev.filter((_, i) => i !== index));
    setSessionErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setExpandedIndex((prev) => {
      if (prev === null) return null;
      if (prev === index) return Math.max(0, index - 1);
      if (prev > index) return prev - 1;
      return prev;
    });
  }, []);

  const ensurePlanId = useCallback(async () => {
    const existingId = activePlanId || planId;
    if (existingId && existingId !== "new") return existingId;
    if (!title.trim()) {
      throw new Error("Сначала укажите название плана");
    }
    const created = await createLessonPlan({
      title: title.trim(),
      direction: type,
      subject,
      goal,
      description,
      grade,
      lessons_count: sessions.length,
      status: makePublic ? "published" : (planStatus || "draft"),
      ...(canPublishCatalog ? { is_public: makePublic } : {}),
    });
    const nextId = String(created.id);
    setActivePlanId(nextId);
    if (isNew) {
      navigate(`/cabinet/plans/${nextId}/edit`, { replace: true });
    }
    return nextId;
  }, [activePlanId, canPublishCatalog, description, goal, grade, isNew, makePublic, navigate, planId, planStatus, sessions.length, subject, title, type]);

  const saveSession = useCallback(async (index) => {
    const session = sessions[index];
    if (!session) return;
    if (!session.title.trim()) {
      setSessionErrors((prev) => ({ ...prev, [index]: "Укажите название занятия" }));
      return;
    }

    setSavingSessionIndex(index);
    setSessionErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });

    try {
      const targetPlanId = await ensurePlanId();
      const payload = buildPlanItemApiPayload(session, index + 1);
      const data = session.id
        ? await updateLessonPlanItem(session.id, payload)
        : await addLessonPlanItem(targetPlanId, payload);
      replaceSession(index, mapApiItemResponseToSession(data));
    } catch (err) {
      setSessionErrors((prev) => ({
        ...prev,
        [index]: err?.message || "Не удалось сохранить занятие",
      }));
    } finally {
      setSavingSessionIndex(null);
    }
  }, [ensurePlanId, replaceSession, sessions]);

  const deleteSession = useCallback((index) => {
    const session = sessions[index];
    if (!session) return;
    setDeleteSessionIndex(index);
  }, [sessions]);

  const confirmDeleteSession = useCallback(async () => {
    if (deleteSessionIndex == null) return;
    const index = deleteSessionIndex;
    const session = sessions[index];
    if (!session) {
      setDeleteSessionIndex(null);
      return;
    }

    setSavingSessionIndex(index);
    setSessionErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });

    try {
      if (session.id) {
        await deleteLessonPlanItem(session.id);
      }
      removeSession(index);
      setDeleteSessionIndex(null);
    } catch (err) {
      setSessionErrors((prev) => ({
        ...prev,
        [index]: err?.message || "Не удалось удалить занятие",
      }));
    } finally {
      setSavingSessionIndex(null);
    }
  }, [deleteSessionIndex, removeSession, sessions]);

  const duplicateSession = useCallback((index) => {
    setSessions((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, clonePlanSession(prev[index]));
      return next;
    });
    setExpandedIndex(index + 1);
  }, []);

  const handlePreview = useCallback(() => {
    setPreviewOpen(true);
  }, []);

  const handleScheduleFirst = useCallback(async () => {
    const first = sessions[0];
    if (!first) {
      showToast("Добавьте хотя бы одно занятие.");
      return;
    }
    if (!title.trim()) {
      showToast("Сначала укажите название плана.");
      return;
    }
    if (!first.title.trim()) {
      showToast("Укажите название первого занятия.");
      setExpandedIndex(0);
      return;
    }

    setSchedulingFirst(true);
    try {
      const targetPlanId = await ensurePlanId();
      let session = first;
      const payload = buildPlanItemApiPayload(session, 1);
      const data = session.id
        ? await updateLessonPlanItem(session.id, payload)
        : await addLessonPlanItem(targetPlanId, payload);
      session = mapApiItemResponseToSession(data);
      replaceSession(0, session);
      setScheduleDraft({
        lessonPlanItemId: session.id,
        defaultLessonTitle: session.title.trim(),
        defaultTopic: session.topic.trim(),
      });
      setScheduleOpen(true);
    } catch (err) {
      showToast(err?.message || "Не удалось подготовить занятие к планированию.");
    } finally {
      setSchedulingFirst(false);
    }
  }, [ensurePlanId, replaceSession, sessions, showToast, title]);

  const handleCreateSchedule = useCallback(async (payload) => {
    await createScheduleEvent(payload);
    setScheduleOpen(false);
    setScheduleDraft(null);
    showToast("Урок добавлен в расписание.");
  }, [showToast]);

  const addSession = useCallback(() => {
    setSessions((prev) => {
      const next = [...prev, clonePlanSession(EMPTY_PLAN_SESSION)];
      setExpandedIndex(next.length - 1);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((index) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((targetIndex) => {
    if (dragIndex === null || dragIndex === targetIndex) return;
    setSessions((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setExpandedIndex((prev) => {
      if (prev === dragIndex) return targetIndex;
      if (dragIndex < targetIndex && prev > dragIndex && prev <= targetIndex) return prev - 1;
      if (dragIndex > targetIndex && prev >= targetIndex && prev < dragIndex) return prev + 1;
      return prev;
    });
    setDragIndex(null);
  }, [dragIndex]);

  useEffect(() => {
    if (loadingExisting) return;
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    if (skipDirtyRef.current) {
      skipDirtyRef.current = false;
      return;
    }
    setAutoSavedAt(null);
  }, [title, type, subject, goal, description, grade, sessions, makePublic, planStatus, loadingExisting]);

  const persistPlanDraft = useCallback(async () => {
    if (!title.trim() || saving || autoSaving) return false;

    setAutoSaving(true);
    try {
      const payload = {
        title: title.trim(),
        direction: type,
        subject,
        goal,
        description,
        grade,
        lessons_count: sessions.length,
        status: makePublic ? "published" : (planStatus || "draft"),
        ...(canPublishCatalog ? { is_public: makePublic } : {}),
      };

      const targetPlanId = await ensurePlanId();
      await updateLessonPlan(targetPlanId, payload);

      const nextSessions = [...sessions];
      const savedItemIds = [];
      for (let i = 0; i < nextSessions.length; i += 1) {
        const session = nextSessions[i];
        if (!session.title.trim()) continue;
        const itemPayload = buildPlanItemApiPayload(session, i + 1);
        const data = session.id
          ? await updateLessonPlanItem(session.id, itemPayload)
          : await addLessonPlanItem(targetPlanId, itemPayload);
        nextSessions[i] = mapApiItemResponseToSession(data);
        savedItemIds.push(data.id);
      }

      skipDirtyRef.current = true;
      setSessions(nextSessions);
      if (savedItemIds.length > 1) {
        await reorderLessonPlanItems(savedItemIds.map((id, order) => ({ id, order: order + 1 })));
      }
      setAutoSavedAt(Date.now());
      return true;
    } catch {
      return false;
    } finally {
      setAutoSaving(false);
    }
  }, [
    autoSaving,
    canPublishCatalog,
    description,
    ensurePlanId,
    goal,
    grade,
    makePublic,
    planStatus,
    saving,
    sessions,
    subject,
    title,
    type,
  ]);

  useAutoSave({
    enabled: !loadingExisting && Boolean(title.trim()),
    isDirty: true,
    isSaving: saving || autoSaving || schedulingFirst,
    onSave: persistPlanDraft,
  });

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        direction: type,
        subject,
        goal,
        description,
        grade,
        lessons_count: sessions.length,
        status: makePublic ? "published" : (planStatus || "draft"),
        ...(canPublishCatalog ? { is_public: makePublic } : {}),
      };
      let savedPlanId = activePlanId || planId;

      if (isNew) {
        const created = await createLessonPlan(payload);
        savedPlanId = created.id;
        setActivePlanId(String(created.id));
        for (let i = 0; i < sessions.length; i++) {
          const session = sessions[i];
          if (!session.title.trim()) continue;
          await addLessonPlanItem(savedPlanId, buildPlanItemApiPayload(session, i + 1));
        }
      } else {
        await updateLessonPlan(planId, payload);
        const savedItems = [];
        for (let i = 0; i < sessions.length; i++) {
          const session = sessions[i];
          if (!session.title.trim()) continue;
          const itemPayload = buildPlanItemApiPayload(session, i + 1);
          if (session.id) {
            const data = await updateLessonPlanItem(session.id, itemPayload);
            savedItems.push(data.id);
          } else {
            const data = await addLessonPlanItem(planId, itemPayload);
            savedItems.push(data.id);
          }
        }
        if (savedItems.length > 1) {
          await reorderLessonPlanItems(savedItems.map((id, order) => ({ id, order: order + 1 })));
        }
      }
      navigate(`/cabinet/plans/${savedPlanId}`);
    } catch (err) {
      showToast(err?.message || "Не удалось сохранить план");
    } finally {
      setSaving(false);
    }
  };

  const pickerSession = resourcesPicker ? sessions[resourcesPicker.sessionIndex] : null;

  if (loadingExisting) {
    return (
      <CabinetPageShell className="cb-section--plan-editor">
        <p className="cb-loading">Загрузка…</p>
      </CabinetPageShell>
    );
  }
  if (notFound) return <Navigate to="/cabinet/plans" replace />;

  const statusLabel = PLAN_STATUS_LABELS[planStatus] || "Черновик";
  const backHref = isNew ? "/cabinet/plans" : `/cabinet/plans/${planId}`;

  return (
    <CabinetPageShell className="cb-section--plan-editor">
      {toast}

      <header className="cb-pe-header">
        <div className="cb-pe-header__left">
          <Link to={backHref} className="cb-pe-header__back">
            <CabinetIcon name="arrowLeft" /> Назад
          </Link>
          <div className="cb-pe-header__title-wrap">
            <h1 className="cb-pe-header__title">
              {isNew ? "Новый план" : "Редактирование плана"}
            </h1>
            <span className="cb-pe-header__badge">{statusLabel}</span>
          </div>
        </div>
        <div className="cb-pe-header__actions">
          {autoSaving ? (
            <span className="cb-pe-header__autosave" role="status">Сохранение…</span>
          ) : autoSavedAt ? (
            <span className="cb-pe-header__autosave" role="status">Сохранено автоматически</span>
          ) : null}
          <button type="button" className="cb-btn cb-btn--ghost" onClick={() => navigate(-1)}>
            Отмена
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--primary"
            onClick={handleSave}
            disabled={saving || !title.trim()}
          >
            {saving ? "Сохранение…" : "Сохранить план"}
          </button>
        </div>
      </header>

      <div className="cb-pe-layout">
        <div className="cb-pe-main">
          <section className="cb-pe-card">
            <h2 className="cb-pe-card__title">Параметры плана</h2>
            <div className="cb-pe-params">
              <label className="cb-pe-field cb-pe-field--wide">
                <span>Название</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="ОГЭ-2026 · полный курс"
                />
              </label>
              <div className="cb-pe-params__row">
                <label className="cb-pe-field">
                  <span>Предмет</span>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    disabled={subjectsLoading && !subjectOptions.length}
                  >
                    {subjectOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="cb-pe-field">
                  <span>Уровень</span>
                  <select
                    value={type}
                    disabled={levelsLoading && !levelOptions.length}
                    onChange={(e) => {
                      const nextType = e.target.value;
                      const prevDefault = defaultSubjectFromOptions(type, subjectOptions);
                      const nextDefault = defaultSubjectFromOptions(nextType, subjectOptions);
                      setType(nextType);
                      setSubject((prev) => (
                        prev === prevDefault
                          ? nextDefault
                          : normalizeSubjectSelection(prev, nextType, subjectOptions)
                      ));
                    }}
                  >
                    {levelSelectOptions.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </label>
                <label className="cb-pe-field">
                  <span>Класс</span>
                  <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="9" />
                </label>
              </div>

              {canPublishCatalog ? (
                <label className="cb-pe-field cb-pe-field--wide cb-pe-field--checkbox">
                  <input
                    type="checkbox"
                    checked={makePublic}
                    onChange={(e) => setMakePublic(e.target.checked)}
                  />
                  <span>
                    <strong>Сделать публичным шаблоном</strong>
                    <small>План появится в разделе «Готовые» у всех учителей</small>
                  </span>
                </label>
              ) : null}

              <div className="cb-pe-accordion">
                <button
                  type="button"
                  className="cb-pe-accordion__toggle"
                  aria-expanded={extraOpen}
                  onClick={() => setExtraOpen((v) => !v)}
                >
                  Дополнительно
                  <span className={`cb-pe-session__chevron${extraOpen ? " is-open" : ""}`} aria-hidden="true" />
                </button>
                {extraOpen ? (
                  <div className="cb-pe-accordion__body">
                    <label className="cb-pe-field cb-pe-field--wide">
                      <span>Цель</span>
                      <textarea
                        className="cb-pe-field__compact"
                        rows={2}
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                        placeholder="Цель курса"
                      />
                    </label>
                    <label className="cb-pe-field cb-pe-field--wide">
                      <span>Описание</span>
                      <textarea
                        className="cb-pe-field__compact"
                        rows={2}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Краткое описание"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="cb-pe-card">
            <div className="cb-pe-card__head">
              <h2 className="cb-pe-card__title">Занятия плана</h2>
              <button type="button" className="cb-btn cb-btn--secondary cb-btn--sm" onClick={addSession}>
                <CabinetIcon name="plus" /> Добавить занятие
              </button>
            </div>

            {sessions.length === 0 ? (
              <div className="cb-pe-empty">
                <p className="cb-pe-empty__title">Занятий пока нет</p>
                <p className="cb-pe-empty__text">Добавьте первое занятие в план.</p>
                <button type="button" className="cb-btn cb-btn--primary" onClick={addSession}>
                  Добавить занятие
                </button>
              </div>
            ) : (
              <div className="cb-pe-sessions">
                {sessions.map((session, index) => (
                  <PlanEditorSessionCard
                    key={session.id ? `item-${session.id}` : `draft-${index}`}
                    session={session}
                    index={index}
                    total={sessions.length}
                    expanded={expandedIndex === index}
                    onToggle={() => setExpandedIndex((prev) => (prev === index ? null : index))}
                    onChange={updateSession}
                    onMove={moveSession}
                    onDuplicate={duplicateSession}
                    onOpenPicker={openResourcesPicker}
                    onRemoveAttachment={handleRemoveAttachment}
                    onSaveSession={saveSession}
                    onDeleteSession={deleteSession}
                    savingSession={savingSessionIndex === index}
                    sessionError={sessionErrors[index]}
                    attaching={attachingIndex === index}
                    isDragging={dragIndex === index}
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={handleDragOver}
                    onDrop={() => handleDrop(index)}
                    onDragEnd={() => setDragIndex(null)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <PlanEditorSummary
          progress={progress}
          stats={stats}
          directionLabel={planTypeLabel(type, levelOptions)}
          subjectLabel={planSubjectLabel(subject)}
          grade={grade}
          saving={saving}
          isNew={isNew}
          planId={planId}
          onSave={handleSave}
          onAddSession={addSession}
          onPreview={handlePreview}
          onScheduleFirst={handleScheduleFirst}
          schedulingFirst={schedulingFirst}
        />
      </div>

      <div className="cb-pe-mobile-bar" aria-hidden={false}>
        <button type="button" className="cb-btn cb-btn--secondary" onClick={addSession}>
          <CabinetIcon name="plus" /> Занятие
        </button>
        <button
          type="button"
          className="cb-btn cb-btn--primary"
          onClick={handleSave}
          disabled={saving || !title.trim()}
        >
          {saving ? "…" : "Сохранить"}
        </button>
      </div>

      {resourcesPicker && pickerSession ? (
        <PlanItemResourcesPicker
          scope={resourcesPicker.scope}
          initialTab={resourcesPicker.initialTab}
          open
          attachedMaterialIds={
            resourcesPicker.scope === "tasks"
              ? pickerSession.taskMaterials.map((m) => m.id)
              : resourcesPicker.scope === "homework"
                ? pickerSession.homeworkMaterials.map((m) => m.id)
                : [
                    ...pickerSession.lessonMaterials.map((m) => m.id),
                    ...pickerSession.taskMaterials.map((m) => m.id),
                  ]
          }
          attachedInteractiveIds={
            resourcesPicker.scope === "homework"
              ? pickerSession.homeworkInteractives.map((i) => i.id)
              : pickerSession.lessonInteractives.map((i) => i.id)
          }
          onClose={() => setResourcesPicker(null)}
          onAttachMaterial={handleAttachMaterial}
          onAttachInteractive={handleAttachInteractive}
        />
      ) : null}

      {previewOpen ? (
        <PlanEditorPreviewModal
          plan={previewPlan}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}

      {scheduleOpen && scheduleDraft ? (
        <CreateScheduleLessonModal
          dialogTitle="Запланировать первое занятие"
          defaultLessonTitle={scheduleDraft.defaultLessonTitle}
          defaultTopic={scheduleDraft.defaultTopic}
          lessonPlanItemId={scheduleDraft.lessonPlanItemId}
          onClose={() => {
            setScheduleOpen(false);
            setScheduleDraft(null);
          }}
          onCreate={handleCreateSchedule}
        />
      ) : null}

      <ConfirmActionModal
        open={deleteSessionIndex != null}
        title="Удалить занятие?"
        text="Удалить это занятие?"
        confirmLabel="Удалить"
        danger
        loading={savingSessionIndex === deleteSessionIndex && deleteSessionIndex != null}
        onClose={() => {
          if (savingSessionIndex !== deleteSessionIndex) setDeleteSessionIndex(null);
        }}
        onConfirm={confirmDeleteSession}
      />
    </CabinetPageShell>
  );
}
