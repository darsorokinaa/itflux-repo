import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import MathContent from "../../components/MathContent";
import CabinetIcon from "../CabinetIcons";
import { usePageTitle } from "../hooks/usePageTitle";
import "../styles/review-workspace.css";
import { TaskFileAttachments } from "../../components/TaskFileAttachment";
import {
  CabinetPageShell,
  CabinetPageHeader,
} from "../CabinetSectionUi";
import EducationalLoading, { LOADING_MESSAGES } from "../../components/EducationalLoading";
import CabinetFloatingMenu from "../components/CabinetFloatingMenu";
import {
  buildTeacherVariantUrl,
  formatReviewDate,
  hasOfficialTaskAnswer,
  homeworkTaskAnswer,
  homeworkTaskAttachments,
  homeworkTaskComment,
  homeworkTaskScore,
  homeworkTeacherAttachments,
  homeworkTeacherCommentAttachments,
  inferExamTaskPart,
  resolvePart1Verdict,
  taskMaxScore,
} from "../cabinetReviewUtils";
import { assignDisplayNumbers } from "../../utils/taskDocument";
import { SUBJECTS_BY_LEVEL, buildSubjectDefinition } from "../../data/subjects";
import { TaskPosition } from "../../components/taskDocument/TaskNumber";
import {
  isEgeInfParallelProcessesTask,
  isEgeInfRoadGraphTask,
  isEgeInfTruthTableTask,
  isEgeInformaticsContext,
  isOgeInformaticsTask,
  isOgeRusTask13,
} from "../../utils/isOgeInformaticsTask";
import { isTableAnswerTask } from "../../utils/examAnswerCheck";
import {
  addHomeworkTasks,
  checkReviewItem,
  deleteHomework,
  deleteReviewFeedback,
  fetchReviewItem,
  returnReviewItem,
  uploadReviewFeedback,
} from "../../utils/cabinetAuth";
import ConfirmActionModal from "../components/ConfirmActionModal";
import HomeworkCopyModal from "../components/HomeworkCopyModal";
import PlanItemResourcesPicker from "../components/PlanItemResourcesPicker";
import AttachmentPreviewModal, {
  isAttachmentPreviewable,
  openAttachmentPreferPreview,
} from "../components/AttachmentPreviewModal";
import HomeworkReviewSummary, {
  buildHomeworkReviewFromVariant,
} from "../HomeworkReviewResults";
import {
  extraHomeworkText,
  visibleHomeworkResourceTasks,
} from "../homeworkTaskDisplay";
import {
  appendHomeworkAttachments,
  homeworkAttachmentKey,
  isHomeworkAttachmentImage,
  normalizeHomeworkAttachment,
  removeHomeworkAttachment,
} from "../homeworkAttachmentState";
import HomeworkNotebookEditor from "../notebook/HomeworkNotebookEditor";
import { deleteHomeworkAttachment, openHomeworkNotebook } from "../notebook/notebookApi";

const HW_TASK_TYPE_RU = {
  text: "Текст",
  file: "Файл",
  interactive: "Интерактив",
  generated_task: "Вариант",
  external_link: "Ссылка",
};

function TeacherNotebookActions({ submissionId, taskId, taskNumber, enabled, onComplete }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notebook, setNotebook] = useState(null);
  if (!submissionId || taskId == null) return null;
  return (
    <div className="hw-notebook-actions">
      {enabled ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              const doc = await openHomeworkNotebook(submissionId, taskId, {
                ownerRole: "teacher",
                seed: true,
                taskNumber,
              });
              setNotebook(doc);
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : "Не удалось открыть тетрадь");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Открытие…" : "Открыть для проверки"}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => navigate(`/cabinet/notebook/published/${submissionId}/${encodeURIComponent(String(taskId))}`)}
      >
        Открыть проверенную работу
      </button>
      {err ? <p className="cb-inline-error" role="alert">{err}</p> : null}
      {notebook ? (
        <HomeworkNotebookEditor
          notebookId={notebook.id}
          initialDocument={notebook}
          onClose={() => setNotebook(null)}
          onComplete={(payload) => {
            if (payload.attachment) onComplete?.(payload);
            setNotebook(null);
          }}
        />
      ) : null}
    </div>
  );
}

function homeworkTaskMeta(task) {
  if (!task) return "Задание";
  if (task.is_variant) return "Вариант";
  return HW_TASK_TYPE_RU[task.task_type] || "Задание";
}

function hydrateReviewForm(review) {
  const submission = review?.homework_submission;
  const result = submission?.result_payload || {};
  const scores = {};
  const taskComments = {};
  if (result.scores && typeof result.scores === "object") {
    for (const [id, value] of Object.entries(result.scores)) {
      const n = Number(value);
      if (!Number.isNaN(n)) scores[id] = n;
    }
  }
  const byId = result.comments_by_task_id || result.commentsByTaskId || {};
  if (byId && typeof byId === "object") {
    for (const [id, value] of Object.entries(byId)) {
      if (String(value).trim()) taskComments[id] = String(value);
    }
  }
  const stats = result.manual_stats && typeof result.manual_stats === "object"
    ? result.manual_stats
    : {};
  return {
    teacherComment: review?.teacher_comment || submission?.teacher_comment || "",
    scores,
    taskComments,
    manualStats: {
      correct: stats.correct ?? "",
      incorrect: stats.incorrect ?? "",
      total: stats.total ?? "",
      unsolved: stats.unsolved ?? "",
    },
  };
}

function TaskCondition({ task, level, subject }) {
  if (!task?.text && !task?.file && !(task?.attachments || []).length) return null;
  return (
    <div className="cb-review-detail__task-body">
      <span className="cb-review-detail__section-label">Условие</span>
      {task.text ? (
        <MathContent
          html={task.text}
          className="cb-review-detail__task-text task-text"
          ogeMathChoiceEnhance={subject === "math"}
          ogeInf13Enhance={isOgeInformaticsTask(level, subject, task.number, 13)}
          ogeRus13Enhance={isOgeRusTask13(level, subject, task.number)}
          ogeInf6Enhance={isOgeInformaticsTask(level, subject, task.number, 6)}
          egeInfFileEnhance={isEgeInformaticsContext(level, subject)}
          egeInf22Enhance={isEgeInfParallelProcessesTask(level, subject, task.number)}
          egeInf1Enhance={isEgeInfRoadGraphTask(level, subject, task.number)}
          egeInf2Enhance={isEgeInfTruthTableTask(level, subject, task.number)}
        />
      ) : null}
      <TaskFileAttachments task={task} />
      {task.author ? <div className="task-author">{task.author}</div> : null}
    </div>
  );
}

function VerdictBadge({ verdict }) {
  if (verdict === true) {
    return <span className="cb-review-detail__verdict is-ok">Верно</span>;
  }
  if (verdict === false) {
    return <span className="cb-review-detail__verdict is-bad">Неверно</span>;
  }
  return <span className="cb-review-detail__verdict is-empty">Нет ответа</span>;
}

function isImageAttachment(file) {
  return isHomeworkAttachmentImage(file);
}

