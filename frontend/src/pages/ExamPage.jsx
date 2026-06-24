import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation, Link, useNavigate } from "react-router-dom";
import MathContent from "../components/MathContent";
import { devApiBase } from "../utils/devApiBase";
import { isEgeInfTruthTableTask, isEgeInfParallelProcessesTask, isEgeInfRoadGraphTask, isEgeInformaticsContext, isInformaticsCodeEditorContext } from "../utils/isOgeInformaticsTask";

const InformaticsCodeEditorEntry = lazy(
  () => import("../components/InformaticsCodeEditor/InformaticsCodeEditorEntry")
);
import TaskFileAttachment from "../components/TaskFileAttachment";
import ImageLightbox from "../components/ImageLightbox";
import SupportInfoModal from "../components/SupportInfoModal";
import ResultsModal from "../components/ResultsModal";
import ReportErrorModal from "../components/ReportErrorModal";
import ExamBoardOverlay from "../components/ExamBoardOverlay";
import ExamTaskDrawingShell, { ExamTaskDrawingHeaderButton } from "../components/ExamTaskDrawingShell";
import EduVariantSidebarCard from "../components/EduVariantSidebarCard";
import { ExamVariantTimerReadout, ExamVariantFixedTimer } from "../components/ExamVariantTimerReadout";
import { createExamVariantTimerStore } from "../utils/examVariantTimerStore";
import TruthTableInput from "../components/TruthTableInput";
import {
  getTruthTableConfig,
  sanitizeTruthTableAnswerString,
  truthTableAnswerMaxChars,
} from "../utils/truthTable";
import { getShareablePageUrl } from "../utils/shareablePageUrl";
import {
  parseHomeworkFromSearchForExam,
  getLkPublicBase,
  fetchHomeworkAssignment,
  pickHomeworkFields,
  homeworkResultToUiState,
  buildHomeworkResultPayload,
  saveHomeworkDraft,
  submitHomework,
  homeworkApiUserMessage,
  homeworkTaskNumberEditable,
  homeworkIsReadonly,
  homeworkIsReviewed,
  homeworkShowSolutions,
  homeworkTaskAttachments,
  uploadHomeworkAnswer,
  deleteHomeworkAnswer,
} from "../utils/cabinetHomework";
import HomeworkReviewResults, {
  HomeworkTaskReviewNote,
  buildHomeworkReviewFromVariant,
} from "../cabinet/HomeworkReviewResults";


function isMathLikeSubject(subject) {
  const s = String(subject || "").toLowerCase();
  return s === "math" || s === "math_base";
}

/** ОГЭ информатика, задание с номером n (API иногда отдаёт строку). */
function isOgeInformaticsTask(level, subject, taskNumber, n) {
  return (
    String(level || "").toLowerCase() === "oge" &&
    String(subject || "").toLowerCase() === "inf" &&
    Number(taskNumber) === n
  );
}

/** Подпись баллов для карточки критерия (1 балл / 2 балла / 5 баллов). */
function formatRuBalls(n) {
  const num = Math.trunc(Number(n));
  const abs = Math.abs(num) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return `${num} баллов`;
  if (d > 1 && d < 5) return `${num} балла`;
  if (d === 1) return `${num} балл`;
  return `${num} баллов`;
}

function parseMaybeJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function pickFirstNonEmptyString(values) {
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return "";
}

function TaskReportErrorButton({ taskId, taskNumber, onClick }) {
  return (
    <button
      type="button"
      className="task-report-error-btn"
      title="Сообщить об ошибке"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(taskId, taskNumber);
      }}
      aria-label="Сообщить об ошибке"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
      <span className="task-report-error-label">Сообщить об ошибке</span>
    </button>
  );
}

