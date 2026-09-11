import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import { CabinetPageShell, useSoonToast } from "../CabinetSectionUi";
import ConfirmActionModal from "../components/ConfirmActionModal";
import CabinetFloatingMenu from "../components/CabinetFloatingMenu";
import CabinetModal from "../components/CabinetModal";
import PlanExcelImportModal from "../components/PlanExcelImportModal";
import PlanEditorPreviewModal from "../components/PlanEditorPreviewModal";
import CreateScheduleLessonModal from "../components/CreateScheduleLessonModal";
import PlanItemResourcesPicker from "../components/PlanItemResourcesPicker";
import {
  PlanEditorSkeleton,
  PlanSessionsList,
} from "../components/PlanEditorLessonList";
import { usePlanListPointerReorder } from "../hooks/usePlanListPointerReorder";
import {
  applyReorderWithTopic,
  groupSessionsByTopic,
  lessonsWord,
  mapIndexAfterMove,
  moveSessionToTopic,
  renameTopicInRange,
  shouldShowTopicChrome,
  topicsWord,
  topicKeyOf,
  visualDropLineIndex,
} from "../planEditorGrouping";
import "../styles/plan-editor.css";
import {
  addLessonPlanItem,
  createLessonPlan,
  createScheduleEvent,
  deleteLessonPlanItem,
  downloadLessonPlanExcelTemplate,
  exportLessonPlanExcelDraft,
  fetchCabinetSession,
  fetchLessonPlan,
  fetchLessonPlanLevels,
  fetchLessonPlanSubjects,
  fillLessonPlanDates,
  importLessonPlanExcel,
  previewLessonPlanExcel,
  reorderLessonPlanItems,
  updateLessonPlan,
  updateLessonPlanItem,
} from "../../utils/cabinetAuth";
import { canPublishCatalogPlans } from "../planCatalogPublish";
import {
  mapApiMaterial,
  PLAN_LEVELS,
  PLAN_SUBJECTS,
  defaultSubjectForDirection,
  planLevelLabelFromId,
  planSubjectLabelFromId,
  resolvePlanLevelSelection,
  resolvePlanSubjectSelection,
} from "../lessonPlansData";
import { mapApiInteractiveAttachment } from "../planItemAttachments";
import {
  EMPTY_PLAN_SESSION,
  adoptApiSession,
  buildPlanItemApiPayload,
  clonePlanSession,
  editorSessionToPlanItem,
  keepLocalSessionWithRemoteId,
  mapApiItemResponseToSession,
  resolveLivePlanSession,
  sessionHasPersistableContent,
  sessionListKey,
  sessionPersistTitle,
} from "../planEditorSession";
import { useAutoSave } from "../hooks/useAutoSave";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  PLAN_DATE_INTERVALS,
  applyPlanDates,
  calendarDateKey,
  compressPlanDatesAfterRemove,
  countSessionsOnDate,
  describeDateDeviation,
  inferPlanDateInterval,
  isManualDateOverride,
  nextPlanDateAfter,
  plannedDateAtIndex,
  willCompressDatesAfterRemove,
} from "../planDates";

function planTypeLabel(id, options = PLAN_LEVELS) {
  return options.find((t) => t.id === id)?.label
    || PLAN_LEVELS.find((t) => t.id === id)?.label
    || planLevelLabelFromId(id)
    || id;
}

function sessionDisplayTitle(session, index) {
  return String(session?.title || "").trim()
    || String(session?.subtopic || "").trim()
    || `Урок ${index + 1}`;
}

const PLAN_HELP_SECTIONS = [
  { title: "Настройки плана", text: "Укажите название, предмет, уровень и класс — так план будет понятен вам и ученикам." },
  { title: "Расписание", text: "Дата первого занятия и периодичность задают автоматические даты. Даты, которые вы поменяете вручную у отдельного урока, сохраняются." },
  { title: "Добавление уроков", text: "Кнопка «Добавить урок» создаёт занятие в конце плана или внутри выбранной темы." },
  { title: "Импорт из Excel", text: "Через меню Excel можно загрузить готовый план, выгрузить текущий или скачать шаблон." },
  { title: "Изменение порядка", text: "На компьютере перетащите урок за маркер слева. На любом устройстве порядок можно изменить через меню ⋯ урока." },
  { title: "Ручные даты", text: "Если изменить дату одного урока, остальные занятия не сдвинутся. Плановую дату можно вернуть." },
  { title: "Материалы и ДЗ", text: "В карточке урока прикрепите материалы к занятию и настройте домашнее задание." },
  { title: "Сохранение", text: "План сохраняется автоматически. Кнопка «Сохранить» записывает изменения сразу. Статус рядом с заголовком показывает, сохранён ли план." },
];