function AttachmentList({ attachments, emptyLabel = "Файлы не прикреплены" }) {
  const [preview, setPreview] = useState(null);
  if (!attachments?.length) {
    return <p className="cb-review-detail__empty-answer">{emptyLabel}</p>;
  }
  return (
    <>
      <ul className="cb-review-detail__attachments">
        {attachments.map((file) => {
          const label = file.filename || file.name || "Файл";
          const previewable = isAttachmentPreviewable(file) || isImageAttachment(file);
          return (
            <li key={homeworkAttachmentKey(file)} className={isImageAttachment(file) ? "is-image" : ""}>
              {previewable ? (
                <button
                  type="button"
                  className={isImageAttachment(file) ? "cb-review-detail__file-thumb" : "cb-review-detail__file-link"}
                  onClick={() => openAttachmentPreferPreview(file, setPreview)}
                >
                  {isImageAttachment(file) ? (
                    <>
                      <img src={file.url} alt={label} />
                      <span>{label}</span>
                    </>
                  ) : (
                    label
                  )}
                </button>
              ) : (
                <a href={file.url} target="_blank" rel="noreferrer" className="cb-review-detail__file-link">
                  {label}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {preview ? (
        <AttachmentPreviewModal file={preview} onClose={() => setPreview(null)} />
      ) : null}
    </>
  );
}

const FEEDBACK_FILE_ACCEPT =
  ".kum,.xls,.xlsx,.xlsm,.xlsb,.csv,.tsv,.ods,.ots,.numbers,.png,.jpg,.jpeg,.webp,.gif,.bmp,.heic,.heif,.txt,.pdf,.doc,.docx,.odt,.rtf,.zip,.7z,.rar";

function ReviewFeedbackUpload({
  reviewId,
  taskId,
  taskNumber,
  enabled,
  initialAttachments,
  onAttachmentsChange,
}) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState(null);
  const files = Array.isArray(initialAttachments) ? initialAttachments : [];
  const [deletingKeys, setDeletingKeys] = useState(() => new Set());

  const applyChange = (updater) => {
    onAttachmentsChange?.(updater);
  };

  if (!enabled) {
    return <AttachmentList attachments={files} emptyLabel="Файлы не прикреплены" />;
  }

  const onFileSelect = async (e) => {
    const selected = Array.from(e.target.files || []);
    e.target.value = "";
    if (!selected.length) return;
    setUploading(true);
    setErr(null);
    const fd = new FormData();
    if (taskNumber != null && String(taskNumber).trim() !== "") {
      fd.append("task_number", String(taskNumber));
    }
    if (taskId != null && String(taskId).trim() !== "") fd.append("task_id", String(taskId));
    selected.forEach((file) => {
      fd.append("file", file, file.name || "file");
    });
    try {
      const data = await uploadReviewFeedback(reviewId, fd);
      const uploaded = Array.isArray(data.attachments) && data.attachments.length
        ? data.attachments
        : (data.url ? [{
            id: data.id,
            url: data.url,
            filename: data.filename || selected[0].name,
            content_type: data.content_type,
          }] : []);
      const canonical = uploaded.map((item, index) => normalizeHomeworkAttachment(item, {
        contentType: selected[index]?.type || item.content_type,
      })).filter(Boolean);
      applyChange((prev) => appendHomeworkAttachments(prev, canonical));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Не удалось загрузить файл");
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (file) => {
    const key = homeworkAttachmentKey(file);
    if (!key || deletingKeys.has(key)) return;
    setDeletingKeys((prev) => new Set(prev).add(key));
    setErr(null);
    try {
      if (file.id) {
        try {
          await deleteHomeworkAttachment(file.id);
        } catch {
          await deleteReviewFeedback(reviewId, {
            id: file.id,
            url: file.url,
            taskNumber,
            taskId,
          });
        }
      } else {
        await deleteReviewFeedback(reviewId, {
          id: file.id,
          url: file.url,
          taskNumber,
          taskId,
        });
      }
      applyChange((prev) => removeHomeworkAttachment(prev, file));
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Не удалось удалить файл");
    } finally {
      setDeletingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div className="cb-review-detail__feedback-upload">
      <AttachmentList attachments={files} emptyLabel="Файлы не прикреплены" />
      <div className="cb-review-detail__feedback-actions">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={FEEDBACK_FILE_ACCEPT}
          className="cb-review-detail__file-input"
          onChange={onFileSelect}
          disabled={uploading}
        />
        <button
          type="button"
          className="cb-review-detail__btn cb-review-detail__btn--ghost cb-review-detail__btn--compact"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? "Загрузка…" : "Прикрепить файлы"}
        </button>
      </div>
      <p className="cb-review-detail__feedback-hint">Можно несколько фото или файлов</p>
      {files.length > 0 ? (
        <ul className="cb-review-detail__feedback-delete-list">
          {files.map((file) => {
            const key = homeworkAttachmentKey(file);
            const deleting = deletingKeys.has(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="cb-review-detail__feedback-delete"
                  disabled={deleting}
                  onClick={() => onDelete(file)}
                >
                  {deleting ? "Удаление…" : `Удалить «${file.filename || file.name || "файл"}»`}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {err ? <p className="cb-inline-error" role="alert">{err}</p> : null}
    </div>
  );
}

const COMMENT_CHIPS = [
  "Отличное решение!",
  "Проверь вычисления и запиши промежуточные шаги.",
  "Обоснуй этот переход подробнее.",
];

function reviewInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "•";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function reviewSubjectTitle(level, subject, subjectLabel) {
  const short = String(subject || "").trim().toLowerCase();
  const stored = String(subjectLabel || "").trim();
  if (stored && stored.toLowerCase() !== short) return stored;
  const fromLevel = SUBJECTS_BY_LEVEL[String(level || "").trim().toLowerCase()]?.find((item) => item.id === short);
  if (fromLevel?.title) return fromLevel.title;
  if (short) {
    const fallback = buildSubjectDefinition(short);
    if (fallback.title && fallback.title !== short) return fallback.title;
  }
  return stored || subject || "";
}

function reviewSubjectLine(level, subject, subjectLabel) {
  const levelLabel = level === "ege" ? "ЕГЭ" : level === "oge" ? "ОГЭ" : (level || "");
  const title = reviewSubjectTitle(level, subject, subjectLabel);
  if (title && levelLabel && title.toLowerCase().includes(String(levelLabel).toLowerCase())) return title;
  return [title, levelLabel].filter(Boolean).join(" · ");
}

function taskStatus(task, part, scores, verdict) {
  if (part === 2) {
    const raw = scores[String(task.id)];
    if (raw === "" || raw == null) return "pending";
    const max = taskMaxScore(task);
    const score = Number(raw);
    if (score <= 0) return "wrong";
    if (score >= max) return "correct";
    return "partial";
  }
  if (verdict === true) return "correct";
  if (verdict === false) return "wrong";
  return "missing";
}

function ReviewWorkspace({
  part1Tasks,
  part2Tasks,
  result,
  subject,
  level,
  scores,
  setScores,
  taskComments,
  setTaskComments,
  isReadOnly,
  isPending,
  reviewId,
  submission,
  patchReviewAttachments,
  getPart1Verdict,
  reviewTaskTotal,
  assignment,
}) {
  const tasks = useMemo(() => [
    ...part1Tasks.map((task) => ({ ...task, part: 1 })),
    ...part2Tasks.map((task) => ({ ...task, part: 2 })),
  ], [part1Tasks, part2Tasks]);
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("all");

  const statusFor = useCallback((task) => {
    const verdict = task.part === 1
      ? getPart1Verdict(task, homeworkTaskAnswer(result, task.id, task.number, [...part1Tasks, ...part2Tasks]))
      : null;
    return taskStatus(task, task.part, scores, verdict);
  }, [getPart1Verdict, part1Tasks, part2Tasks, result, scores]);

  const pendingTasks = tasks.filter((task) => task.part === 2 && statusFor(task) === "pending");

  useEffect(() => {
    if (!tasks.length) return;
    setSelectedId((current) => {
      if (current != null && tasks.some((task) => String(task.id) === String(current))) return current;
      return (pendingTasks[0] || tasks[0]).id;
    });
  }, [tasks, pendingTasks]);

  const visible = filter === "pending" ? pendingTasks : tasks;
  const part1Visible = visible.filter((task) => task.part === 1);
  const part2Visible = visible.filter((task) => task.part === 2);
  const selected = tasks.find((task) => String(task.id) === String(selectedId)) || tasks[0] || null;
  const selectedIndex = selected ? tasks.findIndex((task) => task.id === selected.id) : -1;

  const correctCount = part1Tasks.filter((task) => (
    getPart1Verdict(task, homeworkTaskAnswer(result, task.id, task.number, tasks)) === true
  )).length;
  const answeredCount = tasks.filter((task) => {
    const answer = homeworkTaskAnswer(result, task.id, task.number, tasks);
    const files = homeworkTaskAttachments(result, task.id, task.number);
    return Boolean(String(answer || "").trim()) || files.length > 0 || (task.part === 2 && scores[String(task.id)] != null && scores[String(task.id)] !== "");
  }).length;
  const earned = correctCount + part2Tasks.reduce((sum, task) => {
    const raw = scores[String(task.id)];
    const n = Number(raw);
    return sum + (raw === "" || raw == null || Number.isNaN(n) ? 0 : n);
  }, 0);
  const possible = part1Tasks.length + part2Tasks.reduce((sum, task) => sum + taskMaxScore(task), 0);

  if (!tasks.length) {
    return <p className="cb-review-detail__empty-answer">Задания варианта ещё загружаются.</p>;
  }

  const answer = homeworkTaskAnswer(result, selected.id, selected.number, tasks);
  const verdict = selected.part === 1 ? getPart1Verdict(selected, answer) : null;
  const status = statusFor(selected);
  const studentFiles = homeworkTaskAttachments(result, selected.id, selected.number);
  const teacherFiles = homeworkTeacherAttachments(result, selected.id, selected.number);
  const images = studentFiles.filter(isImageAttachment);
  const max = taskMaxScore(selected);
  const scoreVal = scores[String(selected.id)];
  const comment = taskComments[String(selected.id)] || "";
  const statusText = {
    correct: "Верно",
    wrong: "Неверно",
    missing: "Нет ответа",
    pending: "Нужна проверка",
    partial: "Частично",
  }[status];

  const setScore = (value) => {
    setScores((prev) => ({ ...prev, [selected.id]: value }));
  };

  return (
    <>
      <section className="rv-summary" aria-label="Сводка работы">
        <div className="rv-summary__item">
          <span className="rv-summary__mark"><CabinetIcon name="tasks" /></span>
          <div><b>{answeredCount} <small>из {tasks.length}</small></b><p>Заданий с ответом</p></div>
        </div>
        <div className="rv-summary__item">
          <span className="rv-summary__mark"><CabinetIcon name="check" /></span>
          <div><b>{correctCount} <small>ответов</small></b><p>Верно по автопроверке</p></div>
        </div>
        <div className="rv-summary__item">
          <span className="rv-summary__mark"><CabinetIcon name="pencil" /></span>
          <div><b>{pendingTasks.length} <small>задания</small></b><p>Нужна ручная проверка</p></div>
        </div>
        <div className="rv-summary__item">
          <span className="rv-summary__mark"><CabinetIcon name="spark" /></span>
          <div><b>{earned} <small>баллов</small></b><p>Подтверждено из {possible} возможных</p></div>
        </div>
      </section>

      <div className="rv-work">
        <aside className="rv-card rv-tasks" aria-label="Задания">
          <div className="rv-card__head">
            <h2>Задания</h2>
            <span className="rv-count">{tasks.length}</span>
          </div>
          <div className="rv-filters">
            <button type="button" className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>
              Все {tasks.length}
            </button>
            <button type="button" className={filter === "pending" ? "is-on" : ""} onClick={() => setFilter("pending")}>
              Проверить {pendingTasks.length}
            </button>
          </div>
          {part1Visible.length ? (
            <div className="rv-part">
              <div className="rv-part__title"><span>Часть 1</span><span>Краткий ответ</span></div>
              <div className="rv-tiles">
                {part1Visible.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`rv-tile is-${statusFor(task)}${task.id === selected.id ? " is-on" : ""}`}
                    onClick={() => setSelectedId(task.id)}
                  >
                    {task.displayNumber || task.number}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {part2Visible.length ? (
            <div className="rv-part">
              <div className="rv-part__title"><span>Часть 2</span><span>Решение</span></div>
              <div className="rv-manual">
                {part2Visible.map((task) => {
                  const graded = statusFor(task) !== "pending";
                  const raw = scores[String(task.id)];
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={`rv-manual__item${task.id === selected.id ? " is-on" : ""}${graded ? " is-graded" : ""}`}
                      onClick={() => setSelectedId(task.id)}
                    >
                      <span className="rv-manual__num">{task.displayNumber || task.number}</span>
                      <span>
                        <b>{task.task_title || `Задание ${task.displayNumber || task.number}`}</b>
                        <small>{graded ? `${raw} из ${taskMaxScore(task)}` : "Нужна проверка"}</small>
                      </span>
                      <CabinetIcon name={graded ? "check" : "arrow"} />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {!visible.length ? <p className="rv-help">Все задания проверены.</p> : null}
          <div className="rv-legend">
            <span><i className="is-green" />Верно</span>
            <span><i className="is-red" />Ошибка</span>
            <span><i className="is-amber" />На проверку</span>
            <span><i />Нет ответа</span>
          </div>
          {assignment?.instruction || assignment?.tasks?.length || assignment?.attachments?.length ? (
            <div className="rv-note">
              <b>Задание ученику</b>
              {assignment.instruction ? <p>{assignment.instruction}</p> : null}
              <div className="rv-note__actions">
                {assignment.canEdit ? <Link to={assignment.editTo}>Состав задания</Link> : null}
                {assignment.canAdd ? (
                  <button type="button" disabled={assignment.adding} onClick={assignment.onAdd}>
                    {assignment.adding ? "Добавление…" : "Добавить задание"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </aside>

        <div className="rv-main">
          <section className="rv-card rv-question">
            <div className="rv-question__head">
              <div>
                <h2>
                  Задание {selected.displayNumber || selected.number}
                  <small>из {reviewTaskTotal || tasks.length}</small>
                </h2>
                <div className="rv-context">
                  <span>{selected.part === 2 ? "Развёрнутый ответ" : "Краткий ответ"}</span>
                  <span className={`rv-pill is-${status === "correct" ? "checked" : status === "wrong" ? "wrong" : status === "pending" || status === "partial" ? "pending" : "neutral"}`}>
                    {statusText}
                  </span>
                </div>
              </div>
              <div className="rv-nav">
                <button type="button" aria-label="Предыдущее задание" disabled={selectedIndex <= 0} onClick={() => setSelectedId(tasks[selectedIndex - 1].id)}>
                  <CabinetIcon name="arrowLeft" />
                </button>
                <button type="button" aria-label="Следующее задание" disabled={selectedIndex >= tasks.length - 1} onClick={() => setSelectedId(tasks[selectedIndex + 1].id)}>
                  <CabinetIcon name="arrow" />
                </button>
              </div>
            </div>
            <TaskCondition task={selected} level={level} subject={subject} />
            <details className="rv-ref">
              <summary>Эталонный ответ</summary>
              <div className="rv-ref__value">
                {hasOfficialTaskAnswer(selected.answer) ? (
                  <MathContent html={String(selected.answer)} plainHtml />
                ) : "Нет ответа в базе"}
              </div>
            </details>
          </section>

          <section className="rv-card rv-solution">
            <div className="rv-solution__head">
              <h2>{selected.part === 2 || studentFiles.length ? "Решение ученика" : "Ответ ученика"}</h2>
              <span className={`rv-pill is-${status === "correct" ? "checked" : status === "pending" ? "pending" : "neutral"}`}>{statusText}</span>
            </div>
            {images.length ? (
              <div className="rv-stage">
                <img src={images[0].url} alt={images[0].filename || images[0].name || "Решение ученика"} />
              </div>
            ) : null}
            <p className="rv-label">Ответ ученика</p>
            <div className={`rv-answer${answer ? "" : " is-empty"}`}>
              {answer ? <MathContent html={String(answer)} plainHtml /> : "Ответ отсутствует"}
            </div>
            {hasOfficialTaskAnswer(selected.answer) ? (
              <div className="rv-compare">
                <span>Эталонный ответ</span>
                <b><MathContent html={String(selected.answer)} plainHtml /></b>
              </div>
            ) : null}
            <div className="cb-review-detail__task-files">
              <AttachmentList attachments={studentFiles} emptyLabel="Файлы не прикреплены" />
              <TeacherNotebookActions
                submissionId={submission?.id}
                taskId={selected.id}
                taskNumber={selected.number}
                enabled={isPending}
                onComplete={(payload) => {
                  if (!payload.attachment) return;
                  patchReviewAttachments((list) => appendHomeworkAttachments(list, [payload.attachment]), {
                    taskId: selected.id,
                    taskNumber: selected.number,
                  });
                }}
              />
            </div>
          </section>
        </div>

        <aside className="rv-card rv-grade" id="gradePanel">
          <div className="rv-card__head">
            <h2>Проверка задания</h2>
            <span className="rv-count">№ {selected.displayNumber || selected.number}</span>
          </div>
          <p className="rv-grade__sub">
            {selected.part === 2 ? "Оцените решение и дайте обратную связь" : "Результат автоматической проверки"}
          </p>
          {selected.part === 2 ? (
            <>
              <span className="rv-label">Баллы за задание · максимум {max}</span>
              {isReadOnly ? (
                <p className="rv-help">{scoreVal === "" || scoreVal == null ? "Балл не выставлен" : `${scoreVal} из ${max}`}</p>
              ) : (
                <div className="rv-scores" style={{ gridTemplateColumns: `repeat(${Math.min(max + 1, 6)}, minmax(0, 1fr))` }}>
                  {Array.from({ length: max + 1 }, (_, value) => (
                    <button
                      key={value}
                      type="button"
                      className={`rv-score${Number(scoreVal) === value && scoreVal !== "" && scoreVal != null ? " is-on" : ""}`}
                      onClick={() => setScore(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )}
              <p className="rv-help">
                {scoreVal === "" || scoreVal == null ? "Выберите балл после просмотра решения" : "Оценка сохранится вместе с проверкой"}
              </p>
            </>
          ) : (
            <div className={`rv-auto${verdict === true ? " is-ok" : verdict === false ? " is-bad" : ""}`}>
              <CabinetIcon name={verdict === true ? "check" : verdict === false ? "close" : "minus"} />
              {statusText}
            </div>
          )}
          <label className="rv-label" htmlFor={`rv-comment-${selected.id}`}>Комментарий ученику</label>
          {isReadOnly ? (
            <p className="rv-help">{comment || homeworkTaskComment(result, selected.id, selected.number) || "Комментарий не указан"}</p>
          ) : (
            <>
              <textarea
                id={`rv-comment-${selected.id}`}
                className="rv-comment"
                value={comment}
                placeholder="Что получилось? На что обратить внимание?"
                onChange={(event) => setTaskComments((prev) => ({ ...prev, [selected.id]: event.target.value }))}
              />
              <div className="rv-chips">
                {COMMENT_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setTaskComments((prev) => {
                      const current = prev[String(selected.id)] || "";
                      return { ...prev, [selected.id]: current.trim() ? `${current.trim()}\n${chip}` : chip };
                    })}
                  >
                    {chip.split(" ").slice(0, 2).join(" ")}
                  </button>
                ))}
              </div>
            </>
          )}
          <ReviewFeedbackUpload
            reviewId={reviewId}
            taskId={selected.id}
            taskNumber={selected.number}
            enabled={isPending}
            initialAttachments={teacherFiles}
            onAttachmentsChange={(updater) => patchReviewAttachments(updater, {
              taskId: selected.id,
              taskNumber: selected.number,
            })}
          />
          {selected.part === 2 ? (
            <button
              type="button"
              className="rv-btn rv-btn--blue rv-next"
              onClick={() => {
                const next = pendingTasks.find((task) => task.id !== selected.id) || pendingTasks[0];
                if (next) setSelectedId(next.id);
              }}
            >
              {pendingTasks.filter((task) => task.id !== selected.id).length ? "Следующее на проверку" : "Все задания проверены"}
              <CabinetIcon name="arrow" />
            </button>
          ) : null}
        </aside>
      </div>
    </>
  );
}

export default function CabinetReviewDetailPage() {
  const { reviewId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const reviewListPath = location.state?.from || "/cabinet/review";
  const [review, setReview] = useState(null);
  const [variant, setVariant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [teacherComment, setTeacherComment] = useState("");
  const [scores, setScores] = useState({});
  const [taskComments, setTaskComments] = useState({});
  const [manualStats, setManualStats] = useState({
    correct: "",
    incorrect: "",
    total: "",
    unsolved: "",
  });
  const [confirmAction, setConfirmAction] = useState(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreMenuAnchor, setMoreMenuAnchor] = useState(null);
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [notice, setNotice] = useState("");
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [checkDoneBanner, setCheckDoneBanner] = useState(false);

  useEffect(() => {
    const fromQuery = searchParams.get("notice");
    if (!fromQuery) return;
    setNotice(fromQuery);
    const next = new URLSearchParams(searchParams);
    next.delete("notice");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const data = await fetchReviewItem(reviewId);
      setReview(data);
      const form = hydrateReviewForm(data);
      setTeacherComment(form.teacherComment);
      setScores(form.scores);
      setTaskComments(form.taskComments);
      setManualStats(form.manualStats);
    } catch (err) {
      console.error("REVIEW_DETAIL_LOAD_FAILED", {
        reviewId,
        message: err instanceof Error ? err.message : String(err),
      });
      setReview(null);
      setNotFound(true);
      setError(err instanceof Error ? err.message : "Не удалось загрузить работу");
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  const patchReviewAttachments = useCallback((updater, { taskId, taskNumber, comment = false } = {}) => {
    setReview((prev) => {
      if (!prev) return prev;
      const submission = prev.homework_submission && typeof prev.homework_submission === "object"
        ? prev.homework_submission
        : {};
      const result = submission.result_payload && typeof submission.result_payload === "object"
        ? submission.result_payload
        : {};
      const grouped = result.task_attachments || submission.task_attachments || { tasks: {}, comment: [] };
      const current = comment
        ? homeworkTeacherCommentAttachments({ ...result, task_attachments: grouped })
        : homeworkTeacherAttachments({ ...result, task_attachments: grouped }, taskId, taskNumber);
      const next = typeof updater === "function" ? updater(current) : updater;
      let task_attachments = { ...grouped, tasks: { ...(grouped.tasks || {}) } };
      if (comment) {
        task_attachments = { ...task_attachments, comment: next };
      } else {
        const bucket = { student: [], teacher: [], ...(task_attachments.tasks[String(taskId)] || {}) };
        bucket.teacher = next;
        task_attachments.tasks[String(taskId)] = bucket;
      }
      const nextResult = { ...result, task_attachments };
      if (comment) nextResult.teacher_comment_attachments = next;
      return {
        ...prev,
        homework_submission: {
          ...submission,
          task_attachments,
          result_payload: nextResult,
        },
      };
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submission = review?.homework_submission;
  const reviewCtx = review?.homework_review;
  const result = {
    ...(submission?.result_payload || {}),
    task_attachments: submission?.task_attachments || submission?.result_payload?.task_attachments,
  };
  const commentAttachments = homeworkTeacherCommentAttachments(result);
  const isPending = review?.status === "pending";
  const isChecked = review?.status === "checked";
  const awaitingSubmission = isPending && !submission?.submitted_at;
  const isReadOnly = !isPending || awaitingSubmission;
  const canDeleteHomework = Boolean(submission?.homework) && !isChecked;
  const canAddHomeworkTask = Boolean(submission?.homework) && !isChecked;
  const canCopyHomework = Boolean(submission?.homework || reviewCtx?.homework_id);
  const homeworkIdForCopy = submission?.homework || reviewCtx?.homework_id || null;
  const canEditHomework = Boolean(homeworkIdForCopy) && !isChecked;
  const homeworkTasks = visibleHomeworkResourceTasks(
    Array.isArray(reviewCtx?.tasks) ? reviewCtx.tasks : [],
    {
      description: reviewCtx?.description,
      attachments: reviewCtx?.attachments,
    },
  );
  const homeworkAttachments = Array.isArray(reviewCtx?.attachments) ? reviewCtx.attachments : [];
  const homeworkInstruction = extraHomeworkText(
    Array.isArray(reviewCtx?.tasks) ? reviewCtx.tasks : [],
    reviewCtx?.description,
  );
  const attachedMaterialIds = homeworkTasks
    .map((task) => Number(task.material_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const attachedInteractiveIds = homeworkTasks
    .map((task) => Number(task.interactive_id))
    .filter((id) => Number.isFinite(id) && id > 0);

  const variantUrl = buildTeacherVariantUrl(reviewCtx);
  const level = reviewCtx?.level;
  const subject = reviewCtx?.subject;

  useEffect(() => {
    if (!reviewCtx?.has_variant || !reviewCtx.level || !reviewCtx.subject || !reviewCtx.variant_id) {
      setVariant(null);
      return undefined;
    }
    const ac = new AbortController();
    const url = `/api/${encodeURIComponent(reviewCtx.level)}/${encodeURIComponent(reviewCtx.subject)}/variant/${encodeURIComponent(String(reviewCtx.variant_id))}/`;
    fetch(`${url}?role=teacher`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: ac.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setVariant(data))
      .catch(() => setVariant(null));
    return () => ac.abort();
  }, [reviewCtx]);

  const part1Tasks = useMemo(() => {
    if (!variant?.tasks?.length || !reviewCtx) return [];
    return assignDisplayNumbers(variant.tasks).filter(
      (t) => inferExamTaskPart(t, reviewCtx.level, reviewCtx.subject) === 1
    );
  }, [variant, reviewCtx]);

  const part2Tasks = useMemo(() => {
    if (!variant?.tasks?.length || !reviewCtx) return [];
    return assignDisplayNumbers(variant.tasks).filter(
      (t) => inferExamTaskPart(t, reviewCtx.level, reviewCtx.subject) === 2
    );
  }, [variant, reviewCtx]);
  const reviewTaskTotal = (variant?.tasks || []).length;

  const homeworkReviewData = useMemo(() => {
    if (!reviewCtx?.has_variant || !variant?.tasks?.length || !level || !subject) return null;
    const data = buildHomeworkReviewFromVariant(variant.tasks, result, level, subject);
    if (part2Tasks.length) {
      data.part2 = data.part2.map((row) => ({
        ...row,
        score: scores[row.taskId] ?? scores[String(row.taskId)] ?? row.score,
      }));
    }
    return data;
  }, [reviewCtx, variant, result, level, subject, part2Tasks, scores]);

  const buildAutoChecked = useCallback(() => {
    const autoChecked = {};
    const allTasks = variant?.tasks || part1Tasks;
    part1Tasks.forEach((task) => {
      const answer = homeworkTaskAnswer(result, task.id, task.number, allTasks);
      const verdict = resolvePart1Verdict(task, answer, result, subject);
      if (verdict === null) return;
      autoChecked[String(task.id)] = verdict === true;
    });
    return autoChecked;
  }, [part1Tasks, result, subject, variant?.tasks]);

  const buildPayload = () => {
    const payload = {
      teacher_comment: teacherComment.trim(),
      scores,
      checked: buildAutoChecked(),
      comments_by_task_id: taskComments,
    };
    if (!reviewCtx?.has_variant) {
      const cleaned = {};
      for (const key of ["correct", "incorrect", "total", "unsolved"]) {
        const raw = manualStats[key];
        if (raw === "" || raw == null) continue;
        const n = Number(raw);
        if (!Number.isNaN(n) && n >= 0) cleaned[key] = n;
      }
      if (Object.keys(cleaned).length) payload.manual_stats = cleaned;
    }
    return payload;
  };

  const setManualStatField = (key, value) => {
    setManualStats((prev) => {
      const next = { ...prev, [key]: value };
      const total = Number(next.total);
      const correct = Number(next.correct);
      const incorrect = Number(next.incorrect);
      if (
        next.total !== ""
        && next.correct !== ""
        && next.incorrect !== ""
        && !Number.isNaN(total)
        && !Number.isNaN(correct)
        && !Number.isNaN(incorrect)
      ) {
        next.unsolved = String(Math.max(0, total - correct - incorrect));
      }
      return next;
    });
  };

  const runCheck = async ({ stay = false } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await checkReviewItem(reviewId, buildPayload());
      setReview(updated);
      window.dispatchEvent(new Event("cabinet:nav-counts-refresh"));
      if (stay) {
        setCheckDoneBanner(true);
        setNotice("Проверка сохранена");
      } else {
        navigate(reviewListPath);
      }
    } catch (err) {
      setError(err.message || "Не удалось сохранить проверку");
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const runReturn = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await returnReviewItem(reviewId, buildPayload());
      setReview(updated);
      window.dispatchEvent(new Event("cabinet:nav-counts-refresh"));
      navigate(reviewListPath);
    } catch (err) {
      setError(err.message || "Не удалось вернуть работу");
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const runDeleteHomework = async () => {
    const homeworkId = submission?.homework;
    if (!homeworkId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteHomework(homeworkId);
      navigate(reviewListPath);
    } catch (err) {
      setError(err.message || "Не удалось удалить домашнее задание");
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const handleCheck = () => {
    setConfirmAction({
      type: "check",
      title: "Сохранить проверку?",
      text: "Сохранить оценку и отметить работу проверенной?",
      confirmLabel: "Проверено",
      danger: false,
      onConfirm: () => runCheck({ stay: false }),
    });
  };

  const handleReturn = () => {
    setConfirmAction({
      type: "return",
      title: "Вернуть работу?",
      text: teacherComment.trim()
        ? "Вернуть работу ученику на доработку?"
        : "Вернуть работу без общего комментария?",
      confirmLabel: "Вернуть",
      danger: false,
      onConfirm: runReturn,
    });
  };

  const handleDeleteHomework = () => {
    const homeworkId = submission?.homework;
    if (!homeworkId) return;
    const title = review?.title || "это домашнее задание";
    setConfirmAction({
      type: "delete",
      title: "Удалить задание?",
      text: `Удалить «${title}»?\n\nЭто действие нельзя отменить. Работа ученика тоже будет удалена.`,
      confirmLabel: "Удалить",
      danger: true,
      onConfirm: runDeleteHomework,
    });
  };

  const applyHomeworkTasksUpdate = async (payload) => {
    const homeworkId = submission?.homework || reviewCtx?.homework_id;
    if (!homeworkId || !canAddHomeworkTask) return;
    setAddingTask(true);
    setError(null);
    setNotice("");
    try {
      const updated = await addHomeworkTasks(homeworkId, payload);
      setReview((prev) => (
        prev
          ? {
            ...prev,
            homework_review: {
              ...(prev.homework_review || {}),
              ...updated,
            },
          }
          : prev
      ));
      setResourcePickerOpen(false);
      const notified = Number(updated?.notified_students || 0);
      setNotice(
        notified > 0
          ? "Задание добавлено. Ученик получил оповещение."
          : "Задание добавлено.",
      );
      try {
        const fresh = await fetchReviewItem(reviewId);
        setReview(fresh);
      } catch {
        /* локально уже обновили homework_review */
      }
    } catch (err) {
      setError(err?.message || "Не удалось добавить задание");
    } finally {
      setAddingTask(false);
    }
  };

  const handleAttachMaterialToHomework = async (material) => {
    if (!material?.id) return;
    await applyHomeworkTasksUpdate({ material_ids: [material.id] });
  };

  const handleAttachInteractiveToHomework = async (interactive) => {
    if (!interactive?.id) return;
    await applyHomeworkTasksUpdate({ interactive_ids: [interactive.id] });
  };

  const getPart1Verdict = (task, answer) => resolvePart1Verdict(task, answer, result, subject);
  usePageTitle(review?.title || "Проверка");
  const subjectLine = reviewSubjectLine(level, subject, reviewCtx?.subject_label);
  const statusKind = review?.status === "checked"
    ? "checked"
    : review?.status === "returned"
      ? "returned"
      : review?.status === "pending"
        ? "pending"
        : "neutral";

  if (loading) {
    return (
      <CabinetPageShell className="cb-section--review">
        <EducationalLoading message={LOADING_MESSAGES.fetch} />
      </CabinetPageShell>
    );
  }

  if (notFound || !review) {
    return (
      <CabinetPageShell className="cb-section--review">
        <CabinetPageHeader title="Проверка" />
        <p className="cb-inline-error" role="alert">
          {error || "Не удалось открыть работу ученика."}
        </p>
        <p className="cabinet-auth-muted">
          Попробуйте обновить страницу. Если проблема повторится — вернитесь к списку работ.
        </p>
        <div className="cb-review-detail__footer" style={{ justifyContent: "flex-start", gap: 12 }}>
          <button
            type="button"
            className="cb-review-detail__btn cb-review-detail__btn--ghost"
            onClick={() => load()}
          >
            Повторить
          </button>
          <Link to={reviewListPath} className="cb-review-detail__btn cb-review-detail__btn--primary">
            Назад к проверке
          </Link>
        </div>
      </CabinetPageShell>
    );
  }

  if (review.source_type !== "homework") {
    return (
      <CabinetPageShell className="cb-section--review">
        <CabinetPageHeader title="Проверка" />
        <p className="cb-inline-error">Этот тип работы пока не поддерживается.</p>
        <Link to={reviewListPath} className="cb-review-detail__back">Назад к проверке</Link>
      </CabinetPageShell>
    );
  }

  return (
    <CabinetPageShell className="cb-section--review cb-section--review-detail rv">
      <div className="rv">
      <Link to={reviewListPath} className="rv-back">
        <CabinetIcon name="arrowLeft" />
        К списку работ
      </Link>
      <div className="rv-heading">
        <div>
          <h1>{review.title || "Проверка домашнего задания"}</h1>
          <div className="rv-student">
            <span className="rv-avatar">{reviewInitials(review.student_name)}</span>
            <strong>{review.student_name || "Ученик"}</strong>
            {subjectLine ? <span className="rv-dot" /> : null}
            {subjectLine ? <span>{subjectLine}</span> : null}
            {submission?.submitted_at ? <span className="rv-dot" /> : null}
            {submission?.submitted_at ? <span>Сдано {formatReviewDate(submission.submitted_at)}</span> : null}
            <span className={`rv-pill is-${statusKind}`}>
              <CabinetIcon name={statusKind === "checked" ? "check" : "clock"} />
              {review.status_label || review.status}
            </span>
          </div>
        </div>
        <div className="rv-heading__actions">
          {variantUrl ? (
            <Link to={variantUrl} className="rv-btn">
              <CabinetIcon name="export" />
              Открыть вариант
            </Link>
          ) : null}
        </div>
      </div>

      {error ? <p className="cb-inline-error" role="alert">{error}</p> : null}
      {notice ? <p className="cb-inline-success" role="status">{notice}</p> : null}

      {reviewCtx?.has_variant ? null : (
      <section className="cb-review-detail__panel">
        <div className="cb-review-detail__panel-head">
          <h2 className="cb-review-detail__panel-title">Состав задания</h2>
          <div className="cb-review-detail__panel-actions">
            {canEditHomework ? (
              <Link
                to={`/cabinet/homework/${encodeURIComponent(String(homeworkIdForCopy))}/edit?review=${encodeURIComponent(String(reviewId))}`}
                className="cb-review-detail__btn cb-review-detail__btn--ghost cb-review-detail__btn--compact"
              >
                Редактировать ДЗ
              </Link>
            ) : null}
            {canAddHomeworkTask ? (
              <button
                type="button"
                className="cb-review-detail__btn cb-review-detail__btn--ghost cb-review-detail__btn--compact"
                disabled={addingTask}
                onClick={() => setResourcePickerOpen(true)}
              >
                {addingTask ? "Добавление…" : "Добавить задание"}
              </button>
            ) : null}
          </div>
        </div>
        {homeworkInstruction ? (
          <p className="cb-review-detail__hw-desc">{homeworkInstruction}</p>
        ) : null}
        {homeworkAttachments.length ? (
          <ul className="cb-review-detail__hw-tasks">
            {homeworkAttachments.map((file) => (
              <li key={file.id || file.url} className="cb-review-detail__hw-task">
                <div className="cb-review-detail__hw-task-main">
                  <strong>{file.name || file.original_name || "Файл"}</strong>
                  <span>Файл</span>
                </div>
                {file.url ? (
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="cb-review-detail__hw-task-link"
                  >
                    Открыть
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {homeworkTasks.length ? (
          <ul className="cb-review-detail__hw-tasks">
            {homeworkTasks.map((task) => (
              <li key={task.id || `${task.title}-${task.variant_id || ""}`} className="cb-review-detail__hw-task">
                <div className="cb-review-detail__hw-task-main">
                  <strong>{task.title || "Задание"}</strong>
                  <span>{homeworkTaskMeta(task)}</span>
                </div>
                {task.open_url || task.file_url ? (
                  <a
                    href={task.open_url || task.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="cb-review-detail__hw-task-link"
                  >
                    Открыть
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!homeworkInstruction && !homeworkAttachments.length && !homeworkTasks.length ? (
          <p className="cb-review-detail__empty-answer">
            В этом домашнем задании пока нет отдельных материалов.
          </p>
        ) : null}
        {canAddHomeworkTask ? (
          <p className="cb-review-detail__panel-hint">
            При добавлении задания ученик сразу получит оповещение.
          </p>
        ) : null}
      </section>
      )}

      {awaitingSubmission ? (
        <section className="cb-review-detail__panel">
          <h2 className="cb-review-detail__panel-title">Ожидает сдачи</h2>
          <p className="cb-review-detail__empty-answer">
            Задание выдано. Ответы ученика появятся здесь после сдачи.
          </p>
        </section>
      ) : null}

      {!awaitingSubmission && homeworkReviewData && !reviewCtx?.has_variant ? (
        <section className="cb-review-detail__panel cb-review-detail__panel--summary">
          <HomeworkReviewSummary
            review={homeworkReviewData}
            className="hw-review-results cb-review-detail__summary"
          />
        </section>
      ) : null}

      {!awaitingSubmission && !reviewCtx?.has_variant ? (
        <>
          <section className="cb-review-detail__panel">
            <h2 className="cb-review-detail__panel-title">Ответ ученика</h2>
            <div className="cb-review-detail__simple-answer">
              {submission?.answer_text?.trim() ? (
                <p>{submission.answer_text}</p>
              ) : (
                <p className="cb-review-detail__empty-answer">Текстовый ответ не указан</p>
              )}
              {submission?.attached_files?.length || submission?.attached_file_url ? (
                <AttachmentList
                  attachments={
                    submission?.attached_files?.length
                      ? submission.attached_files
                      : [{
                          id: "main",
                          url: submission.attached_file_url,
                          name: submission.attached_file_name || "Прикреплённый файл",
                          filename: submission.attached_file_name || "Прикреплённый файл",
                        }]
                  }
                  emptyLabel="Файлы не прикреплены"
                />
              ) : null}
              <div className="cb-review-detail__task-files">
                <span className="cb-review-detail__section-label">Тетрадь проверки</span>
                <TeacherNotebookActions
                  submissionId={submission?.id}
                  taskId={
                    reviewCtx?.notebook_task_id
                    ?? ((Array.isArray(reviewCtx?.tasks) && reviewCtx.tasks[0]?.id != null)
                      ? reviewCtx.tasks[0].id
                      : "__homework__")
                  }
                  enabled={isPending}
                  onComplete={(payload) => {
                    if (!payload.attachment) return;
                    const taskId = reviewCtx?.notebook_task_id
                      ?? ((Array.isArray(reviewCtx?.tasks) && reviewCtx.tasks[0]?.id != null)
                        ? reviewCtx.tasks[0].id
                        : "__homework__");
                    patchReviewAttachments(
                      (list) => appendHomeworkAttachments(list, [payload.attachment]),
                      { taskId },
                    );
                  }}
                />
              </div>
            </div>
          </section>

          <section className="cb-review-detail__panel">
            <h2 className="cb-review-detail__panel-title">Результаты проверки</h2>
            <p className="cb-review-detail__panel-hint">
              Заполните, сколько заданий решено верно, неверно и сколько не решено.
            </p>
            <div className="cb-review-detail__manual-stats">
              {[
                { key: "total", label: "Всего заданий" },
                { key: "correct", label: "Правильно" },
                { key: "incorrect", label: "Неправильно" },
                { key: "unsolved", label: "Не решено" },
              ].map(({ key, label }) => (
                <label key={key} className="cb-review-detail__manual-stat">
                  <span>{label}</span>
                  {isReadOnly ? (
                    <strong>
                      {manualStats[key] === "" || manualStats[key] == null
                        ? "—"
                        : manualStats[key]}
                    </strong>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={manualStats[key]}
                      onChange={(e) => setManualStatField(key, e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
            {(manualStats.total !== "" && manualStats.correct !== "") ? (
              <p className="cb-review-detail__manual-percent">
                Итог:{" "}
                <strong>
                  {Number(manualStats.total) > 0
                    ? Math.round(
                      (Number(manualStats.correct) * 100) / Number(manualStats.total),
                    )
                    : 0}
                  %
                </strong>
              </p>
            ) : null}
          </section>
        </>
      ) : reviewCtx?.has_variant ? (
        <ReviewWorkspace
          part1Tasks={part1Tasks}
          part2Tasks={part2Tasks}
          result={result}
          subject={subject}
          level={level}
          scores={scores}
          setScores={setScores}
          taskComments={taskComments}
          setTaskComments={setTaskComments}
          isReadOnly={isReadOnly}
          isPending={isPending}
          reviewId={reviewId}
          submission={submission}
          patchReviewAttachments={patchReviewAttachments}
          getPart1Verdict={getPart1Verdict}
          reviewTaskTotal={reviewTaskTotal}
          assignment={{
            instruction: homeworkInstruction,
            tasks: homeworkTasks,
            attachments: homeworkAttachments,
            canEdit: canEditHomework,
            editTo: `/cabinet/homework/${encodeURIComponent(String(homeworkIdForCopy || ""))}/edit?review=${encodeURIComponent(String(reviewId))}`,
            canAdd: canAddHomeworkTask,
            adding: addingTask,
            onAdd: () => setResourcePickerOpen(true),
          }}
        />
      ) : null}


      {!awaitingSubmission ? (
      <section className="cb-review-detail__panel">
        <h2 className="cb-review-detail__panel-title">Комментарий учителя</h2>
        {isReadOnly ? (
          <p className="cb-review-detail__teacher-comment">
            {teacherComment.trim() || "Комментарий не указан"}
          </p>
        ) : (
          <textarea
            className="cb-review-detail__comment cb-review-detail__comment--wide"
            rows={4}
            placeholder="Общий комментарий к работе"
            value={teacherComment}
            onChange={(e) => setTeacherComment(e.target.value)}
          />
        )}
        <div className="cb-review-detail__task-files">
          <span className="cb-review-detail__section-label">Файлы к комментарию</span>
          <ReviewFeedbackUpload
            reviewId={reviewId}
            enabled={isPending}
            initialAttachments={commentAttachments}
            onAttachmentsChange={(updater) => patchReviewAttachments(updater, { comment: true })}
          />
        </div>
      </section>
      ) : null}

      {checkDoneBanner ? (
        <section className="cb-review-detail__done-banner" aria-live="polite">
          <div>
            <strong>Проверка завершена</strong>
            <p className="cabinet-auth-muted" style={{ margin: "4px 0 0" }}>
              Ошибки ученика доступны в журнале — там можно составить работу над ошибками.
            </p>
          </div>
          <div className="cb-review-detail__done-actions">
            {review?.student || submission?.student ? (
              <Link
                className="cb-review-detail__btn cb-review-detail__btn--primary"
                to={`/cabinet/journal?student=${encodeURIComponent(String(review?.student || submission?.student))}&tab=errors`}
              >
                Ошибки в журнале
              </Link>
            ) : null}
            <button
              type="button"
              className="cb-review-detail__btn cb-review-detail__btn--ghost"
              onClick={() => navigate(reviewListPath)}
            >
              Назад к проверке
            </button>
          </div>
        </section>
      ) : null}

      <div className="cb-review-detail__footer rv-bottom">
        {reviewCtx?.has_variant ? (
          <span className="rv-progress">
            Проверено <b>{part1Tasks.filter((task) => (
              getPart1Verdict(task, homeworkTaskAnswer(result, task.id, task.number, [...part1Tasks, ...part2Tasks])) != null
            )).length + part2Tasks.filter((task) => {
              const raw = scores[String(task.id)];
              return raw !== "" && raw != null;
            }).length} из {part1Tasks.length + part2Tasks.length}</b>
          </span>
        ) : <span />}
        <div className="rv-bottom__actions">
        <Link
          to={
            review?.student || submission?.student
              ? `/cabinet/journal?student=${encodeURIComponent(String(review?.student || submission?.student))}&tab=errors`
              : "/cabinet/journal"
          }
          className="cb-review-detail__btn cb-review-detail__btn--ghost"
          aria-label="Ошибки ученика"
        >
          <span className="rv-bottom__full">Ошибки ученика</span>
          <span className="rv-bottom__short">Ошибки</span>
        </Link>
        {canCopyHomework || submission?.homework ? (
          <div className="cb-review-detail__more">
            <button
              type="button"
              className="cb-review-detail__more-btn"
              aria-label="Ещё действия"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              disabled={busy}
              onClick={(e) => {
                setMoreMenuAnchor(moreMenuOpen ? null : e.currentTarget);
                setMoreMenuOpen((open) => !open);
              }}
            >
              ⋯
            </button>
            <CabinetFloatingMenu
              open={moreMenuOpen}
              anchorEl={moreMenuAnchor}
              onClose={() => {
                setMoreMenuOpen(false);
                setMoreMenuAnchor(null);
              }}
              className="cb-review-detail__menu"
              align="left"
              width={180}
            >
                {canEditHomework ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="cb-review-detail__menu-item"
                    disabled={busy}
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setMoreMenuAnchor(null);
                      navigate(
                        `/cabinet/homework/${encodeURIComponent(String(homeworkIdForCopy))}/edit?review=${encodeURIComponent(String(reviewId))}`,
                      );
                    }}
                  >
                    Редактировать
                  </button>
                ) : null}
                {canCopyHomework ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="cb-review-detail__menu-item"
                    disabled={busy}
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setMoreMenuAnchor(null);
                      setCopyModalOpen(true);
                    }}
                  >
                    Скопировать другим
                  </button>
                ) : null}
                {submission?.homework ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="cb-review-detail__menu-item cb-review-detail__menu-item--danger"
                    disabled={busy || !canDeleteHomework}
                    title={
                      canDeleteHomework
                        ? "Удалить домашнее задание вместе с работой ученика"
                        : "Проверенное и принятое ДЗ удалить нельзя"
                    }
                    onClick={() => {
                      if (!canDeleteHomework) return;
                      setMoreMenuOpen(false);
                      setMoreMenuAnchor(null);
                      handleDeleteHomework();
                    }}
                  >
                    Удалить ДЗ
                  </button>
                ) : null}
            </CabinetFloatingMenu>
          </div>
        ) : null}
        {isPending && !awaitingSubmission ? (
          <>
            <button
              type="button"
              className="cb-review-detail__btn cb-review-detail__btn--ghost"
              disabled={busy}
              onClick={handleReturn}
              aria-label="Вернуть на доработку"
            >
              <span className="rv-bottom__full">Вернуть на доработку</span>
              <span className="rv-bottom__short">Вернуть</span>
            </button>
            <button
              type="button"
              className="cb-review-detail__btn cb-review-detail__btn--primary"
              disabled={busy}
              onClick={handleCheck}
            >
              {busy ? "Сохранение…" : "Проверено"}
            </button>
          </>
        ) : null}
        </div>
      </div>

      <ConfirmActionModal
        open={Boolean(confirmAction)}
        title={confirmAction?.title || "Подтвердите действие"}
        text={confirmAction?.text || ""}
        confirmLabel={confirmAction?.confirmLabel || "Подтвердить"}
        danger={Boolean(confirmAction?.danger)}
        loading={busy}
        onClose={() => { if (!busy) setConfirmAction(null); }}
        onConfirm={() => confirmAction?.onConfirm?.()}
      />

      <PlanItemResourcesPicker
        scope="homework"
        open={resourcePickerOpen}
        attachedMaterialIds={attachedMaterialIds}
        attachedInteractiveIds={attachedInteractiveIds}
        onClose={() => {
          if (!addingTask) setResourcePickerOpen(false);
        }}
        onAttachMaterial={handleAttachMaterialToHomework}
        onAttachInteractive={handleAttachInteractiveToHomework}
      />

      {copyModalOpen && homeworkIdForCopy ? (
        <HomeworkCopyModal
          homeworkId={homeworkIdForCopy}
          homeworkTitle={reviewCtx?.homework_title || review?.title || ""}
          sourceStudentId={review?.student || submission?.student || null}
          sourceDueAt={reviewCtx?.due_at || null}
          onClose={() => setCopyModalOpen(false)}
          onCopied={(result) => {
            const n = result?.created_count || 0;
            setNotice(
              n > 0
                ? `Скопировано ученикам: ${n}`
                : "Задание скопировано",
            );
            window.dispatchEvent(new Event("cabinet:nav-counts-refresh"));
          }}
        />
      ) : null}
      </div>
    </CabinetPageShell>
  );
}