/** Урок/ДЗ: ученик прикрепляет файлы решения (часть 2). */
function LessonSolutionUpload({
  taskNumber,
  taskId,
  lessonToken,
  assignmentId,
  homeworkMode,
  cabinetMode,
  enabled,
  allowDelete,
  initialAttachments,
}) {
  const FILE_ACCEPT =
    ".kum,.xls,.xlsx,.xlsm,.xlsb,.csv,.tsv,.ods,.ots,.numbers,.png,.jpg,.jpeg,.webp,.gif,.bmp,.heic,.heif,.txt,.pdf,.doc,.docx,.odt,.rtf,.zip,.7z,.rar";
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sentPreviews, setSentPreviews] = useState(initialAttachments || []);
  
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreview, setPendingPreview] = useState(null);
  const initialAttachmentsKeyRef = useRef("");

  useEffect(() => {
    const key = JSON.stringify(initialAttachments || []);
    if (initialAttachmentsKeyRef.current === key) return;
    initialAttachmentsKeyRef.current = key;
    setSentPreviews(Array.isArray(initialAttachments) ? initialAttachments : []);
  }, [initialAttachments]);

  const canDeleteAttachment =
    allowDelete && (cabinetMode || homeworkMode) && !!assignmentId;

  if (!enabled) return null;
  if (!cabinetMode && !lessonToken) return null;

  const onFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    setPendingFile(file);
    setPendingPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    });
  };

  const onCancel = (e) => {
    e.stopPropagation();
    setPendingFile(null);
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingPreview(null);
    setErr(null);
  };

  const onSend = async (e) => {
    e.stopPropagation();
    if (!pendingFile) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append("task_number", String(taskNumber));
    if (taskId != null && String(taskId).trim() !== "") fd.append("task_id", String(taskId));
    if (!homeworkMode && !cabinetMode) {
      fd.append("lesson_token", lessonToken);
    }
    fd.append("file", pendingFile);
    try {
      const uploadOpts = lessonToken ? { lessonToken } : undefined;
      const useNativeHomeworkUpload = (cabinetMode || homeworkMode) && assignmentId;
      const data = useNativeHomeworkUpload
        ? await uploadHomeworkAnswer(assignmentId, fd, uploadOpts)
        : await (async () => {
            const res = await fetch("/api/lesson/attachment/", {
              method: "POST",
              body: fd,
              credentials: "include",
            });
            const parsed = await res.json().catch(() => ({}));
            if (!res.ok || (Object.prototype.hasOwnProperty.call(parsed, "ok") && !parsed.ok)) {
              throw new Error(parsed.error || "Не удалось загрузить файл");
            }
            return parsed;
          })();
      const url = String(data.url || "");
      const filename = String(data.filename || pendingFile.name);
      setSentPreviews((prev) => [...prev, { url, filename, isImage: pendingFile.type.startsWith("image/") }]);
      setPendingFile(null);
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingPreview(null);
    } catch (ex) {
      const raw = ex instanceof Error ? ex.message : String(ex || "");
      setErr(
        raw === "Failed to fetch"
          ? "Не удалось связаться с сервером. Проверьте подключение и попробуйте снова."
          : raw || "Ошибка загрузки"
      );
    } finally {
      setBusy(false);
    }
  };

  const onDeleteAttachment = async (e, attachmentUrl) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canDeleteAttachment || !attachmentUrl || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const uploadOpts = lessonToken ? { lessonToken } : undefined;
      await deleteHomeworkAnswer(
        assignmentId,
        { url: attachmentUrl, taskNumber, taskId },
        uploadOpts
      );
      setSentPreviews((prev) => {
        const next = prev.filter((p) => p.url !== attachmentUrl);
        initialAttachmentsKeyRef.current = JSON.stringify(next);
        return next;
      });
    } catch (ex) {
      const raw = ex instanceof Error ? ex.message : String(ex || "");
      setErr(
        raw === "Failed to fetch"
          ? "Не удалось связаться с сервером. Проверьте подключение и попробуйте снова."
          : raw || "Ошибка удаления"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lesson-solution-upload" onClick={(e) => e.stopPropagation()}>
      <div className="lesson-solution-upload__head">
        <span className="lesson-solution-upload__label">Прикрепить файлы</span>
        <span className="lesson-solution-upload__hint">PNG, PDF, DOC, XLS и другие форматы</span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        className="lesson-solution-file-input"
        tabIndex={-1}
        onChange={onFileSelect}
      />

      {!pendingFile ? (
        <div className="lesson-solution-picker">
          <button
            type="button"
            className="lesson-solution-picker-btn"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            Выбрать файл
          </button>
          <span className="lesson-solution-picker-name">Файл не выбран</span>
        </div>
      ) : (
        <div className="lesson-solution-pending">
          <div className="lesson-solution-pending-preview">
            {pendingPreview ? (
              <img
                src={pendingPreview}
                alt=""
                className="lesson-solution-pending-image"
              />
            ) : (
              <div className="lesson-solution-pending-file-icon" aria-hidden="true">
                📄
              </div>
            )}
            <div className="lesson-solution-pending-meta">
              <span className="lesson-solution-pending-file-name">{pendingFile.name}</span>
              <div className="lesson-solution-pending-actions">
                <button
                  type="button"
                  className="lesson-solution-pending-action lesson-solution-pending-action--ghost"
                  disabled={busy}
                  onClick={onCancel}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="lesson-solution-pending-action lesson-solution-pending-action--primary"
                  disabled={busy}
                  onClick={onSend}
                >
                  {busy ? "Отправка…" : "Прикрепить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {err ? <span className="lesson-solution-upload-error">{err}</span> : null}

      {sentPreviews.length > 0 ? (
        <div className="lesson-solution-previews">
          <span className="lesson-solution-previews__label">Прикреплено</span>
          <div className="lesson-solution-previews__grid">
            {sentPreviews.map((p, i) => {
              const src = lessonToken && !cabinetMode
                ? `${p.url}${p.url.includes("?") ? "&" : "?"}t=${encodeURIComponent(lessonToken)}`
                : p.url;
              return (
                <figure key={`${p.url}-${i}`} className="lesson-solution-preview-fig">
                  {canDeleteAttachment ? (
                    <button
                      type="button"
                      className="lesson-solution-preview-remove"
                      disabled={busy}
                      aria-label="Удалить файл"
                      title="Удалить файл"
                      onClick={(e) => onDeleteAttachment(e, p.url)}
                    >
                      ✕
                    </button>
                  ) : null}
                  {p.isImage ? (
                    <a href={src} target="_blank" rel="noreferrer" className="lesson-solution-preview-link">
                      <img src={src} alt="" className="lesson-solution-thumb" />
                    </a>
                  ) : (
                    <a href={src} target="_blank" rel="noreferrer" className="lesson-solution-file-item">
                      <span className="lesson-solution-file-item__icon" aria-hidden="true">📎</span>
                      <span className="lesson-solution-file-item__name">{p.filename || "Файл"}</span>
                    </a>
                  )}
                  {p.filename ? (
                    <figcaption className="lesson-solution-preview-cap">{p.filename}</figcaption>
                  ) : null}
                </figure>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const LEVEL_NAMES = {
  ege: "ЕГЭ",
  oge: "ОГЭ",
  vpr: "ВПР",
};

const SUBJECT_BADGE_NAMES = {
  inf: "Информатика",
  history: "История",
  rus: "Русский язык",
  chem: "Химия",
  phys: "Физика",
  lit: "Литература",
  bio: "Биология",
  math: "Математика",
  math_base: "Математика",
};

function examHeroExamBadge(mode, levelKey) {
  const lk = String(levelKey || "").toLowerCase();
  const L =
    LEVEL_NAMES[lk] ||
    (levelKey != null && levelKey !== "" ? String(levelKey).toUpperCase() : "—");
  if (mode === "part1") return `${L} · Часть 1`;
  if (mode === "part2") return `${L} · Часть 2`;
  if (mode === "test") return `${L} · Тренировка`;
  return `${L} · Полный вариант`;
}

function examHeroSubjectBadge(subjectKey, stateSubjectName) {
  const raw =
    stateSubjectName != null && String(stateSubjectName).trim() !== ""
      ? String(stateSubjectName).trim()
      : null;
  if (raw) return raw;
  return SUBJECT_BADGE_NAMES[String(subjectKey || "").toLowerCase()] || subjectKey;
}

function p1TaskStatusPill(
  task,
  subject,
  level,
  checkedTasks,
  userAnswers,
  scores,
  useTable,
  rows,
  cols,
  getTableAnswerForCheck,
  homeworkNoReveal = false,
  homeworkConfirmedTasks = {},
) {
  const inf2627Ege =
    subject === "inf" &&
    String(level || "").toLowerCase() === "ege" &&
    (task.number === 26 || task.number === 27);
  let draft = false;
  if (useTable && rows > 0 && cols > 0) {
    const s = getTableAnswerForCheck(task.id, rows, cols);
    draft = s.split(/\r?\n/).some((line) =>
      line.split(/\t/).some((c) => String(c).trim() !== "")
    );
  } else {
    draft =
      userAnswers[task.id] != null && String(userAnswers[task.id]).trim() !== "";
  }
  if (homeworkNoReveal) {
    if (homeworkConfirmedTasks[task.id]) return { key: "warn", label: "Подтверждено" };
    if (draft) return { key: "warn", label: "Ответ введён" };
    return { key: "neutral", label: "Не отвечено" };
  }
  if (inf2627Ege) {
    if (checkedTasks[task.id] !== undefined) {
      const sc = scores[task.id] ?? 0;
      if (sc >= 2) return { key: "ok", label: "Верно" };
      if (sc === 1) return { key: "warn", label: "Частично" };
      return { key: "bad", label: "Ошибка" };
    }
  } else {
    if (checkedTasks[task.id] === true) return { key: "ok", label: "Верно" };
    if (checkedTasks[task.id] === false) return { key: "bad", label: "Ошибка" };
  }
  if (draft) return { key: "warn", label: "Ответ введён" };
  return { key: "neutral", label: "Не проверено" };
}

function p2TaskStatusPill(task, selectedCriterionByTask, userAnswers, scorePart1Only = false, scores = {}, reviewed = false) {
  if (reviewed && scores[task.id] != null && scores[task.id] !== "") {
    return { key: "ok", label: `${scores[task.id]} б.` };
  }
  if (scorePart1Only) {
    const ua = userAnswers[task.id];
    if (ua != null && String(ua).trim() !== "")
      return { key: "warn", label: "Ответ введён" };
    return { key: "neutral", label: "Без оценки" };
  }
  if (selectedCriterionByTask[task.id] != null)
    return { key: "ok", label: "Оценено" };
  const ua = userAnswers[task.id];
  if (ua != null && String(ua).trim() !== "")
    return { key: "warn", label: "Ответ введён" };
  return { key: "neutral", label: "Не оценено" };
}

const EXAM_CORNER_POS_KEY = "exam_fixed_corner_pos";

/** Эталон «a или b» — засчитывается любой вариант после нормализации */
const SUBJECTS_WITH_OR_ALTERNATIVES = ["math", "math_base", "chem", "history"];

function clampExamCornerToViewport(el, left, top) {
  const margin = 8;
  const w = el.offsetWidth || 1;
  const h = el.offsetHeight || 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: Math.min(Math.max(margin, left), Math.max(margin, vw - w - margin)),
    top: Math.min(Math.max(margin, top), Math.max(margin, vh - h - margin)),
  };
}

function ExamPage() {
  const { level, subject, variant_id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const lessonEmbedParams = useMemo(() => {
    const sp = new URLSearchParams(location.search);
    return {
      embed: sp.get("lesson_embed") === "1",
      token: (sp.get("lesson_token") || "").trim(),
      student: sp.get("lesson_student") === "1",
    };
  }, [location.search]);
  const homeworkQuery = useMemo(() => {
    const sp = new URLSearchParams(location.search);
    const embed = sp.get("lesson_embed") === "1";
    return parseHomeworkFromSearchForExam(location.search, embed);
  }, [location.search]);
  const isHomework = homeworkQuery.isHomework;
  const isEmbeddedHomework = isHomework && lessonEmbedParams.embed;
  const isCabinetHomework = isHomework && !lessonEmbedParams.embed;
  /** Полноэкранный EdTech-макет с сайдбаром: не урок (в т.ч. ДЗ из кабинета ученика) */
  const showExamEducationShell = !lessonEmbedParams.embed;
  const cabinetAssignmentId = homeworkQuery.cabinetAssignment;
  const isTeacherHomeworkView =
    isHomework && lessonEmbedParams.embed && !lessonEmbedParams.student;
  const homeworkStudentMode = isHomework && !isTeacherHomeworkView;
  const [hwApiRaw, setHwApiRaw] = useState(null);
  const [hwLoading, setHwLoading] = useState(false);
  const [hwError, setHwError] = useState(null);
  const [hwActionBusy, setHwActionBusy] = useState(false);
  const [hwNotice, setHwNotice] = useState("");
  const [homeworkFieldsLocked, setHomeworkFieldsLocked] = useState(false);
  const [homeworkConfirmedTasks, setHomeworkConfirmedTasks] = useState({});
  const hwHydrateKeyRef = useRef("");
  const showLessonSolutionUpload =
    lessonEmbedParams.embed && lessonEmbedParams.student && !!lessonEmbedParams.token;
  const showCabinetPart2SolutionUpload =
    isCabinetHomework && homeworkStudentMode && !!cabinetAssignmentId;
  /** ДЗ из кабинета: без ID заданий, статус-плашек, номера варианта, PDF и ссылки */
  const hideHomeworkVariantChrome = isCabinetHomework && homeworkStudentMode;

  /**
   * Пока variant ещё null, рендер только «Загрузка…» без #main-wrapper — :has(#main-wrapper…) в CSS не срабатывает.
   * Классы на html/body/#root сохраняют фон-сетку / лаванду те же, что после загрузки.
   */
  useEffect(() => {
    const docEl = document.documentElement;
    const bodyEl = document.body;
    const appRoot = typeof document !== "undefined" ? document.getElementById("root") : null;
    docEl.classList.add("exam-variant-view");
    bodyEl.classList.add("exam-variant-view");
    appRoot?.classList.add("exam-variant-view");
    docEl.classList.toggle("exam-variant-view--edu", showExamEducationShell);
    bodyEl.classList.toggle("exam-variant-view--edu", showExamEducationShell);
    appRoot?.classList.toggle("exam-variant-view--edu", showExamEducationShell);

    return () => {
      docEl.classList.remove("exam-variant-view", "exam-variant-view--edu");
      bodyEl.classList.remove("exam-variant-view", "exam-variant-view--edu");
      appRoot?.classList.remove("exam-variant-view", "exam-variant-view--edu");
    };
  }, [showExamEducationShell]);

  const mode = location.state?.mode || "variant";
  const testTaskLabels = location.state?.testTaskLabels || [];

  const [variant, setVariant] = useState(null);
  const [error, setError] = useState(null);
  const [variantLoadingUrl, setVariantLoadingUrl] = useState("");

  // Ответы части 1
  const [userAnswers, setUserAnswers] = useState({}); // { taskId: "текст" }
  const [checkedTasks, setCheckedTasks] = useState({}); // { taskId: true/false } — какие проверены

  // Баллы части 2 — { taskId: число }
  const [scores, setScores] = useState({});

  // Показанные ответы части 2 — { taskId: true }
  const [visibleAnswers, setVisibleAnswers] = useState({});

  // Критерии части 2: панель открыта для taskId | null
  const [criteriaOpenForTask, setCriteriaOpenForTask] = useState(null);
  // Кэш критериев по task_list_id
  const [criteriaByTaskList, setCriteriaByTaskList] = useState({});
  // Выбранный критерий: { taskId: criterionId }
  const [selectedCriterionByTask, setSelectedCriterionByTask] = useState({});

  const timerStore = useMemo(() => createExamVariantTimerStore(), []);

  /** Весь фиксированный блок (таймеры, баллы, справка): развёрнут / свёрнут в полоску */
  const [examFixedPanelOpen, setExamFixedPanelOpen] = useState(true);

  // Загрузка PDF
  const [pdfLoading, setPdfLoading] = useState(null); // null | "default" | "cosmos" | "easter"

  // Копирование ссылки на вариант
  const [linkCopied, setLinkCopied] = useState(false);

  // Lightbox для увеличения изображений
  const [lightbox, setLightbox] = useState({ open: false, src: "" });
  const mainRef = useRef(null);
  const fixedCornerRef = useRef(null);
  const cornerDragRef = useRef({
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startLeft: 0,
    startTop: 0,
  });
  const pendingCornerPosRef = useRef(null);

  /** Пользовательская позиция блока таймера (fixed px), null — как в CSS (правый верх) */
  const [fixedCornerPos, setFixedCornerPos] = useState(null);
  const fixedCornerPosRef = useRef(null);
  useEffect(() => {
    fixedCornerPosRef.current = fixedCornerPos;
  }, [fixedCornerPos]);

  // Справочная информация (items = массив {html})
  const [supportInfo, setSupportInfo] = useState({ items: [], open: false });
  /** EdTech: открыть панель черновика у конкретного задания (после клика «Доска» в навигации). */
  const [eduOpenBoardForTaskId, setEduOpenBoardForTaskId] = useState(null);
  const [mobileVariantNavOpen, setMobileVariantNavOpen] = useState(false);
  const [boardsByTask, setBoardsByTask] = useState({});

  const boardPersistHasDraft = useCallback((persist) => {
    if (Array.isArray(persist?.overlayV1?.strokes) && persist.overlayV1.strokes.length > 0) return true;
    if (persist?.overlayV1?.snapshot && String(persist.overlayV1.snapshot).length > 400) return true;
    if (!persist?.history?.length) return false;
    const ix =
      typeof persist.historyIndex === "number" ? persist.historyIndex : persist.history.length - 1;
    if (ix < 0) return false;
    const e = persist.history[ix];
    if (typeof e === "string") return e.length > 2000;
    if (e?.objects?.length) return true;
    if (e?.bg && typeof e.bg === "string" && e.bg.length > 4500) return true;
    return false;
  }, []);

  const handleBoardPersist = useCallback((payload) => {
    if (!payload?.taskId) return;
    const id = String(payload.taskId);
    if (payload.overlayV1 !== undefined) {
      setBoardsByTask((prev) => ({
        ...prev,
        [id]: { ...prev[id], overlayV1: payload.overlayV1 },
      }));
      return;
    }
    setBoardsByTask((prev) => ({
      ...prev,
      [id]: {
        history: payload.history,
        historyIndex: payload.historyIndex,
      },
    }));
  }, []);

  // Результаты (всплывающее окно по кнопке «Завершить»)
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsData, setResultsData] = useState(null);

  // Сообщить об ошибке
  const [reportErrorOpen, setReportErrorOpen] = useState(false);
  const [reportErrorTask, setReportErrorTask] = useState(null);

  // Время на каждое задание (секунды)
  const taskTimesRef = useRef({});
  const currentTaskIdRef = useRef(null);
  /** Активная кнопка навигации по заданиям (десктопный сайдбар) */
  const [examNavActiveId, setExamNavActiveId] = useState(null);
  const startTimeRef = useRef(null);
  const endTimeRef = useRef(null);

  const openBoardForActiveEduTask = useCallback(() => {
    if (examNavActiveId == null) return;
    setEduOpenBoardForTaskId(examNavActiveId);
    requestAnimationFrame(() => {
      document.querySelector(`[data-task-id="${examNavActiveId}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  }, [examNavActiveId]);

  /* =========================
     Загрузка варианта
  ========================== */
  useEffect(() => {
    if (!level || !subject || !variant_id) {
      setError("Некорректный адрес варианта");
      setVariant(null);
      return undefined;
    }
    setError(null);
    setVariant(null);
    const idWanted = String(variant_id);
    const apiBase = devApiBase();
    const variantUrl = `${apiBase}/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/variant/${encodeURIComponent(String(variant_id))}/`;
    setVariantLoadingUrl(variantUrl);
    const ac = new AbortController();
    fetch(variantUrl, {
      credentials: apiBase ? "omit" : "same-origin",
      signal: ac.signal,
    })
      .then(async (res) => {
        const text = await res.text();
        let data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error(
              res.ok
                ? "Сервер вернул некорректный ответ при загрузке варианта."
                : `Ошибка загрузки варианта (${res.status || "ошибка сервера"})`
            );
          }
        }
        if (!res.ok) {
          const msg =
            res.status === 404
              ? "Вариант не найден или ссылка не совпадает с уровнем/предметом. Соберите вариант заново."
              : data?.error || `Ошибка загрузки варианта (${res.status})`;
          throw new Error(msg);
        }
        return data;
      })
      .then((data) => {
        if (ac.signal.aborted) return;
        if (!data || !Array.isArray(data.tasks)) {
          throw new Error("Сервер вернул неполные данные варианта");
        }
        if (data.tasks.length === 0) {
          throw new Error("Вариант создан, но в нём нет заданий. Проверьте базу данных или снимите фильтр «Только ФИПИ».");
        }
        if (String(data.id) !== idWanted) {
          throw new Error(`Сервер вернул вариант ${data.id}, ожидался ${idWanted}`);
        }
        setVariant(data);
        setVariantLoadingUrl("");
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(err.message || "Ошибка загрузки варианта");
        setVariantLoadingUrl("");
      });
    return () => ac.abort();
  }, [level, subject, variant_id]);

  useEffect(() => {
    if (!variant?.tasks?.length) return;
    const sorted = [...variant.tasks].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    const fid = sorted[0]?.id;
    if (fid != null) setExamNavActiveId(fid);
  }, [variant?.id, variant?.tasks]);

  useEffect(() => {
    if (!isHomework || !cabinetAssignmentId) {
      setHwApiRaw(null);
      setHwError(null);
      setHwLoading(false);
      return undefined;
    }
    let cancelled = false;
    setHwLoading(true);
    setHwError(null);
    const hwFetchOpts = lessonEmbedParams.token
      ? { lessonToken: lessonEmbedParams.token }
      : undefined;
    fetchHomeworkAssignment(cabinetAssignmentId, hwFetchOpts)
      .then((data) => {
        if (!cancelled) setHwApiRaw(data);
      })
      .catch((err) => {
        if (!cancelled) {
          const code = /** @type {{ status?: number }} */ (err)?.status;
          setHwError(code === 401 ? "unauthorized" : err?.message || "network");
        }
      })
      .finally(() => {
        if (!cancelled) setHwLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isHomework, cabinetAssignmentId, lessonEmbedParams.token]);

  useEffect(() => {
    if (!variant?.tasks || !hwApiRaw) return;
    const cab = cabinetAssignmentId || "";
    const picked = pickHomeworkFields(hwApiRaw, cab);
    const key = `${cab}|${picked.status}|${JSON.stringify(picked.result)}`;
    if (hwHydrateKeyRef.current === key) return;
    hwHydrateKeyRef.current = key;
    const m = new Map();
    for (const t of variant.tasks) m.set(String(t.number), t);
    const { userAnswers: ua, scores: sc, checkedTasks: ch } = homeworkResultToUiState(
      picked.result,
      m
    );
    setUserAnswers((p) => ({ ...p, ...ua }));
    setScores((p) => ({ ...p, ...sc }));
    if (ch && Object.keys(ch).length) setCheckedTasks((p) => ({ ...p, ...ch }));
  }, [variant, hwApiRaw, cabinetAssignmentId]);

  useEffect(() => {
    if (!homeworkStudentMode || !hwApiRaw) return;
    const picked = pickHomeworkFields(hwApiRaw, cabinetAssignmentId || "");
    if (homeworkIsReadonly(picked.status, isTeacherHomeworkView)) {
      setHomeworkFieldsLocked(true);
    }
  }, [homeworkStudentMode, hwApiRaw, cabinetAssignmentId, isTeacherHomeworkView]);

  /* =========================
     Справочная информация (ВПР: фильтр по классу варианта)
  ========================== */
  const supportInfoQuerySuffix = useMemo(() => {
    if (String(level).toLowerCase() !== "vpr" || !variant?.tasks?.length) return "";
    const nums = variant.tasks
      .map((t) => t.vpr_class)
      .filter((c) => c != null && c !== "" && !Number.isNaN(Number(c)))
      .map((c) => Number(c));
    if (nums.length === 0) return "";
    const uniq = [...new Set(nums)];
    const g = uniq.length === 1 ? uniq[0] : Math.min(...uniq);
    return `?vpr_class=${encodeURIComponent(g)}`;
  }, [level, variant]);

  useEffect(() => {
    if (!level || !subject) return undefined;
    const ac = new AbortController();
    const path = `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/support-info/${supportInfoQuerySuffix}`;
    fetch(path, {
      signal: ac.signal,
    })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setSupportInfo((s) => ({ ...s, items: data.items || [] })))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setSupportInfo((s) => ({ ...s, items: [] }));
      });
    return () => ac.abort();
  }, [level, subject, supportInfoQuerySuffix]);

  /* =========================
     Таймер
  ========================== */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(EXAM_CORNER_POS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (typeof p.left === "number" && typeof p.top === "number") {
        setFixedCornerPos({ left: p.left, top: p.top });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const cornerPlaced = fixedCornerPos != null;
  useEffect(() => {
    if (!cornerPlaced) return;
    const onResize = () => {
      const el = fixedCornerRef.current;
      if (!el) return;
      setFixedCornerPos((prev) => {
        if (!prev) return prev;
        const c = clampExamCornerToViewport(el, prev.left, prev.top);
        try {
          sessionStorage.setItem(EXAM_CORNER_POS_KEY, JSON.stringify(c));
        } catch {
          /* ignore */
        }
        return c;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [cornerPlaced]);

  const onFixedCornerDragStart = useCallback((e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = fixedCornerRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const pos = fixedCornerPosRef.current;
    const startLeft = pos?.left ?? rect.left;
    const startTop = pos?.top ?? rect.top;
    if (pos == null) {
      setFixedCornerPos({ left: startLeft, top: startTop });
    }
    cornerDragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startLeft,
      startTop,
    };
    pendingCornerPosRef.current = { left: startLeft, top: startTop };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onFixedCornerDragMove = useCallback((e) => {
    const d = cornerDragRef.current;
    if (!d.active) return;
    e.preventDefault();
    const el = fixedCornerRef.current;
    if (!el) return;
    let left = d.startLeft + (e.clientX - d.startClientX);
    let top = d.startTop + (e.clientY - d.startClientY);
    const c = clampExamCornerToViewport(el, left, top);
    pendingCornerPosRef.current = c;
    setFixedCornerPos(c);
  }, []);

  const onFixedCornerDragEnd = useCallback((e) => {
    const d = cornerDragRef.current;
    if (!d.active) return;
    d.active = false;
    try {
      if (d.pointerId != null) e.currentTarget.releasePointerCapture(d.pointerId);
    } catch {
      /* ignore */
    }
    const p = pendingCornerPosRef.current;
    if (p) {
      try {
        sessionStorage.setItem(EXAM_CORNER_POS_KEY, JSON.stringify(p));
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => () => timerStore.destroy(), [timerStore]);

  /* Время на каждое задание: каждую секунду добавляем к текущему заданию (только пока таймер идёт) */
  useEffect(() => {
    if (!variant) return;
    const id = setInterval(() => {
      if (timerStore.getStatus() !== "running") return;
      const tid = currentTaskIdRef.current;
      if (tid) {
        taskTimesRef.current[tid] = (taskTimesRef.current[tid] || 0) + 1;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [variant, timerStore]);

  /* Инициализация текущего задания при загрузке варианта */
  useEffect(() => {
    if (!variant?.tasks?.length) return;
    const first = variant.tasks[0];
    if (first && !currentTaskIdRef.current) currentTaskIdRef.current = first.id;
  }, [variant]);

  /* Автозапуск таймера при загрузке варианта — время решения считается с момента открытия */
  useEffect(() => {
    if (variant && timerStore.getStatus() === "idle") {
      startTimeRef.current = new Date().toISOString();
      timerStore.setStatus("running");
    }
  }, [variant, timerStore]);

  function formatTimer(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0)
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /* Подсказка «листайте», если блок условия реально переполнен по ширине */
  useEffect(() => {
    const updateScrollHints = () => {
      const nodes = document.querySelectorAll(".exam-page .task-text");
      nodes.forEach((node) => {
        const hasOverflow = node.scrollWidth - node.clientWidth > 4;
        node.classList.toggle("task-text--has-overflow", hasOverflow);
      });
    };
    updateScrollHints();
    const t = setTimeout(updateScrollHints, 120);
    window.addEventListener("resize", updateScrollHints);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", updateScrollHints);
    };
  }, [variant]);

  /* =========================
     Лайтбокс: клик по картинке
  ========================== */
  useEffect(() => {
    const handler = (e) => {
      const img = e.target.closest("img");
      if (!img) return;
      const container = img.closest(".task-text, .correct-answer-content, .part2-answer-content, .task-content, .exam-page-container");
      if (!container) return;
      e.preventDefault();
      e.stopPropagation();
      setLightbox({ open: true, src: img.src });
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);


  /* =========================
     Проверка ответов
  ========================== */
  // Для математики и информатики: убираем пробелы, нормализуем юникод, без учёта регистра
  function normalize(str) {
    return String(str ?? "")
      .normalize("NFC")
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "") // zero-width, BOM, soft hyphen
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  // Ответ из API может быть HTML (process_latex) — извлекаем текст для сравнения
  function getTextFromHtml(html) {
    if (!html || typeof html !== "string") return "";
    try {
      const div = document.createElement("div");
      div.innerHTML = html;
      return (div.textContent || div.innerText || "").trim();
    } catch {
      return String(html).replace(/<[^>]+>/g, "");
    }
  }

  /** Строковые ответы-которые-совпадают-как-числа: запятая→точка, trim, parseFloat. */
  function tryNumericAnswerEqual(rawUserValue, correctAnswerHtml) {
    const correctText = getTextFromHtml(correctAnswerHtml || "");
    if (/\sили\s/i.test(correctText)) return null;
    const stripNum = (s) =>
      String(s ?? "")
        .normalize("NFC")
        .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
        .replace(/\u00a0/g, " ")
        .trim()
        .replace(/,/g, ".");
    const uStr = stripNum(rawUserValue);
    const cStr = stripNum(correctText);
    if (!uStr || !cStr) return null;
    const uNum = parseFloat(uStr);
    const cNum = parseFloat(cStr);
    if (!Number.isFinite(uNum) || !Number.isFinite(cNum)) return null;
    const plainNum = (x) =>
      /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/i.test(String(x).replace(/\s/g, ""));
    if (!plainNum(uStr) || !plainNum(cStr)) return null;
    const tol = 1e-9 * Math.max(1, Math.abs(cNum));
    return Math.abs(uNum - cNum) <= tol;
  }

  // Математика, химия, история: ответы вида "x или y" — несколько допустимых вариантов
  function isUserAnswerCorrect(rawUserValue, correctAnswerHtml) {
    const userNorm = normalize(rawUserValue);
    const correctText = getTextFromHtml(correctAnswerHtml || "");
    const correctNorm = normalize(correctText);

    if (
      SUBJECTS_WITH_OR_ALTERNATIVES.includes(subject) &&
      /\sили\s/i.test(correctText)
    ) {
      const alternatives = correctText
        .split(/\s+или\s+/i)
        .map((part) => normalize(part))
        .filter(Boolean);
      if (alternatives.length > 0) {
        return alternatives.includes(userNorm);
      }
    }

    const numEq = tryNumericAnswerEqual(rawUserValue, correctAnswerHtml);
    if (numEq !== null) return numEq;

    return userNorm === correctNorm;
  }

  function checkTask(taskId, correctAnswer, userValue = null) {
    const raw = userValue !== null ? userValue : userAnswers[taskId] || "";
    const isCorrect = isUserAnswerCorrect(raw, correctAnswer);
    setCheckedTasks((prev) => ({ ...prev, [taskId]: isCorrect }));
  }

  /** Вычислить правильность ответа без обновления state (для авто-проверки при завершении) */
  function computeTaskCorrectness(task) {
    const useTable = isTableAnswerTask(subject, task.number);
    const userValue = useTable
      ? getTableAnswerForCheck(task.id, INF_TABLE_ROWS, INF_TABLE_COLS)
      : (userAnswers[task.id] || "");
    return isUserAnswerCorrect(userValue, task.answer || "");
  }

  // Задания по информатике с таблицей ответов (18, 20, 25, 26, 27): 2 столбца, 7 строк
  const INF_TABLE_TASK_NUMBERS = [18, 20, 25, 26, 27];
  const INF_TABLE_ROWS = 7;
  const INF_TABLE_COLS = 2;

  function isTableAnswerTask(subj, num) {
    return subj === "inf" && INF_TABLE_TASK_NUMBERS.includes(num);
  }

  function getTableAnswerString(taskId, rows, cols) {
    const raw = userAnswers[taskId] || "";
    const lines = raw.split(/\r?\n/);
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      const line = lines[r] || "";
      matrix.push(line.split(/\t/).slice(0, cols));
      while (matrix[r].length < cols) matrix[r].push("");
    }
    return matrix;
  }

  function setTableCell(taskId, row, col, value, rows, cols) {
    const matrix = getTableAnswerString(taskId, rows, cols);
    matrix[row][col] = value;
    const str = matrix.map((rowArr) => rowArr.join("\t")).join("\n");
    setUserAnswers((prev) => ({ ...prev, [taskId]: str }));
  }

  function getTableAnswerForCheck(taskId, rows, cols) {
    const matrix = getTableAnswerString(taskId, rows, cols);
    return matrix.map((rowArr) => rowArr.join("\t")).join("\n");
  }

  /** Парсинг эталонного ответа из HTML в матрицу rows×cols (таб/перенос строки). */
  function parseCorrectTableAnswer(correctAnswerHtml, rows, cols) {
    const text = getTextFromHtml(correctAnswerHtml || "");
    const lines = text.split(/\r?\n/);
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      const line = lines[r] || "";
      matrix.push(line.split(/\t/).slice(0, cols).map((s) => s.trim()));
      while (matrix[r].length < cols) matrix[r].push("");
    }
    return matrix;
  }

  /** Информатика, задание 26: 2 ответа в одной строке. Оба верны → 2, один верный → 1, иначе 0. */
  function getInfTask26Score(userMatrix, correctMatrix) {
    const u = (userMatrix[0] || []).map((c) => normalize(c));
    const c = (correctMatrix[0] || []).map((cell) => normalize(cell));
    let match = 0;
    if (u[0] === c[0]) match++;
    if (u[1] === c[1]) match++;
    return match === 2 ? 2 : match === 1 ? 1 : 0;
  }

  /** Информатика, задание 27: 4 числа в двух строках (2 столбца). Обе строки верны → 2, одна строка верна → 1, иначе 0. */
  function getInfTask27Score(userMatrix, correctMatrix) {
    const rowMatch = (r) => {
      const u = (userMatrix[r] || []).map((cell) => normalize(cell));
      const c = (correctMatrix[r] || []).map((cell) => normalize(cell));
      return u[0] === c[0] && u[1] === c[1];
    };
    const r0 = rowMatch(0);
    const r1 = rowMatch(1);
    if (r0 && r1) return 2;
    if (r0 || r1) return 1;
    return 0;
  }

  /** Проверка задания 26 или 27 по информатике: выставляет баллы 0/1/2 и помечает задание проверенным. */
  function checkInfTask26Or27(task, rows, cols) {
    const userMatrix = getTableAnswerString(task.id, rows, cols);
    const correctMatrix = parseCorrectTableAnswer(task.answer, rows, cols);
    const score =
      task.number === 26
        ? getInfTask26Score(userMatrix, correctMatrix)
        : task.number === 27
          ? getInfTask27Score(userMatrix, correctMatrix)
          : 0;
    setScores((prev) => ({ ...prev, [task.id]: score }));
    setCheckedTasks((prev) => ({ ...prev, [task.id]: score > 0 }));
  }

  function togglePart2Answer(taskId) {
    setVisibleAnswers((p) => ({ ...p, [taskId]: !p[taskId] }));
  }

  /** Ключ кэша критериев: task_list_id или "num_<task_number>" при поиске по номеру */
  function getCriteriaCacheKey(task) {
    if (task.task_list_id != null) return task.task_list_id;
    if (task.number != null) return `num_${task.number}`;
    return null;
  }

  function toggleCriteriaPanel(task) {
    const tid = task.id;
    const cacheKey = getCriteriaCacheKey(task);
    if (criteriaOpenForTask === tid) {
      setCriteriaOpenForTask(null);
      return;
    }
    setCriteriaOpenForTask(tid);
    if (cacheKey != null && !criteriaByTaskList[cacheKey]?.criteria) {
      const params = new URLSearchParams();
      if (task.task_list_id != null) params.set("task_list_id", task.task_list_id);
      if (task.number != null) params.set("task_number", task.number);
      fetch(`/api/${level}/${subject}/criteria/?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : { criteria: [], max_score: null }))
        .then((data) => setCriteriaByTaskList((prev) => ({
          ...prev,
          [cacheKey]: {
            criteria: data.criteria || [],
            max_score: data.max_score != null ? data.max_score : (task.max_score ?? 3),
          },
        })))
        .catch(() => setCriteriaByTaskList((prev) => ({ ...prev, [cacheKey]: { criteria: [], max_score: task.max_score ?? 3 } })));
    }
  }

  function selectCriterion(taskId, criterion, maxScore) {
    setSelectedCriterionByTask((prev) => ({ ...prev, [taskId]: criterion.id }));
    const score = Math.min(criterion.criteria_score ?? 0, maxScore);
    setScores((prev) => ({ ...prev, [taskId]: Math.max(0, score) }));
  }

  const homeworkLkOpts = useMemo(
    () => (lessonEmbedParams.token ? { lessonToken: lessonEmbedParams.token } : undefined),
    [lessonEmbedParams.token]
  );

  const runHomeworkSave = useCallback(async () => {
    if (!isHomework || !cabinetAssignmentId || !variant) return;
    const statusNorm = pickHomeworkFields(hwApiRaw, cabinetAssignmentId || "").status;
    if (homeworkIsReadonly(statusNorm, isTeacherHomeworkView)) {
      setHwNotice(
        homeworkIsReviewed(statusNorm)
          ? "Работа уже проверена — изменения недоступны"
          : "Работа уже отправлена на проверку",
      );
      return;
    }
    setHwActionBusy(true);
    setHwNotice("");
    try {
      const r = buildHomeworkResultPayload(variant.tasks, userAnswers, scores, checkedTasks);
      await saveHomeworkDraft(cabinetAssignmentId, { result: r }, homeworkLkOpts);
      if (isEmbeddedHomework) setHomeworkFieldsLocked(true);
      setHwNotice("Черновик сохранён");
      setTimeout(() => setHwNotice(""), 2400);
    } catch (e) {
      setHwNotice(homeworkApiUserMessage(e) || "Не удалось сохранить");
    } finally {
      setHwActionBusy(false);
    }
  }, [isHomework, cabinetAssignmentId, variant, userAnswers, scores, checkedTasks, homeworkLkOpts, hwApiRaw, isTeacherHomeworkView]);

  const runHomeworkSubmit = useCallback(async () => {
    if (!isHomework || !cabinetAssignmentId || !variant) return;
    const statusNorm = pickHomeworkFields(hwApiRaw, cabinetAssignmentId || "").status;
    if (homeworkIsReadonly(statusNorm, isTeacherHomeworkView)) {
      setHwNotice(
        homeworkIsReviewed(statusNorm)
          ? "Работа уже проверена — повторная отправка недоступна"
          : "Работа уже отправлена на проверку",
      );
      return;
    }
    if (
      !window.confirm(
        "Отправить работу на проверку? После отправки изменить ответы нельзя — учитель проверит часть 2."
      )
    ) {
      return;
    }
    setHwActionBusy(true);
    setHwNotice("");
    try {
      const r = buildHomeworkResultPayload(
        variant.tasks,
        userAnswers,
        homeworkStudentMode ? {} : scores,
        homeworkStudentMode ? {} : checkedTasks
      );
      await saveHomeworkDraft(cabinetAssignmentId, { result: r }, homeworkLkOpts);
      await submitHomework(cabinetAssignmentId, { result: r }, homeworkLkOpts);
      setHomeworkFieldsLocked(true);
      setHwNotice("Отправлено на проверку");
      const j = await fetchHomeworkAssignment(cabinetAssignmentId, homeworkLkOpts);
      setHwApiRaw(j);
      if (isCabinetHomework) {
        navigate(`/cabinet/student/assignments/${cabinetAssignmentId}`);
      }
    } catch (e) {
      setHwNotice(homeworkApiUserMessage(e) || "Ошибка отправки");
    } finally {
      setHwActionBusy(false);
    }
  }, [
    isHomework,
    homeworkStudentMode,
    isCabinetHomework,
    cabinetAssignmentId,
    variant,
    userAnswers,
    scores,
    checkedTasks,
    homeworkLkOpts,
    navigate,
    hwApiRaw,
    isTeacherHomeworkView,
  ]);

  const confirmHomeworkPart1Answer = useCallback((task) => {
    setHomeworkConfirmedTasks((prev) => ({ ...prev, [task.id]: true }));
  }, []);

  const goToExamTask = useCallback((taskId) => {
    currentTaskIdRef.current = taskId;
    setExamNavActiveId(taskId);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-task-id="${String(taskId)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const tasksFilteredByAuthor = Array.isArray(variant?.tasks) ? variant.tasks : [];
  const getCodeEditorTaskSources = useCallback(
    () =>
      tasksFilteredByAuthor
        .filter((t) => t.file)
        .slice(0, 80)
        .map((t) => ({
          id: t.id,
          label: t.number != null ? `№${t.number}` : `id ${t.id}`,
          fileUrl: t.file || null,
        })),
    [tasksFilteredByAuthor]
  );

  if (error) {
    return (
      <div className="exam-variant-status exam-variant-status--error">
        <h2 className="exam-variant-status__title">Не удалось открыть вариант</h2>
        <p className="exam-variant-status__text">{error}</p>
        {level && subject ? (
          <Link className="exam-variant-status__back" to={`/${level}/${subject}`}>
            ← Вернуться к выбору формата
          </Link>
        ) : null}
      </div>
    );
  }
  if (!variant) {
    return (
      <div className="exam-variant-status exam-variant-status--loading">
        <h2 className="exam-variant-status__title">Загружаем вариант…</h2>
        <p className="exam-variant-status__text">Подождите, идёт загрузка заданий.</p>
        {variantLoadingUrl ? (
          <p className="exam-variant-status__meta">{variantLoadingUrl}</p>
        ) : null}
      </div>
    );
  }
  if (isHomework && !cabinetAssignmentId) {
    return (
      <div style={{ padding: 24, maxWidth: 520 }}>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif", marginBottom: 8 }}>Домашнее задание</h2>
        <p>Не передан id назначения. Откройте вариант из личного кабинета по ссылке с параметром cabinet_assignment=…</p>
      </div>
    );
  }

  // Fallback: если part не задан, определяем по номеру
  const inferPart = (t) => {
    if (t.part === 1 || t.part === 2) return t.part;
    const n = t.number;
    if (level === "oge" && isMathLikeSubject(subject)) return n <= 19 ? 1 : 2;
    if (level === "ege" && isMathLikeSubject(subject)) return n <= 11 ? 1 : 2;
    if (level === "oge" && subject === "inf") return n <= 15 ? 1 : 2;
    if (level === "ege" && subject === "inf") return n <= 27 ? 1 : 2;
    return n <= 19 ? 1 : 2;
  };
  const part1Tasks = tasksFilteredByAuthor.filter((t) => inferPart(t) === 1);
  const part2Tasks = tasksFilteredByAuthor.filter((t) => inferPart(t) === 2);

  // Связанные задания 19–21 — только для ЕГЭ информатика; для математики всё как обычные задания
  const LINKED_19_21 = [19, 20, 21];
  const part2Linked1921 = part2Tasks.filter((t) => LINKED_19_21.includes(t.number));
  const part2Rest = part2Tasks.filter((t) => !LINKED_19_21.includes(t.number));
  const showLinkedGroup = subject === "inf" && part2Linked1921.length === 3;
  const showInfCodeSidebar = isInformaticsCodeEditorContext(level, subject);
  // Для математики или если не все три — показываем 19/20/21 как обычные задания
  const part2Regular = showLinkedGroup ? part2Rest : [...part2Linked1921, ...part2Rest].sort((a, b) => a.number - b.number);

  const hwPicked = isHomework && hwApiRaw ? pickHomeworkFields(hwApiRaw, cabinetAssignmentId) : null;
  const hwSt = hwPicked?.status || "unknown";
  const hwRevisions = hwPicked?.revisionTaskIds || [];
  const hRead = homeworkIsReadonly(hwSt, isTeacherHomeworkView);
  const hSol = homeworkShowSolutions(hwSt);
  const showHomeworkReviewedResults = isHomework && !isTeacherHomeworkView && hwSt === "reviewed";
  const hwResultPayload = parseMaybeJsonObject(hwPicked?.result) || {};
  const homeworkReviewData = showHomeworkReviewedResults && variant?.tasks?.length
    ? buildHomeworkReviewFromVariant(variant.tasks, hwResultPayload, level, subject)
    : null;
  const numLocked = (n) =>
    isHomework && !homeworkTaskNumberEditable(hwSt, hwRevisions, n, isTeacherHomeworkView);
  /** В ДЗ ученика баллы и прогресс считаются только по части 1. */
  const hwScorePart1Only = homeworkStudentMode;
  const p1FieldDisabled = (task) => {
    if (hRead) return true;
    if (homeworkStudentMode) {
      if (homeworkConfirmedTasks[task.id]) return true;
      if (homeworkFieldsLocked || numLocked(task.number)) return true;
      return false;
    }
    if (checkedTasks[task.id] !== undefined) return true;
    const inf2627Ege =
      subject === "inf" &&
      String(level || "").toLowerCase() === "ege" &&
      (task.number === 26 || task.number === 27);
    if (inf2627Ege && scores[task.id] != null) return true;
    return false;
  };
  const p2FieldDisabled = () =>
    hRead || (isHomework && (homeworkFieldsLocked || hwSt === "reviewed"));
  const showAnswerFeedback = !homeworkStudentMode || showHomeworkReviewedResults;
  const showP1HomeworkConfirm = (task) =>
    homeworkStudentMode &&
    !isEmbeddedHomework &&
    !hRead &&
    !homeworkConfirmedTasks[task.id];
  const showP1CheckNormal = (task) =>
    !homeworkStudentMode && checkedTasks[task.id] === undefined;
  /** В ДЗ в iframe урока: «Сохранить» вместо «Проверить». */
  const p1ShowHomeworkSave = (task) =>
    isEmbeddedHomework &&
    !isTeacherHomeworkView &&
    !hRead &&
    !hSol &&
    !numLocked(task.number);
  /** Блок «Правильный ответ» (пунктир): только в ДЗ при показе решений. В варианте после «Проверить» ответ уже в exam-result — не дублировать. */
  const p1CorrectVisible = () => isHomework && hSol;
  const lkBase = getLkPublicBase();
  const showHomeworkBottomActions =
    isEmbeddedHomework &&
    !isTeacherHomeworkView &&
    !hRead &&
    (hwSt === "sent" || hwSt === "revision" || hwSt === "unknown");

  const getTaskMaxScore = (task) => task.max_score ?? 3;
  const part2ScoreSum = part2Tasks.reduce((sum, t) => sum + (scores[t.id] || 0), 0);
  /** Не useMemo: эти вычисления ниже ранних return (variant null) — хуки здесь ломали порядок вызовов. */
  const part2MaxAggregate = part2Tasks.reduce((sum, t) => {
    const key = getCriteriaCacheKey(t);
    const cached =
      key != null && criteriaByTaskList[key]?.max_score != null
        ? criteriaByTaskList[key].max_score
        : null;
    return sum + (cached ?? getTaskMaxScore(t));
  }, 0);
  const part2EvaluatedCount = part2Tasks.filter((t) => selectedCriterionByTask[t.id] != null).length;
  const part2SummaryBarPct =
    part2MaxAggregate > 0
      ? Math.min(100, (part2ScoreSum / part2MaxAggregate) * 100)
      : 0;
  const part1MaxScore = part1Tasks.length;
  const maxScore = hwScorePart1Only
    ? part1MaxScore
    : String(subject).toLowerCase() === "inf" && String(level).toLowerCase() === "ege"
      ? 29
      : part1Tasks.length + part2Tasks.reduce((sum, t) => sum + getTaskMaxScore(t), 0);

  /**
   * Подсчёт эффективных баллов.
   * autoCheckUnchecked=false (по умолчанию, live-режим): непроверенные задания не дают балла —
   *   цвет/баллы появляются только после нажатия «Проверить».
   * autoCheckUnchecked=true (при «Завершить»): авто-проверка непроверенных заданий ч.1
   *   для итогового подсчёта.
   */
  function getEffectiveResults({ autoCheckUnchecked = false } = {}) {
    const part1ConfirmedCount = part1Tasks.filter((t) => homeworkConfirmedTasks[t.id]).length;
    const effectiveCheckedTasks = {};
    for (const task of part1Tasks) {
      if (checkedTasks[task.id] !== undefined) {
        effectiveCheckedTasks[task.id] = checkedTasks[task.id];
      } else if (autoCheckUnchecked) {
        effectiveCheckedTasks[task.id] = computeTaskCorrectness(task);
      } else {
        effectiveCheckedTasks[task.id] = null;
      }
    }
    const correctCount = hwScorePart1Only
      ? part1ConfirmedCount
      : part1Tasks.filter((t) => effectiveCheckedTasks[t.id] === true).length;
    const effectiveScores = {};
    for (const task of variant.tasks) {
      if (inferPart(task) === 2) {
        effectiveScores[task.id] = hwScorePart1Only ? 0 : (scores[task.id] ?? 0);
      } else {
        effectiveScores[task.id] = effectiveCheckedTasks[task.id] === true ? 1 : 0;
      }
    }
    const totalScore = hwScorePart1Only ? correctCount : correctCount + part2ScoreSum;
    // Кол-во верно решённых задач геометрии (subdivision === "geom")
    const geoCorrectCount =
      Array.isArray(variant.tasks)
        ? variant.tasks.filter((t) => t.subdivision === "geom" && (effectiveScores[t.id] || 0) > 0).length
        : 0;
    const fullyCorrectTaskCount = hwScorePart1Only
      ? part1ConfirmedCount
      : variant.tasks.filter((task) => {
          if (inferPart(task) === 1) {
            if (checkedTasks[task.id] !== undefined) return !!checkedTasks[task.id];
            if (autoCheckUnchecked) return !!computeTaskCorrectness(task);
            return false;
          }
          return (scores[task.id] ?? 0) >= getTaskMaxScore(task);
        }).length;
    return {
      effectiveCheckedTasks,
      effectiveScores,
      correctCount,
      totalScore,
      geoCorrectCount,
      fullyCorrectTaskCount,
    };
  }

  const { totalScore, fullyCorrectTaskCount } = getEffectiveResults();
  const taskCountTotal = hwScorePart1Only ? part1Tasks.length : variant.tasks.length;
  const sidebarProgressPct =
    mode === "test"
      ? Math.min(100, (fullyCorrectTaskCount / Math.max(1, taskCountTotal)) * 100)
      : Math.min(100, (totalScore / Math.max(1, maxScore)) * 100);

  const handleTaskFocus = (taskId) => {
    currentTaskIdRef.current = taskId;
    setExamNavActiveId(taskId);
  };

  const handleReportErrorClick = (taskId, taskNumber) => {
    setReportErrorTask({ taskId, taskNumber });
    setReportErrorOpen(true);
  };

  const handleReportErrorSubmit = async ({ errorType, comment }) => {
    if (!reportErrorTask) return;
    const res = await fetch(`/api/${level}/${subject}/report-error/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        taskId: reportErrorTask.taskId,
        taskNumber: reportErrorTask.taskNumber,
        variantId: variant?.id,
        errorType,
        comment: comment || "",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Ошибка отправки");
    }
  };

  const handleFinish = async () => {
    timerStore.setStatus("paused");
    endTimeRef.current = new Date().toISOString();
    const totalTimeFormatted = formatTimer(timerStore.getSeconds());
    const taskTimes = { ...taskTimesRef.current };
    const {
      effectiveCheckedTasks,
      effectiveScores,
      correctCount: effCorrectCount,
      totalScore: effTotalScore,
      geoCorrectCount,
      fullyCorrectTaskCount: effFullyCorrect,
    } = getEffectiveResults({ autoCheckUnchecked: true });

    let scoreExam = null;
    let scoreComment = null;
    let markLevel = null;

    // В режиме тренировки по номерам конвертация в баллы/оценку не нужна; в ДЗ — только часть 1
    if (mode !== "test" && !hwScorePart1Only) {
      const isOgeMath =
        String(level).toLowerCase() === "oge" && isMathLikeSubject(subject);
      const geoParam = isOgeMath ? `&geo_correct=${geoCorrectCount}` : "";
      try {
        const res = await fetch(
          `/api/${level}/${subject}/score-conversion/?score=${effTotalScore}${geoParam}`,
          { credentials: "same-origin" }
        );
        if (res.ok) {
          const data = await res.json();
          scoreExam = data.score_exam !== undefined ? data.score_exam : null;
          scoreComment = data.comment ?? null;
          markLevel = data.mark_level ?? null;
        }
      } catch {
        /* ignore conversion API errors */
      }
    }

    // Для тренировки maxScore = кол-во задач в тесте (1 балл за задачу), для варианта — как обычно
    const effectiveMaxScore = mode === "test"
      ? (hwScorePart1Only ? part1Tasks.length : variant.tasks.length)
      : maxScore;
    const effectiveTaskCountTotal = hwScorePart1Only ? part1Tasks.length : variant.tasks.length;

    setResultsData({
      totalTimeFormatted,
      taskTimes,
      correctCount: effCorrectCount,
      totalScore: effTotalScore,
      maxScore: effectiveMaxScore,
      scoreExam,
      scoreComment,
      markLevel,
      tasks: variant.tasks,
      startTime: startTimeRef.current,
      endTime: endTimeRef.current,
      checkedTasks: effectiveCheckedTasks,
      scores: effectiveScores,
      variantId: variant.id,
      level,
      subject,
      examMode: mode,
      fullyCorrectTaskCount: effFullyCorrect,
      taskCountTotal: effectiveTaskCountTotal,
      scorePart1Only: hwScorePart1Only,
    });

    setResultsOpen(true);
  };

  const homeworkSidebarFinishLabel = homeworkStudentMode ? "Отправить на проверку" : undefined;
  const homeworkSidebarSubmittedMessage =
    homeworkStudentMode && hRead
      ? homeworkIsReviewed(hwSt)
        ? "Работа проверена — редактирование недоступно"
        : "Работа отправлена на проверку"
      : "";
  const handleSidebarFinish = () => {
    if (lessonEmbedParams.embed && window.parent && window.parent !== window) {
      window.parent.postMessage({ source: "exam-embedded-lesson", type: "lesson_finish_click" }, "*");
      return;
    }
    if (homeworkStudentMode) {
      runHomeworkSubmit();
      return;
    }
    handleFinish();
  };

  const openPdf = async (variantId) => {
    setPdfLoading("default");
    const url = `/api/${level}/${subject}/variant/${variantId}/pdf/`;
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Ошибка загрузки PDF");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `variant-${variantId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      const a = document.createElement("a");
      a.href = url;
      a.download = `variant-${variantId}.pdf`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setPdfLoading(null);
    }
  };

  const copyVariantLink = async () => {
    const loc = window.location;
    const isLocal =
      loc.hostname === "localhost" ||
      loc.hostname === "127.0.0.1" ||
      loc.hostname === "[::1]";
    const url = isLocal ? loc.href : getShareablePageUrl();
    let ok = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch { /* fallback below */ }
    }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.cssText = "position:fixed;opacity:0;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove();
    }
    setLinkCopied(ok);
    if (ok) setTimeout(() => setLinkCopied(false), 2000);
  };

  const heroTitle =
    (isEmbeddedHomework && !isTeacherHomeworkView) || hideHomeworkVariantChrome
      ? "Домашнее задание"
      : mode === "test"
        ? (() => {
            const labels =
              testTaskLabels.length > 0
                ? testTaskLabels
                : [...new Set(variant.tasks.map((t) => t.number).filter(Boolean))]
                    .sort((a, b) => a - b)
                    .map(String);
            if (labels.length === 0) return `Вариант № ${variant.id}`;
            if (labels.length === 1) return `Задание ${labels[0]}`;
            return `Задания ${labels.join(", ")}`;
          })()
        : mode === "part1"
          ? `Вариант № ${variant.id} · Часть 1`
          : mode === "part2"
            ? `Вариант № ${variant.id} · Часть 2`
            : `Вариант № ${variant.id}`;
  const ruTasksWord = (n) => {
    const k = n % 10;
    const kk = n % 100;
    if (kk >= 11 && kk <= 14) return "заданий";
    if (k === 1) return "задание";
    if (k >= 2 && k <= 4) return "задания";
    return "заданий";
  };
  const heroLongDescription = `${variant.tasks.length} ${ruTasksWord(variant.tasks.length)} для подготовки к экзамену. Часть 1 — ${part1Tasks.length} ${ruTasksWord(part1Tasks.length)}, часть 2 — ${part2Tasks.length} ${ruTasksWord(part2Tasks.length)}. Решайте по порядку или переходите к нужному номеру.`;
  const heroLeadForEdu = `${variant.tasks.length} ${ruTasksWord(variant.tasks.length)} для подготовки. Решайте по порядку или переходите к нужному номеру.`;
  const navTasksOrdered = [...tasksFilteredByAuthor].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const currentNavTask = navTasksOrdered.find((t) => t.id === examNavActiveId) ?? navTasksOrdered[0];
  const activeBoardPersist =
    examNavActiveId != null ? boardsByTask[String(examNavActiveId)] : undefined;
  const activeBoardHasDraft = boardPersistHasDraft(activeBoardPersist);

  function examP1PointsBadge(task) {
    if (String(subject) === "inf" && (task.number === 26 || task.number === 27)) {
      const s = scores[task.id] ?? 0;
      if (s === 0) return "+0 баллов";
      if (s === 1) return "+1 балл";
      if (s >= 2 && s <= 4) return `+${s} балла`;
      return `+${s} баллов`;
    }
    return "+1 балл";
  }

  function examNavBtnClass(task) {
    let c = "exam-edu-nav-btn";
    if (examNavActiveId === task.id) c += " is-active";
    if (boardPersistHasDraft(boardsByTask[String(task.id)])) c += " has-board-draft";
    const p = inferPart(task);
    const inf2627Ege =
      subject === "inf" &&
      String(level || "").toLowerCase() === "ege" &&
      (task.number === 26 || task.number === 27);

    if (p === 1) {
      if (homeworkStudentMode) {
        if (homeworkConfirmedTasks[task.id]) c += " is-pending";
        else {
          const ua = userAnswers[task.id];
          if (ua != null && String(ua).trim() !== "") c += " is-pending";
        }
        return c;
      }
      if (inf2627Ege) {
        const scInf = scores[task.id];
        if (scInf !== undefined && scInf !== null) {
          if (scInf >= 2) c += " is-done";
          else c += " is-wrong";
        } else {
          const ua = userAnswers[task.id];
          if (ua != null && String(ua).trim() !== "") c += " is-pending";
        }
      } else {
        if (checkedTasks[task.id] === true) c += " is-done";
        else if (checkedTasks[task.id] === false) c += " is-wrong";
        else {
          const ua = userAnswers[task.id];
          if (ua != null && String(ua).trim() !== "") c += " is-pending";
        }
      }
    }

    if (p === 2) {
      if (hwScorePart1Only) {
        const ua = userAnswers[task.id];
        if (ua != null && String(ua).trim() !== "") c += " is-pending";
        else if (boardPersistHasDraft(boardsByTask[String(task.id)])) c += " is-pending";
        return c;
      }
      const maxSc = getTaskMaxScore(task);
      const sc = scores[task.id] ?? 0;
      const p2Evaluated = selectedCriterionByTask[task.id] != null;
      if (p2Evaluated) {
        if (sc >= maxSc) c += " is-done";
        else c += " is-wrong";
      } else {
        const ua = userAnswers[task.id];
        if (ua != null && String(ua).trim() !== "") c += " is-pending";
      }
    }
    return c;
  }

  function renderEv2CriteriaPanel(task) {
    const cacheKey = getCriteriaCacheKey(task);
    const criteriaList = (criteriaByTaskList[cacheKey]?.criteria) ?? [];
    const maxSc = (criteriaByTaskList[cacheKey]?.max_score) ?? getTaskMaxScore(task);
    if (criteriaList.length === 0) {
      return <p className="ev2-criteria-empty">Критерии не заданы для этого задания</p>;
    }
    const taskScoreDisplay =
      selectedCriterionByTask[task.id] != null ? scores[task.id] ?? 0 : null;
    const radioName = `ev2-criteria-score-${task.id}`;
    return (
      <div className="ev2-criteria-panel">
        <div className="ev2-criteria-cards" role="radiogroup" aria-label="Критерии оценки">
          {criteriaList.map((c) => {
            const sc = Number(c.criteria_score ?? 0);
            return (
              <label
                key={c.id}
                className="criterion-card"
                data-score={sc === 0 ? "0" : undefined}
              >
                <input
                  type="radio"
                  name={radioName}
                  value={String(c.id)}
                  className="criterion-card__input"
                  checked={selectedCriterionByTask[task.id] === c.id}
                  disabled={isHomework && (hRead || numLocked(task.number))}
                  onChange={() => {
                    if (isHomework && (hRead || numLocked(task.number))) return;
                    selectCriterion(task.id, c, maxSc);
                  }}
                />
                <div className="criterion-score">{formatRuBalls(sc)}</div>
                <div className="criterion-text">
                  <MathContent
                    html={c.criteria_text || ""}
                    className="ev2-crit-math"
                  />
                </div>
              </label>
            );
          })}
        </div>
        <div className="score-result">
          Балл за задание:{" "}
          <span id={`ev2-selected-score-${task.id}`} className="score-result__value">
            {taskScoreDisplay != null ? taskScoreDisplay : "—"}
          </span>
        </div>
      </div>
    );
  }

  function ev2Part2TableBlock(task, rowsHere, colsHere) {
    const doneHere = checkedTasks[task.id] !== undefined;
    return (
      <>
        <span className="exam-task-answer__label">Ответ</span>
        <div className="answer-table-wrap exam-table-scroll">
          <table className="answer-table">
            <tbody>
              {Array.from({ length: rowsHere }, (_, r) => (
                <tr key={r}>
                  {Array.from({ length: colsHere }, (_, c) => (
                    <td key={c}>
                      <input
                        type="text"
                        className={`answer-input answer-table-input ev2-table-input${
                          showAnswerFeedback && doneHere
                            ? checkedTasks[task.id]
                              ? " correct"
                              : " incorrect"
                            : ""
                        }`}
                        placeholder=""
                        value={getTableAnswerString(task.id, rowsHere, colsHere)[r][c] || ""}
                        disabled={p1FieldDisabled(task)}
                        onChange={(e) =>
                          setTableCell(
                            task.id,
                            r,
                            c,
                            e.target.value.replace(/\t/g, " "),
                            rowsHere,
                            colsHere
                          )
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {showAnswerFeedback && doneHere && (
          <div
            className={
              checkedTasks[task.id] ? "exam-result exam-result--ok" : "exam-result exam-result--bad"
            }
          >
            {checkedTasks[task.id] ? (
              <>
                <strong>Верно</strong>
                <span className="exam-result__pts">{examP1PointsBadge(task)}</span>
              </>
            ) : (
              <>
                <strong>Неверно</strong>
                <div className="exam-result__correct">
                  {" "}
                  <MathContent
                    html={task.answer || ""}
                    className="exam-result-answer-math"
                  />
                </div>
              </>
            )}
          </div>
        )}
        <div className={`exam-hw-solution${p1CorrectVisible() ? " is-visible" : ""}`}>
          <span className="exam-hw-solution__label"></span>
          <MathContent
            html={task.answer || ""}
            className="correct-answer-content"
          />
        </div>
        {showP1HomeworkConfirm(task) && (
          <button
            type="button"
            className="exam-edu-btn exam-edu-btn--primary exam-edu-btn--full-mobile"
            onClick={() => confirmHomeworkPart1Answer(task)}
          >
            Подтвердить ответ
          </button>
        )}
        {showP1CheckNormal(task) && !doneHere && (
          <button
            type="button"
            className="exam-edu-btn exam-edu-btn--primary exam-edu-btn--full-mobile"
            onClick={() =>
              subject === "inf" && (task.number === 26 || task.number === 27)
                ? checkInfTask26Or27(task, rowsHere, colsHere)
                : checkTask(task.id, task.answer, getTableAnswerForCheck(task.id, rowsHere, colsHere))
            }
          >
            Проверить
          </button>
        )}
        {p1ShowHomeworkSave(task) && (
          <button
            type="button"
            className="exam-edu-btn exam-edu-btn--outline"
            disabled={hwActionBusy || hwLoading}
            onClick={() => runHomeworkSave()}
          >
            Сохранить
          </button>
        )}
      </>
    );
  }

  function ev2Part2Main(task) {
    const showSolBtn = (!isHomework || hSol) && task.answer != null && task.answer !== "";
    const showCritBtn = !hwScorePart1Only && (task.task_list_id != null || task.number != null);
    return (
      <>
        {(showSolBtn || showCritBtn) && (
          <div className="ev2-p2-actions ev2-p2-actions--criteria">
            {showSolBtn ? (
              <button type="button" className="btn-outline" onClick={() => togglePart2Answer(task.id)}>
                {visibleAnswers[task.id] ? "Скрыть решение" : "Показать решение"}
              </button>
            ) : null}
            {showCritBtn ? (
              <button
                type="button"
                className="btn-ghost"
                disabled={isHomework && hRead}
                onClick={() => {
                  if (isHomework && hRead) return;
                  toggleCriteriaPanel(task);
                }}
              >
                {criteriaOpenForTask === task.id ? "Скрыть критерии" : "Критерии оценки"}
              </button>
            ) : null}
          </div>
        )}
        {showSolBtn && visibleAnswers[task.id] ? (
          <div className="ev2-p2-solution">
            <div className="ev2-p2-solution__label">Решение</div>
            <div className="ev2-p2-solution__body">
              <MathContent
                html={task.answer}
                className="ev2-p2-solution__math"
              />
            </div>
          </div>
        ) : null}
        {criteriaOpenForTask === task.id ? renderEv2CriteriaPanel(task) : null}
      </>
    );
  }

  return (
    <>
    <div className="exam-edu-shell digital-flow-page">
    </div>
    <div
      ref={mainRef}
      className={`main-wrapper exam-page${isEmbeddedHomework ? " exam-page--homework" : ""}${showExamEducationShell ? " exam-page--edu" : ""}`}
      id="main-wrapper"
      data-level={level}
      data-subject={subject}
    >
      {isEmbeddedHomework && (
        <div className="exam-homework-bar" role="region" aria-label="Домашнее задание">
          <div className="exam-homework-bar__inner">
            <div className="exam-homework-bar__title">
              <span className="exam-homework-bar__badge">Домашнее задание</span>
              {hwLoading && <span className="exam-homework-bar__meta">загрузка статуса…</span>}
              {!hwLoading && hwPicked && (
                <span className="exam-homework-bar__meta">
                  {hwSt === "sent" && "Черновик"}
                  {hwSt === "submitted" && "На проверке"}
                  {hwSt === "reviewing" && "Проверяется"}
                  {hwSt === "revision" && "На доработке"}
                  {hwSt === "reviewed" && "Проверено"}
                  {hwSt === "unknown" && "Статус неизвестен"}
                </span>
              )}
            </div>
            {isTeacherHomeworkView && (
              <div className="exam-homework-bar__actions">
                <span className="exam-homework-bar__hint">Просмотр. Проверка и оценки — в личном кабинете.</span>
                {lkBase ? (
                  <a className="exam-homework-bar__link" href={lkBase} target="_blank" rel="noreferrer">
                    Открыть кабинет
                  </a>
                ) : null}
              </div>
            )}
            {!isTeacherHomeworkView && (
              <div className="exam-homework-bar__actions exam-homework-bar__actions--meta">
                {hwError && hwError !== "no_lk_env" && (
                  <span className="exam-homework-bar__err" title={String(hwError)}>
                    {hwError === "unauthorized"
                      ? "Войдите в личный кабинет в этой вкладке или откройте задание из кабинета."
                      : "Не удалось загрузить статус из кабинета (сеть или CORS)."}
                    {lkBase ? (
                      <>
                        {" "}
                        <a href={lkBase} target="_blank" rel="noreferrer">
                          Перейти в кабинет
                        </a>
                      </>
                    ) : null}
                  </span>
                )}
                {hwNotice ? <span className="exam-homework-bar__notice">{hwNotice}</span> : null}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Фиксированный блок — только урок/ДЗ в iframe; в обычном варианте таймер в сайдбаре */}
      {isEmbeddedHomework && (
      <div
        ref={fixedCornerRef}
        className={`exam-fixed-corner${examFixedPanelOpen ? "" : " exam-fixed-corner--all-collapsed"}`}
        style={
          fixedCornerPos
            ? { left: fixedCornerPos.left, top: fixedCornerPos.top, right: "auto" }
            : undefined
        }
      >
        <div className="exam-fixed-corner__header">
          {examFixedPanelOpen ? (
            <button
              type="button"
              className="exam-fixed-corner__collapse-all"
              onClick={() => setExamFixedPanelOpen(false)}
              title="Свернуть панель"
              aria-label="Свернуть панель с таймерами"
            >
              <span aria-hidden>−</span>
            </button>
          ) : (
            <button
              type="button"
              className="exam-fixed-corner__expand-all"
              onClick={() => setExamFixedPanelOpen(true)}
              title="Показать таймеры"
              aria-label="Показать панель с таймерами"
            >
              <span aria-hidden>⏱</span>
            </button>
          )}
        </div>
        {examFixedPanelOpen && (
          <>
        <ExamVariantFixedTimer store={timerStore} formatTimer={formatTimer} />
        <div className="variant-score-block">
          <div className="variant-score-row">
            <span className="variant-score-label">
              {mode === "test"
                ? "Верно"
                : hwScorePart1Only
                  ? "Ответов"
                  : part2Tasks.length === 0
                    ? "Правильных"
                    : "Баллов"}
            </span>
            <span className="variant-score-val">
              {mode === "test" ? (
                <>
                  {fullyCorrectTaskCount}{" "}
                  <span className="variant-score-total">/ {taskCountTotal}</span>
                </>
              ) : (
                <>
                  {totalScore} <span className="variant-score-total">/ {maxScore}</span>
                </>
              )}
            </span>
          </div>
        </div>
        {supportInfo.items?.length > 0 && (
          <button
            id="support-info-btn"
            className="exam-fixed-support-btn"
            onClick={() => setSupportInfo((s) => ({ ...s, open: true }))}
            title="Справочная информация"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v6M12 15.5v1" />
            </svg>
            <span>Справочная информация</span>
          </button>
        )}
          </>
        )}
      </div>
      )}
      {pdfLoading && (
        <div className="pdf-loading-overlay" role="status" aria-live="polite">
          <div className="pdf-loading-toast">
            <span className="pdf-loading-spinner" aria-hidden="true" />
            <span>Подождите немного, файл создаётся…</span>
          </div>
        </div>
      )}
      <div className="content-area">
        <div className={`exam-inf-code-layout${showInfCodeSidebar ? " exam-inf-code-layout--with-sidebar" : ""}`}>
          <div className="exam-inf-code-main">
        <div className="container exam-page-container exam-edu">
          <div
            className={`exam-edu-page exam-variant-v2 exam-variant-v2__page${showExamEducationShell ? " exam-edu-page--sidebar" : ""}`}
          >
            <div className={`exam-edu-layout${showExamEducationShell ? "" : " exam-edu-layout--single"}`}>
              <div className="exam-edu-main">
                {showExamEducationShell && (
                  <div className="mobile-variant-bar" aria-label="Компактная панель варианта">
                    <div className="mobile-stat mobile-stat--time">
                      <span className="mobile-stat-label">Время</span>
                      <ExamVariantTimerReadout
                        store={timerStore}
                        formatTimer={formatTimer}
                        className="mobile-stat-value"
                      />
                    </div>
                    <div className="mobile-stat mobile-stat--prog">
                      <span className="mobile-stat-label">Прогресс</span>
                      <span className="mobile-stat-value">
                        {mode === "test" ? `${fullyCorrectTaskCount} / ${taskCountTotal}` : `${totalScore} / ${maxScore}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mobile-bar-btn"
                      onClick={() => setMobileVariantNavOpen(true)}
                    >
                      Задания
                    </button>
                    <button
                      type="button"
                      className="mobile-bar-btn mobile-bar-btn--primary"
                      onClick={openBoardForActiveEduTask}
                    >
                      Доска
                      {activeBoardHasDraft ? <span className="board-has-draft-dot" aria-hidden="true" /> : null}
                    </button>
                  </div>
                )}
            <header className="exam-edu-hero">
              <div className="exam-edu-hero__grid">
                <div className="exam-edu-hero__content">
                  <div className="exam-edu-hero__badges" aria-label="Предмет и формат работы">
                    <span className="exam-edu-hero__badge exam-edu-hero__badge--subject">
                      {examHeroSubjectBadge(subject, location.state?.subjectName)}
                    </span>
                    <span className="exam-edu-hero__badge exam-edu-hero__badge--exam">
                      {examHeroExamBadge(mode, level)}
                    </span>
                  </div>
                  <h1 className="exam-edu-hero__title">{heroTitle}</h1>
                  <p className="exam-edu-hero__desc">
                    {showExamEducationShell ? heroLeadForEdu : heroLongDescription}
                  </p>
                  {!homeworkStudentMode && (
                    <div className="exam-edu-hero__actions">
                      <button
                        type="button"
                        className="exam-edu-btn exam-edu-btn--pdf"
                        onClick={() => openPdf(variant.id)}
                        disabled={!!pdfLoading}
                      >
                        Скачать PDF
                      </button>
                      <button
                        type="button"
                        className="exam-edu-btn exam-edu-btn--link"
                        onClick={copyVariantLink}
                        title={linkCopied ? "Скопировано" : "Скопировать ссылку"}
                        aria-label={linkCopied ? "Скопировано" : "Скопировать ссылку"}
                      >
                        {linkCopied ? "Скопировано" : "Скопировать ссылку"}
                      </button>
                    </div>
                  )}
                </div>
                <div className="exam-edu-hero-visual" aria-hidden="true">
                  <div className="exam-edu-hero-visual-inner">
                    <span className="exam-edu-hero-deco exam-edu-hero-deco--g" />
                    <span className="exam-edu-hero-deco exam-edu-hero-deco--p" />
                    <span className="exam-edu-hero-deco exam-edu-hero-deco--stu" />
                  </div>
                </div>
              </div>
            </header>

            {/* ===== ЧАСТЬ 1 ===== */}
            {part1Tasks.length > 0 && (
              <>
                <div className="exam-edu-section-head">
                  <h2 className="exam-edu-section-title">Часть 1</h2>
                  <span className="exam-edu-section-chip">Краткий ответ</span>
                </div>

                {part1Tasks.map((task) => {
              const useTable = isTableAnswerTask(subject, task.number);
              const truthCfg = !useTable ? getTruthTableConfig(task, { level, subject }) : null;
              const rows = useTable ? INF_TABLE_ROWS : 0;
              const cols = useTable ? INF_TABLE_COLS : 0;
              const p1Done = showHomeworkReviewedResults
                ? checkedTasks[task.id] !== undefined
                : homeworkStudentMode
                  ? !!homeworkConfirmedTasks[task.id]
                  : checkedTasks[task.id] !== undefined;
              const p1Stat = p1TaskStatusPill(
                task,
                subject,
                level,
                checkedTasks,
                userAnswers,
                scores,
                useTable,
                rows,
                cols,
                getTableAnswerForCheck,
                homeworkStudentMode && !showHomeworkReviewedResults,
                homeworkConfirmedTasks
              );

              return (
                <section
                  key={task.id}
                  data-task-id={task.id}
                  data-task-number={task.number}
                  className={`exam-task-card exam-task-card--p1${task.subdivision === "geom" ? " task-geom" : task.subdivision === "alg" ? " task-alg" : ""}${isOgeInformaticsTask(level, subject, task.number, 6) ? " exam-task-card--oge-inf-6" : ""}${isOgeInformaticsTask(level, subject, task.number, 13) ? " exam-task-card--oge-inf-13" : ""}${isEgeInfParallelProcessesTask(level, subject, task.number) ? " exam-task-card--ege-inf-22" : ""}${isEgeInfRoadGraphTask(level, subject, task.number) ? " exam-task-card--ege-inf-1" : ""}${isEgeInfTruthTableTask(level, subject, task.number) ? " exam-task-card--ege-inf-2" : ""}${((level === "oge" && subject === "inf" && task.number === 13) || (level === "oge" && isMathLikeSubject(subject) && task.number === 1)) ? " task-img-full" : ""}`}
                  onClick={() => handleTaskFocus(task.id)}
                >
                  <div className="exam-task-card__top">
                      <div className="exam-task-card__title-block">
                      <div className="exam-task-card__num">{task.number}</div>
                      <div className="exam-task-card__title-text">
                        <strong>Задание {task.number}</strong>
                        {!hideHomeworkVariantChrome && (
                          <>
                            <span>
                              ID {task.id} · Краткий ответ
                            </span>
                            {!task.answer || String(task.answer).trim() === "" ? (
                              <span className="task-no-answer-badge">Пока без ответа</span>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                    {showExamEducationShell ? (
                      <div className="exam-task-card__status-cluster">
                        {!hideHomeworkVariantChrome && (
                          <span className={`exam-task-card__status exam-task-card__status--${p1Stat.key}`}>
                            {p1Stat.label}
                          </span>
                        )}
                        <ExamTaskDrawingHeaderButton 
                          onClick={() => setEduOpenBoardForTaskId(task.id)} 
                          hasDraft={boardPersistHasDraft(boardsByTask[task.id])}
                        />
                      </div>
                    ) : (
                      !hideHomeworkVariantChrome && (
                        <span className={`exam-task-card__status exam-task-card__status--${p1Stat.key}`}>
                          {p1Stat.label}
                        </span>
                      )
                    )}
                  </div>
                  <ExamTaskDrawingShell
                    enabled={showExamEducationShell}
                    taskId={task.id}
                    level={level}
                    subject={subject}
                    variantId={variant?.id}
                    persistEntry={boardsByTask[task.id]}
                    onDrawingPersist={(payload) => handleBoardPersist({ taskId: task.id, ...payload })}
                    openBoardForTaskId={eduOpenBoardForTaskId}
                    onConsumedBoardOpenRequest={() => setEduOpenBoardForTaskId(null)}
                  >
                  <MathContent
                    html={task.text}
                    className="exam-task-card__text task-text"
                    ogeInf13Enhance={isOgeInformaticsTask(level, subject, task.number, 13)}
                    ogeInf6Enhance={isOgeInformaticsTask(level, subject, task.number, 6)}
                    egeInfFileEnhance={isEgeInformaticsContext(level, subject)}
                    egeInf22Enhance={isEgeInfParallelProcessesTask(level, subject, task.number)}
                    egeInf1Enhance={isEgeInfRoadGraphTask(level, subject, task.number)}
                    egeInf2Enhance={isEgeInfTruthTableTask(level, subject, task.number)}
                  />
                  {task.file && <TaskFileAttachment href={task.file} />}
                  {task.author && <div className="task-author">{task.author}</div>}

                  <div className="exam-task-answer">
                    {useTable && rows > 0 && cols > 0 ? (
                      <>
                        <span className="exam-task-answer__label">Ответ</span>
                        <div className="answer-table-wrap exam-table-scroll">
                          <table className="answer-table">
                            <tbody>
                              {Array.from({ length: rows }, (_, r) => (
                                <tr key={r}>
                                  {Array.from({ length: cols }, (_, c) => (
                                    <td key={c}>
                                      <input
                                        type="text"
                                        className={`answer-input answer-table-input ev2-table-input${
                                          showAnswerFeedback && p1Done
                                            ? checkedTasks[task.id]
                                              ? " correct"
                                              : " incorrect"
                                            : ""
                                        }`}
                                        placeholder=""
                                        value={getTableAnswerString(task.id, rows, cols)[r][c] || ""}
                                        disabled={p1FieldDisabled(task)}
                                        onChange={(e) =>
                                          setTableCell(
                                            task.id,
                                            r,
                                            c,
                                            e.target.value.replace(/\t/g, " "),
                                            rows,
                                            cols
                                          )
                                        }
                                      />
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {showAnswerFeedback && p1Done && (
                          <div
                            className={
                              checkedTasks[task.id] ? "exam-result exam-result--ok" : "exam-result exam-result--bad"
                            }
                          >
                            {checkedTasks[task.id] ? (
                              <>
                                <strong>Верно</strong>
                                <span className="exam-result__pts">{examP1PointsBadge(task)}</span>
                              </>
                            ) : (
                              <>
                                <strong>Неверно</strong>
                                <div className="exam-result__correct">
                                  {" "}
                                  <MathContent
                                    html={task.answer || ""}
                                    className="exam-result-answer-math"
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {showP1HomeworkConfirm(task) && (
                          <button
                            type="button"
                            className="exam-edu-btn exam-edu-btn--primary exam-edu-btn--full-mobile"
                            onClick={() => confirmHomeworkPart1Answer(task)}
                          >
                            Подтвердить ответ
                          </button>
                        )}
                        {showP1CheckNormal(task) && !p1Done && (
                          <button
                            type="button"
                            className="exam-edu-btn exam-edu-btn--primary exam-edu-btn--full-mobile"
                            onClick={() =>
                              subject === "inf" && (task.number === 26 || task.number === 27)
                                ? checkInfTask26Or27(task, rows, cols)
                                : checkTask(task.id, task.answer, getTableAnswerForCheck(task.id, rows, cols))
                            }
                          >
                            Проверить
                          </button>
                        )}
                        {p1ShowHomeworkSave(task) && (
                          <button
                            type="button"
                            className="exam-edu-btn exam-edu-btn--outline"
                            disabled={hwActionBusy || hwLoading}
                            onClick={() => runHomeworkSave()}
                          >
                            Сохранить
                          </button>
                        )}
                      </>
                    ) : truthCfg ? (
                      <>
                        <TruthTableInput
                          key={`truth-${task.id}-${truthCfg.mode}-${(truthCfg.variables || []).join(",")}-${truthCfg.expression}-${(truthCfg.steps || []).join("~")}`}
                          variables={truthCfg.variables ?? undefined}
                          expression={truthCfg.expression}
                          steps={truthCfg.steps ?? undefined}
                          mode={truthCfg.mode}
                          value={userAnswers[task.id] || ""}
                          onChange={(v) => {
                            const max = truthTableAnswerMaxChars(truthCfg);
                            let s = sanitizeTruthTableAnswerString(v);
                            if (max > 0 && s.length > max) s = s.slice(0, max);
                            setUserAnswers((prev) => ({ ...prev, [task.id]: s }));
                          }}
                          disabled={p1FieldDisabled(task)}
                        />
                        <input
                          id={`answer-${task.id}`}
                          type="text"
                          className="hidden-answer"
                          readOnly
                          tabIndex={-1}
                          aria-hidden="true"
                          value={userAnswers[task.id] || ""}
                          autoComplete="off"
                        />
                        {(showP1HomeworkConfirm(task) || (showP1CheckNormal(task) && !p1Done) || p1ShowHomeworkSave(task)) ? (
                          <div className="task-actions truth-task-actions">
                            {showP1HomeworkConfirm(task) && (
                              <button
                                type="button"
                                className="check-btn"
                                onClick={() => confirmHomeworkPart1Answer(task)}
                              >
                                Подтвердить ответ
                              </button>
                            )}
                            {showP1CheckNormal(task) && !p1Done && (
                              <button
                                type="button"
                                className="check-btn"
                                onClick={() => checkTask(task.id, task.answer)}
                              >
                                Проверить
                              </button>
                            )}
                            {p1ShowHomeworkSave(task) && (
                              <button
                                type="button"
                                className="check-btn check-btn--outline"
                                disabled={hwActionBusy || hwLoading}
                                onClick={() => runHomeworkSave()}
                              >
                                Сохранить
                              </button>
                            )}
                          </div>
                        ) : null}
                        {showAnswerFeedback && p1Done && (
                          <div
                            className={
                              checkedTasks[task.id] ? "exam-result exam-result--ok" : "exam-result exam-result--bad"
                            }
                          >
                            {checkedTasks[task.id] ? (
                              <>
                                <strong>Верно</strong>
                                <span className="exam-result__pts">{examP1PointsBadge(task)}</span>
                              </>
                            ) : (
                              <>
                                <strong>Неверно</strong>
                                <div className="exam-result__correct">
                                 {" "}
                                  <MathContent
                                    html={task.answer || ""}
                                    className="exam-result-answer-math"
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <label className="exam-task-answer__label" htmlFor={`answer-${task.id}`}>
                          Ответ
                        </label>
                        <div className="exam-task-answer__row">
                          <input
                            id={`answer-${task.id}`}
                            type="text"
                            className={`exam-task-input${
                              showAnswerFeedback && p1Done
                                ? checkedTasks[task.id]
                                  ? " is-correct"
                                  : " is-incorrect"
                                : ""
                            }`}
                            placeholder="Введите ответ"
                            value={userAnswers[task.id] || ""}
                            disabled={p1FieldDisabled(task)}
                            onChange={(e) =>
                              setUserAnswers((prev) => ({ ...prev, [task.id]: e.target.value }))
                            }
                            autoComplete="off"
                          />

                          {showP1HomeworkConfirm(task) && (
                            <button
                              type="button"
                              className="exam-edu-btn exam-edu-btn--primary exam-edu-btn--check-inline"
                              onClick={() => confirmHomeworkPart1Answer(task)}
                            >
                              Подтвердить
                            </button>
                          )}
                          {showP1CheckNormal(task) && !p1Done && (
                            <button
                              type="button"
                              className="exam-edu-btn exam-edu-btn--primary exam-edu-btn--check-inline"
                              onClick={() => checkTask(task.id, task.answer)}
                            >
                              Проверить
                            </button>
                          )}
                          {p1ShowHomeworkSave(task) && (
                            <button
                              type="button"
                              className="exam-edu-btn exam-edu-btn--outline exam-edu-btn--check-inline"
                              disabled={hwActionBusy || hwLoading}
                              onClick={() => runHomeworkSave()}
                            >
                              Сохранить
                            </button>
                          )}
                        </div>

                        {showAnswerFeedback && p1Done && (
                          <div
                            className={
                              checkedTasks[task.id] ? "exam-result exam-result--ok" : "exam-result exam-result--bad"
                            }
                          >
                            {checkedTasks[task.id] ? (
                              <>
                                <strong>Верно</strong>
                                <span className="exam-result__pts">{examP1PointsBadge(task)}</span>
                              </>
                            ) : (
                              <>
                                <strong>Неверно</strong>
                                <div className="exam-result__correct">
                                  {" "}
                                  <MathContent
                                    html={task.answer || ""}
                                    className="exam-result-answer-math"
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    <div
                      className={`exam-hw-solution${p1CorrectVisible() ? " is-visible" : ""}`}
                    >
                      <span className="exam-hw-solution__label"></span>
                      <MathContent
                        html={task.answer || ""}
                        className="correct-answer-content"
                      />
                    </div>
                    {showHomeworkReviewedResults ? (
                      <HomeworkTaskReviewNote
                        task={task}
                        result={hwResultPayload}
                        level={level}
                        subject={subject}
                        part={1}
                      />
                    ) : null}
                  </div>
                  </ExamTaskDrawingShell>
                  {!isHomework && (
                  <div className="task-report-error-wrap">
                    <TaskReportErrorButton taskId={task.id} taskNumber={task.number} onClick={handleReportErrorClick} />
                  </div>
                  )}
                </section>
              );
            })}
              </>
            )}

            {/* ===== ЧАСТЬ 2 ===== */}
            {part2Tasks.length > 0 && (
              <>
                <div className="exam-edu-section-head">
                  <h2 className="exam-edu-section-title">Часть 2</h2>
                  <span className="exam-edu-section-chip">Развернутый ответ</span>
                </div>

                {showLinkedGroup && (
                  <div className="exam-edu-linked-wrap">
                    <h3 className="exam-edu-linked-title">Задания 19–21</h3>
                    <p className="exam-edu-linked-desc">Общий сценарий, три задания по одному условию.</p>

                    {part2Linked1921.map((task) => {
                      const useTableHere = isTableAnswerTask(subject, task.number);
                      const rowsHere = useTableHere ? INF_TABLE_ROWS : 0;
                      const colsHere = useTableHere ? INF_TABLE_COLS : 0;
                      const p2Stat = p2TaskStatusPill(
                        task,
                        selectedCriterionByTask,
                        userAnswers,
                        hwScorePart1Only,
                        scores,
                        showHomeworkReviewedResults
                      );

                      return (
                        <section
                          key={task.id}
                          data-task-id={task.id}
                          className={`exam-task-card exam-task-card--p2 exam-task-card--in-group${task.subdivision === "geom" ? " task-geom" : task.subdivision === "alg" ? " task-alg" : ""}${isOgeInformaticsTask(level, subject, task.number, 6) ? " exam-task-card--oge-inf-6" : ""}${isOgeInformaticsTask(level, subject, task.number, 13) ? " exam-task-card--oge-inf-13" : ""}${isEgeInfParallelProcessesTask(level, subject, task.number) ? " exam-task-card--ege-inf-22" : ""}${isEgeInfRoadGraphTask(level, subject, task.number) ? " exam-task-card--ege-inf-1" : ""}${isEgeInfTruthTableTask(level, subject, task.number) ? " exam-task-card--ege-inf-2" : ""}${((level === "oge" && subject === "inf" && task.number === 13) || (level === "oge" && isMathLikeSubject(subject) && task.number === 1)) ? " task-img-full" : ""}`}
                          onClick={() => handleTaskFocus(task.id)}
                        >
                          <div className="exam-task-card__top">
                            <div className="exam-task-card__title-block">
                              <div className="exam-task-card__num">{task.number}</div>
                              <div className="exam-task-card__title-text">
                                <strong>Задание {task.number}</strong>
                                {!hideHomeworkVariantChrome && (
                                  <>
                                    <span>
                                      ID {task.id} · Развёрнутый ответ
                                    </span>
                                    {!task.answer || String(task.answer).trim() === "" ? (
                                      <span className="task-no-answer-badge">Пока без ответа</span>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            </div>
                            {showExamEducationShell ? (
                              <div className="exam-task-card__status-cluster">
                                {!hideHomeworkVariantChrome && (
                                  <span className={`exam-task-card__status exam-task-card__status--${p2Stat.key}`}>
                                    {p2Stat.label}
                                  </span>
                                )}
                                <ExamTaskDrawingHeaderButton 
                                  onClick={() => setEduOpenBoardForTaskId(task.id)}
                                  hasDraft={boardPersistHasDraft(boardsByTask[task.id])}
                                />
                              </div>
                            ) : (
                              !hideHomeworkVariantChrome && (
                                <span className={`exam-task-card__status exam-task-card__status--${p2Stat.key}`}>
                                  {p2Stat.label}
                                </span>
                              )
                            )}
                          </div>
                          <ExamTaskDrawingShell
                            enabled={showExamEducationShell}
                            taskId={task.id}
                            level={level}
                            subject={subject}
                            variantId={variant?.id}
                            persistEntry={boardsByTask[task.id]}
                            onDrawingPersist={(payload) => handleBoardPersist({ taskId: task.id, ...payload })}
                            openBoardForTaskId={eduOpenBoardForTaskId}
                            onConsumedBoardOpenRequest={() => setEduOpenBoardForTaskId(null)}
                          >
                          <MathContent
                            html={task.text}
                            className="exam-task-card__text task-text"
                            ogeInf13Enhance={isOgeInformaticsTask(level, subject, task.number, 13)}
                            ogeInf6Enhance={isOgeInformaticsTask(level, subject, task.number, 6)}
                            egeInfFileEnhance={isEgeInformaticsContext(level, subject)}
                            egeInf22Enhance={isEgeInfParallelProcessesTask(level, subject, task.number)}
                            egeInf1Enhance={isEgeInfRoadGraphTask(level, subject, task.number)}
                            egeInf2Enhance={isEgeInfTruthTableTask(level, subject, task.number)}
                          />
                          {task.file && <TaskFileAttachment href={task.file} />}
                          {task.author && <div className="task-author">{task.author}</div>}

                          <div className="ev2-p2-body">
                            {useTableHere && rowsHere > 0 && colsHere > 0 ? (
                              <div className="exam-task-answer">{ev2Part2TableBlock(task, rowsHere, colsHere)}</div>
                            ) : (
                              ev2Part2Main(task)
                            )}
                          </div>
                          </ExamTaskDrawingShell>
                          <LessonSolutionUpload
                            taskNumber={task.number}
                            taskId={task.id}
                            lessonToken={lessonEmbedParams.token}
                            assignmentId={cabinetAssignmentId}
                            homeworkMode={isHomework}
                            cabinetMode={showCabinetPart2SolutionUpload}
                            allowDelete
                            initialAttachments={homeworkTaskAttachments(hwPicked?.result, task.id, task.number)}
                            enabled={
                              (showLessonSolutionUpload || showCabinetPart2SolutionUpload)
                              && (!isHomework || (!hRead && !numLocked(task.number)))
                            }
                          />
                          {showHomeworkReviewedResults ? (
                            <HomeworkTaskReviewNote
                              task={task}
                              result={hwResultPayload}
                              level={level}
                              subject={subject}
                              part={2}
                            />
                          ) : null}
                          {!isHomework && (
                          <div className="task-report-error-wrap">
                            <TaskReportErrorButton taskId={task.id} taskNumber={task.number} onClick={handleReportErrorClick} />
                          </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}

                {part2Regular.map((task) => {
                  const useTableHere = isTableAnswerTask(subject, task.number);
                  const rowsHere = useTableHere ? INF_TABLE_ROWS : 0;
                  const colsHere = useTableHere ? INF_TABLE_COLS : 0;
                  const p2Stat = p2TaskStatusPill(
                    task,
                    selectedCriterionByTask,
                    userAnswers,
                    hwScorePart1Only,
                    scores,
                    showHomeworkReviewedResults
                  );

                  return (
                    <section
                      key={task.id}
                      data-task-id={task.id}
                      className={`exam-task-card exam-task-card--p2${task.subdivision === "geom" ? " task-geom" : task.subdivision === "alg" ? " task-alg" : ""}${isOgeInformaticsTask(level, subject, task.number, 6) ? " exam-task-card--oge-inf-6" : ""}${isOgeInformaticsTask(level, subject, task.number, 13) ? " exam-task-card--oge-inf-13" : ""}${isEgeInfParallelProcessesTask(level, subject, task.number) ? " exam-task-card--ege-inf-22" : ""}${isEgeInfRoadGraphTask(level, subject, task.number) ? " exam-task-card--ege-inf-1" : ""}${isEgeInfTruthTableTask(level, subject, task.number) ? " exam-task-card--ege-inf-2" : ""}${((level === "oge" && subject === "inf" && task.number === 13) || (level === "oge" && isMathLikeSubject(subject) && task.number === 1)) ? " task-img-full" : ""}`}
                      onClick={() => handleTaskFocus(task.id)}
                    >
                      <div className="exam-task-card__top">
                        <div className="exam-task-card__title-block">
                          <div className="exam-task-card__num">{task.number}</div>
                          <div className="exam-task-card__title-text">
                            <strong>Задание {task.number}</strong>
                            {!hideHomeworkVariantChrome && (
                              <>
                                <span>
                                  ID {task.id} · Развёрнутый ответ
                                </span>
                                {!task.answer || String(task.answer).trim() === "" ? (
                                  <span className="task-no-answer-badge">Пока без ответа</span>
                                ) : null}
                              </>
                            )}
                          </div>
                        </div>
                        {showExamEducationShell ? (
                          <div className="exam-task-card__status-cluster">
                            {!hideHomeworkVariantChrome && (
                              <span className={`exam-task-card__status exam-task-card__status--${p2Stat.key}`}>
                                {p2Stat.label}
                              </span>
                            )}
                            <ExamTaskDrawingHeaderButton 
                              onClick={() => setEduOpenBoardForTaskId(task.id)}
                              hasDraft={boardPersistHasDraft(boardsByTask[task.id])}
                            />
                          </div>
                        ) : (
                          !hideHomeworkVariantChrome && (
                            <span className={`exam-task-card__status exam-task-card__status--${p2Stat.key}`}>
                              {p2Stat.label}
                            </span>
                          )
                        )}
                      </div>
                      <ExamTaskDrawingShell
                        enabled={showExamEducationShell}
                        taskId={task.id}
                        level={level}
                        subject={subject}
                        variantId={variant?.id}
                        persistEntry={boardsByTask[task.id]}
                        onDrawingPersist={(payload) => handleBoardPersist({ taskId: task.id, ...payload })}
                        openBoardForTaskId={eduOpenBoardForTaskId}
                        onConsumedBoardOpenRequest={() => setEduOpenBoardForTaskId(null)}
                      >
                      <MathContent
                        html={task.text}
                        className="exam-task-card__text task-text"
                        ogeInf13Enhance={isOgeInformaticsTask(level, subject, task.number, 13)}
                        ogeInf6Enhance={isOgeInformaticsTask(level, subject, task.number, 6)}
                        egeInfFileEnhance={isEgeInformaticsContext(level, subject)}
                        egeInf22Enhance={isEgeInfParallelProcessesTask(level, subject, task.number)}
                        egeInf1Enhance={isEgeInfRoadGraphTask(level, subject, task.number)}
                        egeInf2Enhance={isEgeInfTruthTableTask(level, subject, task.number)}
                      />
                      {task.file && <TaskFileAttachment href={task.file} />}
                      {task.author && <div className="task-author">{task.author}</div>}

                      <div className="ev2-p2-body">
                        {useTableHere && rowsHere > 0 && colsHere > 0 ? (
                          <div className="exam-task-answer">{ev2Part2TableBlock(task, rowsHere, colsHere)}</div>
                        ) : (
                          ev2Part2Main(task)
                        )}
                      </div>
                      </ExamTaskDrawingShell>
                      <LessonSolutionUpload
                        taskNumber={task.number}
                        taskId={task.id}
                        lessonToken={lessonEmbedParams.token}
                        assignmentId={cabinetAssignmentId}
                        homeworkMode={isHomework}
                        cabinetMode={showCabinetPart2SolutionUpload}
                        allowDelete
                        initialAttachments={homeworkTaskAttachments(hwPicked?.result, task.id, task.number)}
                        enabled={
                          (showLessonSolutionUpload || showCabinetPart2SolutionUpload)
                          && (!isHomework || (!hRead && !numLocked(task.number)))
                        }
                      />
                      {showHomeworkReviewedResults ? (
                        <HomeworkTaskReviewNote
                          task={task}
                          result={hwResultPayload}
                          level={level}
                          subject={subject}
                          part={2}
                        />
                      ) : null}
                      {!isHomework && (
                      <div className="task-report-error-wrap">
                        <TaskReportErrorButton taskId={task.id} taskNumber={task.number} onClick={handleReportErrorClick} />
                      </div>
                      )}
                    </section>
                  );
                })}

                {!hwScorePart1Only && (
                <div className="ev2-p2-summary">
                  <div className="ev2-p2-summary__left">
                    <div className="ev2-p2-summary__headline">
                      <span className="ev2-p2-summary__title">Итого за часть 2</span>
                      <span className="ev2-p2-summary__meta">
                        {" "}
                        · {part2EvaluatedCount} заданий оценено
                      </span>
                    </div>
                    <div className="ev2-p2-summary__bar-wrap">
                      <div className="ev2-p2-summary__bar">
                        <div
                          className="ev2-p2-summary__bar-fill"
                          style={{ width: `${part2SummaryBarPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="ev2-p2-summary__right">
                    <span className="ev2-p2-summary__score">{part2ScoreSum}</span>
                    <span className="ev2-p2-summary__max">
                      {" "}
                      / {part2MaxAggregate}
                    </span>
                  </div>
                </div>
                )}
              </>
            )}

            {showHomeworkBottomActions && (
              <div className="exam-homework-finish">
                <p className="exam-homework-finish__hint">
                  Сохраните ответы кнопкой «Сохранить» у заданий части 1 или кнопками ниже, затем отправьте работу — до проверки
                  эталон и верность ответа не показываются.
                </p>
                <div className="exam-homework-finish__row">
                  <button
                    type="button"
                    className="exam-homework-finish__btn exam-homework-finish__btn--secondary"
                    disabled={hwActionBusy || hwLoading}
                    onClick={() => runHomeworkSave()}
                  >
                    Сохранить черновик
                  </button>
                  <button
                    type="button"
                    className="exam-homework-finish__btn exam-homework-finish__btn--primary"
                    disabled={hwActionBusy || hwLoading}
                    onClick={() => runHomeworkSubmit()}
                  >
                    Отправить на проверку
                  </button>
                </div>
              </div>
            )}

            {showHomeworkReviewedResults && homeworkReviewData ? (
              <HomeworkReviewResults
                review={homeworkReviewData}
                className="exam-homework-reviewed"
              />
            ) : null}

            {/* Кнопка Завершить — в обычном экзамене, не в ДЗ; в edu-режиме — в сайдбаре */}
            {!isHomework &&
              !lessonEmbedParams.embed &&
              !lessonEmbedParams.token &&
              !showExamEducationShell && (
                <div className="exam-finish-section">
                  <button
                    id="finish-btn"
                    className="exam-finish-btn exam-finish-btn-inline"
                    onClick={() => {
                      if (lessonEmbedParams.embed && window.parent && window.parent !== window) {
                        window.parent.postMessage({ source: "exam-embedded-lesson", type: "lesson_finish_click" }, "*");
                        return;
                      }
                      handleFinish();
                    }}
                  >
                    Завершить
                  </button>
                </div>
              )}
              </div>

              {showExamEducationShell && (
                <aside className="exam-edu-sidebar desktop-variant-panel">
                  <EduVariantSidebarCard
                    formatTimer={formatTimer}
                    timerStore={timerStore}
                    mode={mode}
                    fullyCorrectTaskCount={fullyCorrectTaskCount}
                    taskCountTotal={taskCountTotal}
                    totalScore={totalScore}
                    maxScore={maxScore}
                    part2Tasks={part2Tasks}
                    sidebarProgressPct={sidebarProgressPct}
                    navTasksOrdered={navTasksOrdered}
                    activeNavTaskId={examNavActiveId}
                    examNavBtnClass={examNavBtnClass}
                    goToExamTask={goToExamTask}
                    supportItems={supportInfo.items}
                    onOpenSupport={() => setSupportInfo((s) => ({ ...s, open: true }))}
                    hideFinish={
                      lessonEmbedParams.embed
                      || lessonEmbedParams.token
                      || (homeworkStudentMode && hRead)
                    }
                    progressPart1Only={hwScorePart1Only}
                    finishLabel={homeworkSidebarFinishLabel}
                    finishDisabled={homeworkStudentMode && (hwActionBusy || hwLoading)}
                    finishBusy={homeworkStudentMode && hwActionBusy}
                    submittedMessage={homeworkSidebarSubmittedMessage}
                    onFinish={handleSidebarFinish}
                  />
                </aside>
              )}

              {showExamEducationShell && mobileVariantNavOpen && (
                <div
                  className="mobile-panel-backdrop"
                  onClick={() => setMobileVariantNavOpen(false)}
                  role="presentation"
                >
                  <div
                    className="mobile-panel-sheet"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Навигация по варианту"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mobile-panel-head">
                      <h3 className="mobile-panel-title">Навигация по варианту</h3>
                      <button
                        type="button"
                        className="mobile-panel-close"
                        onClick={() => setMobileVariantNavOpen(false)}
                        aria-label="Закрыть"
                      >
                        ×
                      </button>
                    </div>
                    <EduVariantSidebarCard
                      formatTimer={formatTimer}
                      timerStore={timerStore}
                      mode={mode}
                      fullyCorrectTaskCount={fullyCorrectTaskCount}
                      taskCountTotal={taskCountTotal}
                      totalScore={totalScore}
                      maxScore={maxScore}
                      part2Tasks={part2Tasks}
                      sidebarProgressPct={sidebarProgressPct}
                      navTasksOrdered={navTasksOrdered}
                      activeNavTaskId={examNavActiveId}
                      examNavBtnClass={examNavBtnClass}
                      goToExamTask={goToExamTask}
                      onAfterNavTask={() => setMobileVariantNavOpen(false)}
                      supportItems={supportInfo.items}
                      onOpenSupport={() => setSupportInfo((s) => ({ ...s, open: true }))}
                      hideFinish={
                        lessonEmbedParams.embed
                        || lessonEmbedParams.token
                        || (homeworkStudentMode && hRead)
                      }
                      progressPart1Only={hwScorePart1Only}
                      finishLabel={homeworkSidebarFinishLabel}
                      finishDisabled={homeworkStudentMode && (hwActionBusy || hwLoading)}
                      finishBusy={homeworkStudentMode && hwActionBusy}
                      submittedMessage={homeworkSidebarSubmittedMessage}
                      onFinish={() => {
                        setMobileVariantNavOpen(false);
                        handleSidebarFinish();
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
          </div>
          {showInfCodeSidebar ? (
            <Suspense fallback={null}>
              <InformaticsCodeEditorEntry getTaskSources={getCodeEditorTaskSources} />
            </Suspense>
          ) : null}
        </div>
      </div>

      {!showExamEducationShell && (
        <ExamBoardOverlay
          initialBoardPersist={activeBoardPersist}
          onBoardPersist={handleBoardPersist}
        />
      )}

      <ImageLightbox
        src={lightbox.src}
        open={lightbox.open}
        onClose={() => setLightbox((s) => ({ ...s, open: false }))}
      />
      <SupportInfoModal
        open={supportInfo.open}
        items={supportInfo.items}
        onClose={() => setSupportInfo((s) => ({ ...s, open: false }))}
      />
      <ResultsModal
        open={resultsOpen}
        onClose={() => setResultsOpen(false)}
        results={resultsData}
        onRetry={
          homeworkStudentMode
            ? undefined
            : () => {
                setResultsOpen(false);
                window.location.reload();
              }
        }
      />
      {!isHomework && (
      <ReportErrorModal
        open={reportErrorOpen}
        onClose={() => {
          setReportErrorOpen(false);
          setReportErrorTask(null);
        }}
        onSubmit={handleReportErrorSubmit}
        taskNumber={reportErrorTask?.taskNumber}
      />
      )}
    </div>
    </>
  );
}

export default ExamPage;