function PlanEditorHelpModal({ open, onClose }) {
  if (!open) return null;
  return (
    <CabinetModal title="Как составить план уроков" onClose={onClose}>
      <ol className="cb-pe-help__steps">
        <li>Укажите предмет, уровень и класс.</li>
        <li>Задайте дату первого занятия и расписание.</li>
        <li>Добавьте уроки вручную или загрузите их из Excel.</li>
        <li>При необходимости измените даты отдельных уроков.</li>
        <li>Проверьте последовательность и сохраните план.</li>
      </ol>
      <p className="cb-pe-help__note">
        Порядок уроков можно менять перетаскиванием или через меню урока.
      </p>
      <ul className="cb-pe-help__topics">
        {PLAN_HELP_SECTIONS.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </CabinetModal>
  );
}

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

export default function CabinetLessonPlanEditorPage() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const isNew = !planId || planId === "new";
  const isPhone = useMediaQuery("(max-width: 640px)");
  const { toast, showToast } = useSoonToast();
  usePageTitle(isNew ? "Новый план" : "План уроков");

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
  const [saving, setSaving] = useState(false);
  const [orderStatus, setOrderStatus] = useState("idle");
  const [orderRetry, setOrderRetry] = useState(null);
  const [renamingTopicId, setRenamingTopicId] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState(null);
  const [excelMenuOpen, setExcelMenuOpen] = useState(false);
  const [excelMenuAnchor, setExcelMenuAnchor] = useState(null);
  const [savingSessionIndex, setSavingSessionIndex] = useState(null);
  const [sessionErrors, setSessionErrors] = useState({});
  const [activePlanId, setActivePlanId] = useState(isNew ? null : planId);
  const [attachingIndex, setAttachingIndex] = useState(null);
  const [resourcesPicker, setResourcesPicker] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState(null);
  const [schedulingFirst, setSchedulingFirst] = useState(false);
  const [dateInterval, setDateInterval] = useState("weekly");
  const [deleteSessionIndex, setDeleteSessionIndex] = useState(null);
  const [makePublic, setMakePublic] = useState(false);
  const [canPublishCatalog, setCanPublishCatalog] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSavedAt, setAutoSavedAt] = useState(null);
  const [planDirty, setPlanDirty] = useState(false);
  const [leaveTo, setLeaveTo] = useState(null);
  const [deleteForce, setDeleteForce] = useState(false);
  const [deleteHint, setDeleteHint] = useState("");
  const [deleteTopicGroup, setDeleteTopicGroup] = useState(null);
  const [dateConfirm, setDateConfirm] = useState(null);
  const [excelPreview, setExcelPreview] = useState(null);
  const [excelImporting, setExcelImporting] = useState(false);
  const [excelPreviewLoading, setExcelPreviewLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const excelFileRef = useRef(null);
  const excelFileHoldRef = useRef(null);
  const skipDirtyRef = useRef(false);
  const hydratedRef = useRef(false);
  const creatingPlanRef = useRef(null);
  const createdPlanIdRef = useRef(null);
  const loadedPlanIdRef = useRef(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const commitSessions = useCallback((next) => {
    sessionsRef.current = next;
    setSessions(next);
    return next;
  }, []);

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
    const current = String(value || "").trim();
    if (!current) return defaultSubjectFromOptions(direction, list);
    return resolvePlanSubjectSelection(current, list);
  }, [defaultSubjectFromOptions]);

  const normalizeLevelSelection = useCallback((value, options) => {
    const list = Array.isArray(options) && options.length ? options : PLAN_LEVELS;
    const current = String(value || "").trim();
    if (!current) return current;
    return resolvePlanLevelSelection(current, list);
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
      const next = resolvePlanSubjectSelection(prev, subjectOptions);
      return next === prev ? prev : next;
    });
  }, [subject, subjectOptions]);

  useEffect(() => {
    if (!levelOptions.length) return;
    setType((prev) => {
      const next = normalizeLevelSelection(prev, levelOptions);
      return next === prev ? prev : next;
    });
  }, [levelOptions, normalizeLevelSelection, type]);

  useEffect(() => {
    if (!sessionReady) return undefined;
    if (isNew) {
      setLoadingExisting(false);
      return undefined;
    }
    const key = String(planId);
    if (createdPlanIdRef.current === key) {
      loadedPlanIdRef.current = key;
      setLoadingExisting(false);
      return undefined;
    }
    if (loadedPlanIdRef.current === key) return undefined;

    let cancelled = false;
    loadedPlanIdRef.current = key;
    fetchLessonPlan(planId)
      .then((data) => {
        if (cancelled) return;
        if (data.is_public && !canPublishCatalog) {
          navigate(`/cabinet/plans/${planId}`, { replace: true });
          return;
        }
        setTitle(data.title || "");
        setType(data.direction || "");
        setSubject(resolvePlanSubjectSelection(data.subject, PLAN_SUBJECTS) || data.subject || "");
        setGoal(data.goal || "");
        setDescription(data.description || "");
        setGrade(data.grade || "");
        setPlanStatus(data.status || "draft");
        setMakePublic(Boolean(data.is_public));
        setExtraOpen(Boolean(data.goal?.trim() || data.description?.trim()));
        if (data.items?.length) {
          const mapped = data.items.map((item) => mapApiItemResponseToSession(item));
          setSessions(mapped);
          setDateInterval(inferPlanDateInterval(mapped));
          setExpandedIndex(0);
        } else {
          setSessions([clonePlanSession(EMPTY_PLAN_SESSION)]);
          setExpandedIndex(0);
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canPublishCatalog, isNew, navigate, planId, sessionReady]);

  const topicGroups = useMemo(() => groupSessionsByTopic(sessions), [sessions]);
  const showTopics = shouldShowTopicChrome(topicGroups);
  const namedTopicCount = topicGroups.filter((group) => group.topicKey).length;
  const statsLine = namedTopicCount > 0
    ? `${namedTopicCount} ${topicsWord(namedTopicCount)} · ${sessions.length} ${lessonsWord(sessions.length)}`
    : `${sessions.length} ${lessonsWord(sessions.length)}`;

  const previewPlan = useMemo(() => ({
    id: activePlanId || planId,
    title: title.trim() || "Без названия",
    direction: type,
    directionLabel: planTypeLabel(type, levelOptions),
    subject,
    subjectLabel: planSubjectLabelFromId(subject) || subjectOptions.find((item) => item.id === subject)?.label || "",
    grade,
    goal,
    description,
    items: sessions.map((session, index) => editorSessionToPlanItem(session, index + 1)),
  }), [activePlanId, description, goal, grade, levelOptions, planId, sessions, subject, subjectOptions, title, type]);

  const levelSelectOptions = useMemo(() => {
    if (!type || levelOptions.some((item) => item.id === type)) return levelOptions;
    return [...levelOptions, { id: type, label: planTypeLabel(type, levelOptions) }];
  }, [levelOptions, type]);

  const subjectSelectOptions = useMemo(() => {
    if (!subject || subjectOptions.some((item) => item.id === subject)) return subjectOptions;
    const extraLabel = planSubjectLabelFromId(subject)
      || subjectOptions.find((item) => item.id === subject)?.label
      || subject;
    return [...subjectOptions, { id: subject, label: extraLabel }];
  }, [subject, subjectOptions]);

  const plannedDates = useMemo(
    () => sessions.map((_, index) => plannedDateAtIndex(sessions, index, dateInterval)),
    [dateInterval, sessions],
  );

  const replaceSession = useCallback((index, nextSession) => {
    skipDirtyRef.current = true;
    setSessions((prev) => prev.map((s, i) => (
      i === index
        ? { ...nextSession, clientKey: nextSession.clientKey || s.clientKey }
        : s
    )));
  }, []);

  const persistSessionIfSaved = useCallback(async (index, nextSession) => {
    if (!nextSession.id) return nextSession;
    setAttachingIndex(index);
    try {
      const data = await updateLessonPlanItem(nextSession.id, buildPlanItemApiPayload(nextSession, index + 1));
      return adoptApiSession(data, nextSession);
    } finally {
      setAttachingIndex(null);
    }
  }, []);

  const savedPlanKey = useCallback(() => {
    const key = createdPlanIdRef.current || activePlanId || planId;
    if (!key || key === "new") return null;
    return key;
  }, [activePlanId, planId]);

  const persistDateShifts = useCallback(async (previous, next) => {
    const prevById = new Map((previous || []).filter((session) => session.id).map((session) => [session.id, session]));
    for (let index = 0; index < next.length; index += 1) {
      const session = next[index];
      if (!session?.id) continue;
      const before = prevById.get(session.id);
      if (calendarDateKey(before?.scheduledDate) === calendarDateKey(session.scheduledDate)) continue;
      try {
        await updateLessonPlanItem(session.id, buildPlanItemApiPayload(session, index + 1));
      } catch (err) {
        showToast(err?.message || "Не все даты удалось сохранить. Нажмите «Сохранить план».");
        return false;
      }
    }
    return true;
  }, [showToast]);

  const applyRemovedSessions = useCallback(async (removedIndices) => {
    const previous = sessions;
    const compressed = compressPlanDatesAfterRemove(previous, removedIndices);
    skipDirtyRef.current = true;
    commitSessions(compressed);
    setSessionErrors({});
    setExpandedIndex((prev) => {
      if (prev == null) return prev;
      const removed = [...removedIndices].sort((a, b) => a - b);
      if (removed.includes(prev)) return Math.max(0, removed[0] - 1);
      return prev - removed.filter((index) => index < prev).length;
    });
    await persistDateShifts(previous, compressed);
  }, [commitSessions, persistDateShifts, sessions]);

  const persistFilledPlanDates = useCallback(async (previous, next, interval) => {
    const planKey = savedPlanKey();
    const startDate = calendarDateKey(next?.[0]?.scheduledDate);
    if (!planKey || !startDate) return;
    try {
      await fillLessonPlanDates(planKey, {
        start_date: startDate,
        interval,
      });
    } catch {
      await persistDateShifts(previous, next);
      return;
    }
    for (let index = 0; index < next.length; index += 1) {
      const session = next[index];
      if (!session?.id) continue;
      if (index > 0 && (session.dateSource === "manual" || isManualDateOverride(next, index, interval))) {
        try {
          await updateLessonPlanItem(session.id, buildPlanItemApiPayload(session, index + 1));
        } catch (err) {
          showToast(err?.message || "Не все даты удалось сохранить. Нажмите «Сохранить план».");
          return;
        }
      }
    }
  }, [persistDateShifts, savedPlanKey, showToast]);

  const handleToggleSession = useCallback((index) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  const updateSession = useCallback((index, field, value) => {
    setSessions((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }, []);

  const handleFirstDateChange = useCallback((value) => {
    const nextValue = calendarDateKey(value);
    const prev = sessionsRef.current;
    const next = nextValue ? applyPlanDates(prev, nextValue, dateInterval, 0) : prev;
    if (next === prev && calendarDateKey(prev[0]?.scheduledDate) === nextValue) return;
    skipDirtyRef.current = true;
    commitSessions(next);
    void persistFilledPlanDates(prev, next, dateInterval);
  }, [commitSessions, dateInterval, persistFilledPlanDates]);

  const handleDateIntervalChange = useCallback((nextInterval) => {
    setDateInterval(nextInterval);
    const prev = sessionsRef.current;
    const first = calendarDateKey(prev[0]?.scheduledDate);
    if (!first) return;
    const next = applyPlanDates(prev, first, nextInterval, 0, { previousIntervalId: dateInterval });
    if (next === prev) return;
    skipDirtyRef.current = true;
    commitSessions(next);
    void persistFilledPlanDates(prev, next, nextInterval);
  }, [commitSessions, dateInterval, persistFilledPlanDates]);

  const applySessionDate = useCallback(async (index, value, { shiftFollowing = false } = {}) => {
    const previous = sessionsRef.current;
    const planned = plannedDateAtIndex(previous, index, dateInterval);
    const dateSource = index > 0 && value && calendarDateKey(value) !== calendarDateKey(planned)
      ? "manual"
      : "automatic";
    const withDate = previous.map((session, i) => (
      i === index ? { ...session, scheduledDate: value, dateSource } : session
    ));
    const next = shiftFollowing && value
      ? applyPlanDates(withDate, value, dateInterval, index, { preserveManual: false })
      : withDate;
    skipDirtyRef.current = true;
    commitSessions(next);
    setDateConfirm(null);
    if (shiftFollowing) {
      await persistDateShifts(previous, next);
      return;
    }
    const session = next[index];
    if (session?.id) {
      try {
        await updateLessonPlanItem(session.id, buildPlanItemApiPayload(session, index + 1));
      } catch (err) {
        showToast(err?.message || "Не удалось сохранить дату. Нажмите «Сохранить план».");
      }
    }
  }, [commitSessions, dateInterval, persistDateShifts, showToast]);

  const handleSessionDateChange = useCallback((index, value) => {
    const currentSessions = sessionsRef.current;
    const current = calendarDateKey(currentSessions[index]?.scheduledDate);
    const nextValue = calendarDateKey(value);
    if (nextValue === current) return;

    const planned = plannedDateAtIndex(currentSessions, index, dateInterval);
    const deviation = planned && nextValue ? describeDateDeviation(planned, nextValue, dateInterval) : null;
    const conflictCount = nextValue ? countSessionsOnDate(currentSessions, nextValue, index) : 0;
    const needsDeviationConfirm = Boolean(deviation && !deviation.sameDay);
    const needsConflictNotice = conflictCount > 0;

    if (!nextValue || (!needsDeviationConfirm && !needsConflictNotice)) {
      void applySessionDate(index, nextValue);
      return;
    }

    setDateConfirm({
      index,
      nextValue,
      plannedIso: planned,
      conflictCount,
      canShiftFollowing: Boolean(nextValue && index < currentSessions.length - 1 && needsDeviationConfirm),
      deviation,
    });
  }, [applySessionDate, dateInterval]);

  const handleRestorePlannedDate = useCallback((index) => {
    const planned = plannedDateAtIndex(sessionsRef.current, index, dateInterval);
    if (!planned) return;
    void applySessionDate(index, planned);
  }, [applySessionDate, dateInterval]);

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

  const persistOrderWithRollback = useCallback(async (nextSessions, previousSessions, move = null) => {
    const items = nextSessions
      .map((session, order) => (session.id ? { id: session.id, order: order + 1 } : null))
      .filter(Boolean);
    setOrderStatus("saving");
    setOrderRetry(null);
    try {
      if (items.length > 1) {
        await reorderLessonPlanItems(items);
      }
      for (let index = 0; index < nextSessions.length; index += 1) {
        const session = nextSessions[index];
        if (!session?.id) continue;
        const previous = previousSessions.find((item) => item.id && item.id === session.id);
        if (previous && topicKeyOf(previous) !== topicKeyOf(session)) {
          await updateLessonPlanItem(session.id, buildPlanItemApiPayload(session, index + 1));
        }
      }
      setOrderStatus("saved");
    } catch {
      setSessions(previousSessions);
      if (move) {
        setExpandedIndex((index) => mapIndexAfterMove(index, move.toIndex, move.fromIndex));
      }
      setOrderRetry({ next: nextSessions, previous: previousSessions, move });
      setOrderStatus("error");
    }
  }, []);

  const moveSession = useCallback((index, dir) => {
    const target = index + dir;
    setSessions((prev) => {
      if (target < 0 || target >= prev.length) return prev;
      const next = applyReorderWithTopic(prev, index, target);
      void persistOrderWithRollback(next, prev, { fromIndex: index, toIndex: target });
      return next;
    });
    setExpandedIndex((prev) => mapIndexAfterMove(prev, index, target));
  }, [persistOrderWithRollback]);

  const handlePointerReorder = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    setSessions((prev) => {
      const next = applyReorderWithTopic(prev, fromIndex, toIndex);
      void persistOrderWithRollback(next, prev, { fromIndex, toIndex });
      return next;
    });
    setExpandedIndex((prev) => mapIndexAfterMove(prev, fromIndex, toIndex));
  }, [persistOrderWithRollback]);

  const handleMoveToTopic = useCallback((index, topic) => {
    setSessions((prev) => {
      const next = moveSessionToTopic(prev, index, topic);
      void persistOrderWithRollback(next, prev);
      return next;
    });
  }, [persistOrderWithRollback]);

  const handleRenameTopic = useCallback((group, nextTopic) => {
    const topic = String(nextTopic || "").trim();
    setRenamingTopicId(null);
    if (!group || topic === group.topicKey) return;
    setSessions((prev) => {
      const next = renameTopicInRange(prev, group.indices, topic);
      const changed = group.indices.filter((index) => topicKeyOf(prev[index]) !== topic);
      void (async () => {
        try {
          for (const index of changed) {
            const session = next[index];
            if (!session?.id) continue;
            await updateLessonPlanItem(session.id, buildPlanItemApiPayload(session, index + 1));
          }
        } catch {
          setSessions(prev);
          setOrderStatus("error");
        }
      })();
      return next;
    });
  }, []);

  const deleteSession = useCallback((index) => {
    const session = sessions[index];
    if (!session) return;
    setDeleteForce(false);
    setDeleteHint("");
    setDeleteTopicGroup(null);
    setDeleteSessionIndex(index);
  }, [sessions]);

  const deleteTopic = useCallback((group) => {
    if (!group?.indices?.length) return;
    setDeleteForce(false);
    setDeleteHint("");
    setDeleteSessionIndex(null);
    setDeleteTopicGroup(group);
  }, []);

  const confirmDeleteItems = useCallback(async (indices) => {
    const unique = [...new Set(indices)].sort((a, b) => a - b);
    if (!unique.length) return true;
    const toDelete = unique.map((index) => sessions[index]).filter(Boolean);
    try {
      for (const session of [...toDelete].reverse()) {
        if (!session.id) continue;
        try {
          await deleteLessonPlanItem(session.id, { force: deleteForce });
        } catch (err) {
          if (err?.status === 404) continue;
          throw err;
        }
      }
      await applyRemovedSessions(unique);
      setDeleteSessionIndex(null);
      setDeleteTopicGroup(null);
      setDeleteForce(false);
      setDeleteHint("");
      return true;
    } catch (err) {
      if (err?.status === 409 && (err?.code === "item_in_use" || err?.data?.code === "item_in_use")) {
        setDeleteForce(true);
        setDeleteHint(err.message || "Эта тема уже назначена на занятие.");
        return false;
      }
      showToast(err?.message || "Не удалось удалить.");
      return false;
    }
  }, [applyRemovedSessions, deleteForce, sessions, showToast]);

  const confirmDeleteSession = useCallback(async () => {
    if (deleteSessionIndex == null) return;
    setSavingSessionIndex(deleteSessionIndex);
    try {
      await confirmDeleteItems([deleteSessionIndex]);
    } finally {
      setSavingSessionIndex(null);
    }
  }, [confirmDeleteItems, deleteSessionIndex]);

  const confirmDeleteTopic = useCallback(async () => {
    if (!deleteTopicGroup?.indices?.length) return;
    setSavingSessionIndex(deleteTopicGroup.indices[0]);
    try {
      await confirmDeleteItems(deleteTopicGroup.indices);
    } finally {
      setSavingSessionIndex(null);
    }
  }, [confirmDeleteItems, deleteTopicGroup]);

  const ensurePlanId = useCallback(async () => {
    const existingId = createdPlanIdRef.current || activePlanId || planId;
    if (existingId && existingId !== "new") return existingId;
    if (creatingPlanRef.current) return creatingPlanRef.current;
    if (!title.trim()) {
      throw new Error("Сначала укажите название плана");
    }
    creatingPlanRef.current = (async () => {
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
      createdPlanIdRef.current = nextId;
      setActivePlanId(nextId);
      return nextId;
    })();
    try {
      return await creatingPlanRef.current;
    } catch (err) {
      creatingPlanRef.current = null;
      throw err;
    }
  }, [activePlanId, canPublishCatalog, description, goal, grade, makePublic, planId, planStatus, sessions.length, subject, title, type]);

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
      replaceSession(index, adoptApiSession(data, session));
    } catch (err) {
      setSessionErrors((prev) => ({
        ...prev,
        [index]: err?.message || "Не удалось сохранить занятие",
      }));
    } finally {
      setSavingSessionIndex(null);
    }
  }, [ensurePlanId, replaceSession, sessions]);

  const duplicateSession = useCallback((index) => {
    setSessions((prev) => {
      const next = [...prev];
      const copy = clonePlanSession(prev[index]);
      if (prev[index]?.scheduledDate) {
        copy.scheduledDate = nextPlanDateAfter(prev[index].scheduledDate, index, dateInterval);
      }
      next.splice(index + 1, 0, copy);
      return next;
    });
    setExpandedIndex(index + 1);
  }, [dateInterval]);

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
      session = adoptApiSession(data, session);
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

  const addSession = useCallback((afterIndex, topic = "") => {
    const insertAfter = typeof afterIndex === "number" ? afterIndex : null;
    setSessions((prev) => {
      const insertAt = insertAfter == null ? prev.length : insertAfter + 1;
      const nextSession = clonePlanSession(EMPTY_PLAN_SESSION);
      if (topic) nextSession.topic = topic;
      const neighbor = prev[insertAt - 1] || prev[prev.length - 1];
      if (neighbor?.scheduledDate) {
        nextSession.scheduledDate = nextPlanDateAfter(neighbor.scheduledDate, Math.max(0, insertAt - 1), dateInterval);
      }
      const next = [...prev];
      next.splice(insertAt, 0, nextSession);
      setExpandedIndex(insertAt);
      return next;
    });
  }, [dateInterval]);

  const excelSettings = useCallback(() => ({
    title: title.trim(),
    subject,
    direction: type,
    grade,
    start_date: calendarDateKey(sessionsRef.current[0]?.scheduledDate),
    interval: dateInterval,
  }), [dateInterval, grade, subject, title, type]);

  const handleDownloadExcelTemplate = useCallback(async () => {
    try {
      await downloadLessonPlanExcelTemplate(excelSettings());
    } catch (err) {
      showToast(err?.message || "Не удалось скачать шаблон.");
    }
  }, [excelSettings, showToast]);

  const handleExportExcel = useCallback(async () => {
    const current = sessionsRef.current;
    const persistable = current.filter((session) => sessionHasPersistableContent(session));
    const items = persistable.map((session, index) => {
      const scheduled = calendarDateKey(session.scheduledDate);
      const manual = session.dateSource === "manual"
        || (index > 0 && scheduled && isManualDateOverride(persistable, index, dateInterval));
      return {
        id: session.id || "",
        order: index + 1,
        title: session.title,
        topic: session.topic,
        subtopic: session.subtopic,
        task_number: session.examTask,
        goal: session.goal,
        description: session.brief,
        homework_description: session.homeworkDescription,
        teacher_comment: session.comment,
        scheduled_date: scheduled,
        date_source: scheduled ? (manual ? "manual" : "automatic") : "",
      };
    });
    try {
      await exportLessonPlanExcelDraft({ ...excelSettings(), items });
    } catch (err) {
      showToast(err?.message || "Не удалось экспортировать план.");
    }
  }, [dateInterval, excelSettings, showToast]);

  const buildExcelForm = useCallback((file, mode) => {
    const form = new FormData();
    form.append("file", file);
    if (mode) form.append("mode", mode);
    const settings = excelSettings();
    if (settings.start_date) form.append("start_date", settings.start_date);
    if (settings.interval) form.append("interval", settings.interval);
    const planKey = savedPlanKey();
    if (planKey) form.append("plan_id", planKey);
    return form;
  }, [excelSettings, savedPlanKey]);

  const handleExcelFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!String(file.name || "").toLowerCase().endsWith(".xlsx")) {
      showToast("Нужен файл в формате .xlsx.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      showToast("Файл слишком большой. Загрузите Excel размером до 4 МБ.");
      return;
    }
    setExcelPreviewLoading(true);
    try {
      const preview = await previewLessonPlanExcel(buildExcelForm(file, "replace_all"));
      excelFileHoldRef.current = file;
      setExcelPreview(preview);
    } catch (err) {
      excelFileHoldRef.current = null;
      setExcelPreview(null);
      showToast(err?.message || "Не удалось прочитать Excel.");
    } finally {
      setExcelPreviewLoading(false);
    }
  }, [buildExcelForm, showToast]);

  const handleExcelModeChange = useCallback(async (mode) => {
    const file = excelFileHoldRef.current;
    if (!file || !mode) return;
    setExcelPreviewLoading(true);
    try {
      const preview = await previewLessonPlanExcel(buildExcelForm(file, mode));
      setExcelPreview(preview);
    } catch (err) {
      showToast(err?.message || "Не удалось обновить предпросмотр.");
    } finally {
      setExcelPreviewLoading(false);
    }
  }, [buildExcelForm, showToast]);

  const handleConfirmExcelImport = useCallback(async (mode) => {
    const file = excelFileHoldRef.current;
    if (!file) return;
    if (!title.trim()) {
      showToast("Сначала укажите название плана.");
      return;
    }
    setExcelImporting(true);
    try {
      const planKey = await ensurePlanId();
      const result = await importLessonPlanExcel(planKey, buildExcelForm(file, mode));
      const items = result?.plan?.items;
      if (Array.isArray(items)) {
        const dateById = Object.fromEntries(
          (result?.item_dates || []).map((row) => [String(row.id), row.date_source || ""]),
        );
        const mapped = items.map((item) => ({
          ...mapApiItemResponseToSession(item),
          dateSource: dateById[String(item.id)] || "",
        }));
        skipDirtyRef.current = true;
        setSessions(mapped);
        setDateInterval(inferPlanDateInterval(mapped));
        setExpandedIndex(mapped.length ? 0 : null);
      }
      const importedPlan = result?.plan;
      if (importedPlan?.subject) setSubject(importedPlan.subject);
      if (importedPlan?.direction) setType(importedPlan.direction);
      if (importedPlan?.grade != null) setGrade(importedPlan.grade || "");
      const appliedMode = result?.summary?.mode || mode;
      const added = result?.summary?.created ?? 0;
      const updated = result?.summary?.updated ?? 0;
      const skipped = result?.summary?.skipped ?? 0;
      let message = "План импортирован.";
      if (appliedMode === "replace_all") {
        const count = Array.isArray(items) ? items.length : added;
        message = `План обновлён целиком: ${count} уроков из Excel.`;
      } else if (appliedMode === "insert") {
        message = `Добавлено уроков: ${added}. Последующие занятия сдвинуты по расписанию.`;
      } else if (appliedMode === "replace_dates") {
        message = `Заменено уроков: ${updated}.`;
      }
      if (skipped) message = `${message} ${skipped} пустых строк пропущены.`;
      showToast(message);
      setExcelPreview(null);
      excelFileHoldRef.current = null;
    } catch (err) {
      showToast(err?.message || "Не удалось импортировать план.");
    } finally {
      setExcelImporting(false);
    }
  }, [buildExcelForm, ensurePlanId, showToast, title]);

  const {
    listRef,
    overlayRef,
    draggingIndex,
    dropIndex,
    isDragging,
    onHandlePointerDown,
  } = usePlanListPointerReorder({
    enabled: true,
    itemCount: sessions.length,
    onReorder: handlePointerReorder,
  });

  const dropLineIndex = visualDropLineIndex(draggingIndex, dropIndex, sessions.length);

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
    setPlanDirty(true);
    setAutoSavedAt(null);
  }, [title, type, subject, goal, description, grade, sessions, makePublic, planStatus, loadingExisting]);

  const persistPlanDraft = useCallback(async () => {
    if (!title.trim() || saving || autoSaving) return false;

    setAutoSaving(true);
    try {
      const targetPlanId = await ensurePlanId();
      const snapshot = sessionsRef.current;
      const payload = {
        title: title.trim(),
        direction: type,
        subject,
        goal,
        description,
        grade,
        lessons_count: snapshot.length,
        status: makePublic ? "published" : (planStatus || "draft"),
        ...(canPublishCatalog ? { is_public: makePublic } : {}),
      };
      await updateLessonPlan(targetPlanId, payload);

      const savedByKey = new Map();
      const savedItemIds = [];
      for (let i = 0; i < snapshot.length; i += 1) {
        const session = snapshot[i];
        const live = resolveLivePlanSession(sessionsRef.current, session, i);
        if (!live || !sessionHasPersistableContent(live)) continue;
        const itemPayload = {
          ...buildPlanItemApiPayload(live, i + 1),
          title: sessionPersistTitle(live, i),
        };
        const data = (live.id || session.id)
          ? await updateLessonPlanItem(live.id || session.id, itemPayload)
          : await addLessonPlanItem(targetPlanId, itemPayload);
        savedByKey.set(sessionListKey(session, i), data);
        savedItemIds.push(data.id);
      }

      skipDirtyRef.current = true;
      setPlanDirty(false);
      setSessions((prev) => prev.map((session, index) => {
        const remote = savedByKey.get(sessionListKey(session, index));
        if (!remote) return session;
        return keepLocalSessionWithRemoteId(session, { id: remote.id });
      }));
      if (savedItemIds.length > 1) {
        await reorderLessonPlanItems(savedItemIds.map((id, order) => ({ id, order: order + 1 })));
      }
      if (isNew && String(planId) !== String(targetPlanId)) {
        navigate(`/cabinet/plans/${targetPlanId}/edit`, { replace: true });
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
    isNew,
    makePublic,
    navigate,
    planId,
    planStatus,
    saving,
    subject,
    title,
    type,
  ]);

  useAutoSave({
    enabled: !loadingExisting && Boolean(title.trim()),
    isDirty: true,
    isSaving: saving || autoSaving || schedulingFirst || orderStatus === "saving",
    onSave: persistPlanDraft,
  });

  const handleSave = async () => {
    if (!title.trim() || saving || autoSaving) return false;
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
      let savedPlanId = createdPlanIdRef.current || activePlanId || planId;

      if (isNew && (!savedPlanId || savedPlanId === "new")) {
        savedPlanId = await ensurePlanId();
      }
      const snapshot = sessionsRef.current;
      await updateLessonPlan(savedPlanId, payload);
      const savedItems = [];
      for (let i = 0; i < snapshot.length; i++) {
        const session = snapshot[i];
        const live = resolveLivePlanSession(sessionsRef.current, session, i);
        if (!live || !sessionHasPersistableContent(live)) continue;
        const itemPayload = {
          ...buildPlanItemApiPayload(live, i + 1),
          title: sessionPersistTitle(live, i),
        };
        if (live.id || session.id) {
          const data = await updateLessonPlanItem(live.id || session.id, itemPayload);
          savedItems.push(data.id);
        } else {
          const data = await addLessonPlanItem(savedPlanId, itemPayload);
          savedItems.push(data.id);
        }
      }
      if (savedItems.length > 1) {
        await reorderLessonPlanItems(savedItems.map((id, order) => ({ id, order: order + 1 })));
      }
      skipDirtyRef.current = true;
      setPlanDirty(false);
      setAutoSavedAt(Date.now());
      if (String(planId) !== String(savedPlanId)) {
        navigate(`/cabinet/plans/${savedPlanId}/edit`, { replace: true });
      }
      return true;
    } catch (err) {
      showToast(err?.message || "Не удалось сохранить план");
      return false;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!planDirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onDocumentClick = (event) => {
      if (event.defaultPrevented) return;
      const link = event.target?.closest?.("a[href]");
      if (!link || link.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      let url;
      try {
        url = new URL(link.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!url.pathname.startsWith("/cabinet")) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaveTo(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [planDirty]);

  const pickerSession = resourcesPicker ? sessions[resourcesPicker.sessionIndex] : null;

  if (loadingExisting) {
    return (
      <CabinetPageShell className="cb-section--plan-editor">
        <PlanEditorSkeleton />
      </CabinetPageShell>
    );
  }
  if (notFound) return <Navigate to="/cabinet/plans" replace />;

  const backHref = isNew ? "/cabinet/plans" : `/cabinet/plans/${planId}`;
  const saveBusy = saving || autoSaving;
  const saveState = orderStatus === "error"
    ? { kind: "error", label: "Не удалось сохранить" }
    : (orderStatus === "saving" || autoSaving || saving)
      ? { kind: "saving", label: "Сохранение…" }
      : planDirty
        ? { kind: "dirty", label: "Есть несохранённые изменения" }
        : (orderStatus === "saved" || autoSavedAt)
          ? { kind: "saved", label: "Сохранено" }
          : null;
  const dragged = draggingIndex != null ? sessions[draggingIndex] : null;
  const canExportExcel = sessions.some((session) => sessionHasPersistableContent(session));
  const closeExcelMenus = () => {
    setMoreOpen(false);
    setExcelMenuOpen(false);
  };
  const retryOrderSave = () => {
    if (!orderRetry) return;
    setSessions(orderRetry.next);
    if (orderRetry.move) {
      setExpandedIndex((index) => mapIndexAfterMove(
        index,
        orderRetry.move.fromIndex,
        orderRetry.move.toIndex,
      ));
    }
    persistOrderWithRollback(orderRetry.next, orderRetry.previous, orderRetry.move);
  };
  const renderExcelMenuItems = (withPhone = false) => (
    <>
      {withPhone ? <p className="cb-pe-menu__label">Excel</p> : null}
      <button
        type="button"
        className="cb-pe-menu__item cb-pe-menu__item--stack"
        onClick={() => {
          closeExcelMenus();
          excelFileRef.current?.click();
        }}
      >
        <span>↑ Импортировать из Excel</span>
        <span className="cb-pe-menu__item-hint">Добавить или изменить уроки из .xlsx</span>
      </button>
      <button
        type="button"
        className="cb-pe-menu__item cb-pe-menu__item--stack"
        disabled={!canExportExcel}
        title={canExportExcel ? undefined : "Сначала добавьте хотя бы один урок"}
        aria-label={canExportExcel ? "Экспортировать текущий план" : "Экспортировать текущий план. Сначала добавьте хотя бы один урок"}
        onClick={() => {
          if (!canExportExcel) return;
          closeExcelMenus();
          void handleExportExcel();
        }}
      >
        <span>↓ Экспортировать текущий план</span>
        <span className="cb-pe-menu__item-hint">
          {canExportExcel ? "Скачать этот план для редактирования" : "Нет уроков для экспорта"}
        </span>
      </button>
      <button
        type="button"
        className="cb-pe-menu__item cb-pe-menu__item--stack"
        onClick={() => {
          closeExcelMenus();
          void handleDownloadExcelTemplate();
        }}
      >
        <span>▤ Скачать шаблон</span>
        <span className="cb-pe-menu__item-hint">Создать новый Excel-файл с нуля</span>
      </button>
    </>
  );
  const saveStatusEl = saveState ? (
    <span className={`cb-pe-save-state cb-pe-save-state--${saveState.kind}`} role="status">
      {saveState.kind === "saved" ? (
        <span aria-hidden="true">✓</span>
      ) : saveState.kind === "dirty" ? (
        <span aria-hidden="true">●</span>
      ) : null}
      {saveState.label}
      {saveState.kind === "error" ? (
        <button type="button" className="cb-pe-save-state__retry" onClick={retryOrderSave}>
          Повторить
        </button>
      ) : null}
    </span>
  ) : null;

  return (
    <CabinetPageShell className="cb-section--plan-editor">
      {toast}

      <header className="cb-pe-header">
        <div className="cb-pe-header__left">
          <Link to={backHref} className="cb-pe-header__back">
            <CabinetIcon name="arrowLeft" />
            <span className="cb-pe-header__back-full">Назад к планам</span>
            <span className="cb-pe-header__back-short">План уроков</span>
          </Link>
          <div className="cb-pe-header__title-wrap">
            <h1 className="cb-pe-header__title">План уроков</h1>
            <p className="cb-pe-header__subtitle">
              Настройте расписание и последовательность занятий.
            </p>
          </div>
          {saveStatusEl}
        </div>
        <div className="cb-pe-header__actions">
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-pe-header__excel"
            aria-label="Excel"
            aria-expanded={excelMenuOpen}
            onClick={(event) => {
              setMoreOpen(false);
              setExcelMenuAnchor(event.currentTarget);
              setExcelMenuOpen((open) => !open);
            }}
          >
            Excel <span className="cb-pe-header__chevron" aria-hidden="true">▾</span>
          </button>
          <CabinetFloatingMenu
            open={excelMenuOpen}
            anchorEl={excelMenuAnchor}
            onClose={() => setExcelMenuOpen(false)}
            className="cb-pe-menu cb-pe-menu--excel"
            width={320}
          >
            {renderExcelMenuItems()}
          </CabinetFloatingMenu>
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-pe-header__save"
            onClick={() => void handleSave()}
            disabled={saveBusy || !title.trim()}
            aria-label="Сохранить план"
          >
            {saveBusy ? "Сохранение…" : "Сохранить"}
          </button>
          <button type="button" className="cb-btn cb-btn--primary cb-pe-header__add" onClick={() => addSession()}>
            <CabinetIcon name="plus" />
            <span className="cb-pe-header__add-full">Добавить урок</span>
            <span className="cb-pe-header__add-short">Урок</span>
          </button>
          <button
            type="button"
            className="cb-btn cb-btn--ghost cb-pe-header__more"
            aria-label="Дополнительные действия"
            aria-expanded={moreOpen}
            onClick={(event) => {
              setExcelMenuOpen(false);
              setMoreAnchor(event.currentTarget);
              setMoreOpen((open) => !open);
            }}
          >
            <CabinetIcon name="more" />
          </button>
          <CabinetFloatingMenu
            open={moreOpen}
            anchorEl={moreAnchor}
            onClose={() => setMoreOpen(false)}
            className={`cb-pe-menu${isPhone ? " cb-pe-menu--sheet" : ""}`}
            placement={isPhone ? "sheet" : "anchor"}
            width={320}
          >
            {isPhone ? <p className="cb-pe-menu__title">Действия с планом</p> : null}
            <button
              type="button"
              className="cb-pe-menu__item"
              disabled={saveBusy || !title.trim()}
              onClick={() => { setMoreOpen(false); void handleSave(); }}
            >
              {saveBusy ? "Сохранение…" : "Сохранить"}
            </button>
            <button type="button" className="cb-pe-menu__item" onClick={() => { setMoreOpen(false); handlePreview(); }}>
              Предпросмотр
            </button>
            <button
              type="button"
              className="cb-pe-menu__item"
              onClick={() => {
                setMoreOpen(false);
                setHelpOpen(true);
              }}
            >
              Как составить план уроков
            </button>
            {renderExcelMenuItems(isPhone)}
            <div className="cb-pe-menu__divider" role="separator" />
            <button
              type="button"
              className="cb-pe-menu__item"
              disabled={schedulingFirst || sessions.length === 0}
              onClick={() => { setMoreOpen(false); handleScheduleFirst(); }}
            >
              {schedulingFirst ? "Подготовка…" : "Запланировать первое"}
            </button>
            {!isNew ? (
              <Link to={`/cabinet/plans/${planId}`} className="cb-pe-menu__item" onClick={() => setMoreOpen(false)}>
                Открыть карточку плана
              </Link>
            ) : null}
            <button
              type="button"
              className="cb-pe-menu__item"
              onClick={() => {
                setMoreOpen(false);
                if (planDirty) {
                  setLeaveTo("history-back");
                  return;
                }
                navigate(-1);
              }}
            >
              Отмена
            </button>
          </CabinetFloatingMenu>
        </div>
      </header>

      <section className="cb-pe-guide" aria-label="Как собрать план">
        <div className="cb-pe-guide__copy">
          <p className="cb-pe-guide__title">Как собрать план</p>
          <ol className="cb-pe-guide__steps">
            <li><span>1</span> Настройте план</li>
            <li><span>2</span> Выберите расписание</li>
            <li><span>3</span> Добавьте уроки</li>
            <li><span>4</span> Сохраните</li>
          </ol>
        </div>
        <button type="button" className="cb-pe-guide__help" onClick={() => setHelpOpen(true)}>
          <CabinetIcon name="help" /> Как это работает
        </button>
      </section>

      <section className="cb-pe-card" aria-labelledby="cb-pe-settings-title">
        <h2 id="cb-pe-settings-title" className="cb-pe-card__title">Основные настройки</h2>
        <div className="cb-pe-toolbar" role="group" aria-label="Параметры плана">
          <label className="cb-pe-control cb-pe-control--title">
            <span>Название плана</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например, Информатика — ЕГЭ"
              aria-label="Название плана"
            />
          </label>
          <label className="cb-pe-control">
            <span>Предмет</span>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={subjectsLoading && !subjectOptions.length}
              aria-label="Предмет"
            >
              {!subject ? <option value="">Предмет</option> : null}
              {subjectSelectOptions.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="cb-pe-control">
            <span>Уровень</span>
            <select
              value={type}
              disabled={levelsLoading && !levelOptions.length}
              aria-label="Уровень"
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
              {!type ? <option value="">Уровень</option> : null}
              {levelSelectOptions.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="cb-pe-control cb-pe-control--grade">
            <span>Класс</span>
            <input
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="10–11"
              aria-label="Класс"
              inputMode="numeric"
            />
          </label>
          {canPublishCatalog ? (
            <label className="cb-pe-field cb-pe-field--checkbox cb-pe-public">
              <input
                type="checkbox"
                checked={makePublic}
                onChange={(e) => setMakePublic(e.target.checked)}
              />
              <span>
                <strong>Опубликован</strong>
                <small>План появится в разделе «Готовые» у всех учителей</small>
              </span>
            </label>
          ) : null}
        </div>
      </section>

      <section className="cb-pe-card">
        <div className="cb-pe-accordion">
          <button
            type="button"
            className="cb-pe-accordion__toggle"
            aria-expanded={extraOpen}
            onClick={() => setExtraOpen((v) => !v)}
          >
            <span>
              <span className="cb-pe-card__title">Дополнительные настройки</span>
              <span className="cb-pe-accordion__hint">Цель и описание плана</span>
            </span>
            <span className={`cb-pe-session__chevron${extraOpen ? " is-open" : ""}`} aria-hidden="true" />
          </button>
          {extraOpen ? (
            <div className="cb-pe-accordion__body">
              <h3 className="cb-pe-subhead">О плане</h3>
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
      </section>

      {sessions.length > 0 ? (
        <section className="cb-pe-card" aria-labelledby="cb-pe-schedule-title">
          <h2 id="cb-pe-schedule-title" className="cb-pe-card__title">Расписание</h2>
          <div className="cb-pe-dates">
            <label className="cb-pe-field">
              <span>Дата первого занятия</span>
              <input
                type="date"
                value={calendarDateKey(sessions[0]?.scheduledDate) || ""}
                onChange={(e) => handleFirstDateChange(e.target.value)}
                aria-label="Дата первого занятия"
              />
              <small className="cb-pe-field__hint">С этой даты начнётся автоматическое расписание.</small>
            </label>
            <label className="cb-pe-field">
              <span>Как часто</span>
              <select
                value={dateInterval}
                onChange={(e) => handleDateIntervalChange(e.target.value)}
                aria-label="Как часто"
              >
                {PLAN_DATE_INTERVALS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
              <small className="cb-pe-field__hint">Используется для автоматического расчёта дат уроков.</small>
            </label>
          </div>
          <p className="cb-pe-info">
            Изменение расписания пересчитает автоматические даты. Даты, заданные вручную, сохраняются.
          </p>
          <p className="cb-pe-info">
            Если вы вручную измените дату отдельного урока, эта дата не будет автоматически сдвигаться вместе с остальными.
          </p>
        </section>
      ) : null}

      <section className="cb-pe-lessons" aria-labelledby="cb-pe-lessons-title">
        <div className="cb-pe-lessons__head">
          <div>
            <h2 id="cb-pe-lessons-title" className="cb-pe-card__title">Уроки</h2>
            {sessions.length ? <p className="cb-pe-statline">{statsLine}</p> : null}
            <p className="cb-pe-lessons__lead">
              Добавляйте уроки вручную или загрузите готовый план из Excel.
            </p>
          </div>
          {sessions.length > 0 ? (
            <div className="cb-pe-lessons__actions">
              <button type="button" className="cb-btn cb-btn--ghost" onClick={() => addSession()}>
                <CabinetIcon name="plus" /> Добавить урок
              </button>
              <button
                type="button"
                className="cb-btn cb-btn--ghost"
                onClick={() => excelFileRef.current?.click()}
              >
                Импортировать из Excel
              </button>
            </div>
          ) : null}
        </div>
        {orderStatus === "error" ? (
          <p className="cb-pe-order-error" role="alert">
            Не удалось сохранить порядок
            <button type="button" className="cb-btn cb-btn--ghost cb-btn--xs" onClick={retryOrderSave}>
              Повторить
            </button>
          </p>
        ) : null}
        {sessions.length > 0 ? (
          <p className="cb-pe-dnd-hint">
            <span className="cb-pe-dnd-hint__desktop">
              ↕ Перетаскивайте уроки за маркер слева, чтобы изменить порядок.
              Также порядок можно изменить через меню ⋯ урока.
            </span>
            <span className="cb-pe-dnd-hint__mobile">
              Порядок уроков можно изменить через меню урока.
            </span>
          </p>
        ) : null}

      {sessions.length === 0 ? (
        <div className="cb-pe-empty">
          <p className="cb-pe-empty__title">Пока нет уроков</p>
          <p className="cb-pe-empty__text">Добавьте первый урок или импортируйте готовый план из Excel.</p>
          <div className="cb-pe-empty__actions">
            <button type="button" className="cb-btn cb-btn--primary" onClick={() => addSession()}>
              <CabinetIcon name="plus" /> Добавить урок
            </button>
            <button
              type="button"
              className="cb-btn cb-btn--ghost"
              onClick={() => excelFileRef.current?.click()}
            >
              Импортировать Excel
            </button>
          </div>
        </div>
      ) : (
        <PlanSessionsList
          sessions={sessions}
          groups={topicGroups}
          showTopics={showTopics}
          expandedIndex={expandedIndex}
          draggingIndex={draggingIndex}
          dropLineIndex={dropLineIndex}
          attachingIndex={attachingIndex}
          savingSessionIndex={savingSessionIndex}
          sessionErrors={sessionErrors}
          renamingTopicId={renamingTopicId}
          listRef={listRef}
          onToggle={handleToggleSession}
          onChange={updateSession}
          onDateChange={handleSessionDateChange}
          onRestorePlannedDate={handleRestorePlannedDate}
          onMove={moveSession}
          onMoveToTopic={handleMoveToTopic}
          onDuplicate={duplicateSession}
          onOpenPicker={openResourcesPicker}
          onRemoveAttachment={handleRemoveAttachment}
          onSaveSession={saveSession}
          onDeleteSession={deleteSession}
          onDeleteTopic={deleteTopic}
          onHandlePointerDown={onHandlePointerDown}
          onStartRenameTopic={setRenamingTopicId}
          onCommitRenameTopic={handleRenameTopic}
          onCancelRenameTopic={() => setRenamingTopicId(null)}
          onAddInTopic={(index, topic) => addSession(index, topic)}
          dateDraftIndex={dateConfirm?.index}
          dateDraftValue={dateConfirm?.nextValue}
          plannedDates={plannedDates}
        />
      )}
      </section>

      <div
        ref={overlayRef}
        className="cb-pe-drag-overlay"
        hidden={!isDragging || !dragged}
        role="presentation"
      >
        {dragged ? (
          <>
            <span className="cb-pe-session__num">{draggingIndex + 1}</span>
            <strong>{dragged.title.trim() || dragged.subtopic.trim() || `Урок ${draggingIndex + 1}`}</strong>
          </>
        ) : null}
      </div>

      <PlanEditorHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <div className="cb-pe-mobile-bar" hidden>
        <button type="button" className="cb-btn cb-btn--primary" onClick={() => addSession()}>
          <CabinetIcon name="plus" /> Добавить урок
        </button>
        <button
          type="button"
          className="cb-btn cb-btn--ghost"
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

      <input
        ref={excelFileRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={handleExcelFile}
      />
      {excelPreview ? (
        <PlanExcelImportModal
          preview={excelPreview}
          hasExistingLessons={sessions.some((session) => sessionHasPersistableContent(session))}
          loading={excelImporting}
          previewLoading={excelPreviewLoading}
          onClose={() => {
            if (excelImporting) return;
            setExcelPreview(null);
            excelFileHoldRef.current = null;
          }}
          onModeChange={handleExcelModeChange}
          onConfirm={handleConfirmExcelImport}
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
        open={Boolean(leaveTo)}
        title="Несохранённые изменения"
        text="Изменения ещё не сохранены. Нажмите «Сохранить», чтобы не потерять их, или уйдите без сохранения."
        confirmLabel="Уйти без сохранения"
        cancelLabel="Остаться"
        danger
        onClose={() => setLeaveTo(null)}
        onConfirm={() => {
          const target = leaveTo;
          setLeaveTo(null);
          setPlanDirty(false);
          if (target === "history-back") navigate(-1);
          else if (target) navigate(target);
        }}
      />

      <ConfirmActionModal
        open={deleteSessionIndex != null}
        title={
          deleteForce
            ? "Тема уже назначена на занятие"
            : deleteSessionIndex == null
              ? "Удалить занятие?"
              : `Удалить занятие «${sessionDisplayTitle(sessions[deleteSessionIndex], deleteSessionIndex)}»?`
        }
        text={
          deleteForce
            ? `${deleteHint || "Эта тема уже назначена на занятие."} Удалить тему из плана и оставить занятие без темы?`
            : willCompressDatesAfterRemove(sessions, [deleteSessionIndex])
              ? "Следующие занятия автоматически займут освободившиеся даты в плане."
              : "Занятие будет удалено из плана."
        }
        confirmLabel={deleteForce ? "Удалить тему" : "Удалить"}
        danger
        loading={savingSessionIndex === deleteSessionIndex && deleteSessionIndex != null}
        onClose={() => {
          if (savingSessionIndex !== deleteSessionIndex) {
            setDeleteSessionIndex(null);
            setDeleteForce(false);
            setDeleteHint("");
          }
        }}
        onConfirm={confirmDeleteSession}
      />

      <ConfirmActionModal
        open={deleteTopicGroup != null}
        title={
          deleteForce
            ? "Тема уже назначена на занятие"
            : `Удалить тему «${deleteTopicGroup?.topic || "Без темы"}»?`
        }
        text={
          deleteForce
            ? `${deleteHint || "Эта тема уже назначена на занятие."} Удалить тему из плана и оставить занятие без темы?`
            : (
              <>
                <p className="cb-confirm-text">
                  {willCompressDatesAfterRemove(sessions, deleteTopicGroup?.indices || [])
                    ? "Следующие темы автоматически займут освободившиеся даты в плане."
                    : "Тема будет удалена из плана."}
                </p>
                {(deleteTopicGroup?.indices?.length || 0) > 1 ? (
                  <p className="cb-confirm-text">
                    В теме {deleteTopicGroup.indices.length} {lessonsWord(deleteTopicGroup.indices.length)} — они будут удалены.
                  </p>
                ) : null}
              </>
            )
        }
        confirmLabel="Удалить"
        danger
        loading={Boolean(deleteTopicGroup) && savingSessionIndex === deleteTopicGroup?.indices?.[0]}
        onClose={() => {
          if (savingSessionIndex !== deleteTopicGroup?.indices?.[0]) {
            setDeleteTopicGroup(null);
            setDeleteForce(false);
            setDeleteHint("");
          }
        }}
        onConfirm={confirmDeleteTopic}
      />

      <ConfirmActionModal
        open={dateConfirm != null}
        title="Сохранить изменение даты?"
        text={dateConfirm ? (
          <>
            {dateConfirm.deviation?.message ? (
              <p className="cb-confirm-text">{dateConfirm.deviation.message}</p>
            ) : null}
            {dateConfirm.deviation?.extra ? (
              <p className="cb-confirm-text">{dateConfirm.deviation.extra}</p>
            ) : null}
            {dateConfirm.conflictCount > 0 ? (
              <p className="cb-confirm-text">На эту дату уже запланировано другое занятие.</p>
            ) : null}
            <p className="cb-confirm-text">Сохранить изменение?</p>
          </>
        ) : null}
        confirmLabel={dateConfirm?.conflictCount > 0 ? "Всё равно сохранить" : "Изменить только эту дату"}
        secondaryConfirmLabel={dateConfirm?.canShiftFollowing ? "Сдвинуть эту и следующие" : undefined}
        loading={false}
        onClose={() => setDateConfirm(null)}
        onConfirm={() => {
          if (!dateConfirm) return;
          void applySessionDate(dateConfirm.index, dateConfirm.nextValue);
        }}
        onSecondaryConfirm={dateConfirm?.canShiftFollowing ? () => {
          void applySessionDate(dateConfirm.index, dateConfirm.nextValue, { shiftFollowing: true });
        } : undefined}
      />
    </CabinetPageShell>
  );
}
