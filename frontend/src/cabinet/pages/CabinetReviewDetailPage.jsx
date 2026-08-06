import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import MathContent from "../../components/MathContent";
import TaskFileAttachment from "../../components/TaskFileAttachment";
import {
  CabinetPageShell,
  CabinetPageHeader,
} from "../CabinetSectionUi";
import {
  buildTeacherVariantUrl,
  formatReviewDate,
  homeworkTaskAnswer,
  homeworkTaskAttachments,
  homeworkTaskComment,
  homeworkTaskScore,
  homeworkTeacherAttachments,
  inferExamTaskPart,
  resolvePart1Verdict,
  taskMaxScore,
} from "../cabinetReviewUtils";
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
import HomeworkReviewSummary, {
  buildHomeworkReviewFromVariant,
} from "../HomeworkReviewResults";

const HW_TASK_TYPE_RU = {
  text: "Текст",
  file: "Файл",
  interactive: "Интерактив",
  generated_task: "Вариант",
  external_link: "Ссылка",
};

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
  if (!task?.text && !task?.file) return null;
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
      {task.file ? <TaskFileAttachment href={task.file} /> : null}
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

function AttachmentList({ attachments, emptyLabel = "Файлы не прикреплены" }) {
  if (!attachments?.length) {
    return <p className="cb-review-detail__empty-answer">{emptyLabel}</p>;
  }
  return (
    <ul className="cb-review-detail__attachments">
      {attachments.map((file) => (
        <li key={file.url}>
          <a href={file.url} target="_blank" rel="noreferrer" className="cb-review-detail__file-link">
            {file.filename || "Файл"}
          </a>
        </li>
      ))}
    </ul>
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
  onChange,
}) {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [files, setFiles] = useState(initialAttachments || []);

  useEffect(() => {
    setFiles(Array.isArray(initialAttachments) ? initialAttachments : []);
  }, [initialAttachments]);

  if (!enabled) {
    return <AttachmentList attachments={files} emptyLabel="Файлы не прикреплены" />;
  }

  const onFileSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append("task_number", String(taskNumber));
    if (taskId != null && String(taskId).trim() !== "") fd.append("task_id", String(taskId));
    fd.append("file", file);
    try {
      const data = await uploadReviewFeedback(reviewId, fd);
      const entry = {
        url: String(data.url || ""),
        filename: String(data.filename || file.name),
      };
      setFiles((prev) => [...prev, entry]);
      onChange?.();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (fileUrl) => {
    setBusy(true);
    setErr(null);
    try {
      await deleteReviewFeedback(reviewId, {
        url: fileUrl,
        taskNumber,
        taskId,
      });
      setFiles((prev) => prev.filter((f) => f.url !== fileUrl));
      onChange?.();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Не удалось удалить файл");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cb-review-detail__feedback-upload">
      <AttachmentList attachments={files} emptyLabel="Файлы не прикреплены" />
      <div className="cb-review-detail__feedback-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept={FEEDBACK_FILE_ACCEPT}
          className="cb-review-detail__file-input"
          onChange={onFileSelect}
          disabled={busy}
        />
        <button
          type="button"
          className="cb-review-detail__btn cb-review-detail__btn--ghost cb-review-detail__btn--compact"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? "Загрузка…" : "Прикрепить файл"}
        </button>
      </div>
      {files.length > 0 ? (
        <ul className="cb-review-detail__feedback-delete-list">
          {files.map((file) => (
            <li key={file.url}>
              <button
                type="button"
                className="cb-review-detail__feedback-delete"
                disabled={busy}
                onClick={() => onDelete(file.url)}
              >
                Удалить «{file.filename || "файл"}»
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {err ? <p className="cb-inline-error" role="alert">{err}</p> : null}
    </div>
  );
}

export default function CabinetReviewDetailPage() {
  const { reviewId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const moreMenuRef = useRef(null);
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
    try {
      const data = await fetchReviewItem(reviewId);
      setReview(data);
      const form = hydrateReviewForm(data);
      setTeacherComment(form.teacherComment);
      setScores(form.scores);
      setTaskComments(form.taskComments);
      setManualStats(form.manualStats);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    load();
  }, [load]);

  const submission = review?.homework_submission;
  const reviewCtx = review?.homework_review;
  const result = submission?.result_payload || {};
  const isPending = review?.status === "pending";
  const isChecked = review?.status === "checked";
  const awaitingSubmission = isPending && !submission?.submitted_at;
  const isReadOnly = !isPending || awaitingSubmission;
  const canDeleteHomework = Boolean(submission?.homework) && !isChecked;
  const canAddHomeworkTask = Boolean(submission?.homework) && !isChecked;
  const canCopyHomework = Boolean(submission?.homework || reviewCtx?.homework_id);
  const homeworkIdForCopy = submission?.homework || reviewCtx?.homework_id || null;
  const canEditHomework = Boolean(homeworkIdForCopy);
  const homeworkTasks = Array.isArray(reviewCtx?.tasks) ? reviewCtx.tasks : [];
  const attachedMaterialIds = homeworkTasks
    .map((task) => Number(task.material_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const attachedInteractiveIds = homeworkTasks
    .map((task) => Number(task.interactive_id))
    .filter((id) => Number.isFinite(id) && id > 0);

  useEffect(() => {
    if (!moreMenuOpen) return undefined;
    const onPointerDown = (event) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setMoreMenuOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMoreMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreMenuOpen]);

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
    fetch(url, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setVariant(data))
      .catch(() => setVariant(null));
    return () => ac.abort();
  }, [reviewCtx]);

  const part1Tasks = useMemo(() => {
    if (!variant?.tasks?.length || !reviewCtx) return [];
    return variant.tasks
      .filter((t) => inferExamTaskPart(t, reviewCtx.level, reviewCtx.subject) === 1)
      .sort((a, b) => a.number - b.number);
  }, [variant, reviewCtx]);

  const part2Tasks = useMemo(() => {
    if (!variant?.tasks?.length || !reviewCtx) return [];
    return variant.tasks
      .filter((t) => inferExamTaskPart(t, reviewCtx.level, reviewCtx.subject) === 2)
      .sort((a, b) => a.number - b.number);
  }, [variant, reviewCtx]);

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
        navigate("/cabinet/review");
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
      navigate("/cabinet/review");
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
      navigate("/cabinet/review");
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
      onConfirm: () => runCheck({ stay: true }),
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

  if (loading) {
    return (
      <CabinetPageShell className="cb-section--review">
        <p className="cb-loading">Загрузка работы…</p>
      </CabinetPageShell>
    );
  }

  if (notFound || !review) {
    return <Navigate to="/cabinet/review" replace />;
  }

  if (review.source_type !== "homework") {
    return (
      <CabinetPageShell className="cb-section--review">
        <CabinetPageHeader title="Проверка" />
        <p className="cb-inline-error">Этот тип работы пока не поддерживается.</p>
        <Link to="/cabinet/review" className="cb-review-detail__back">← К списку</Link>
      </CabinetPageShell>
    );
  }

  return (
    <CabinetPageShell className="cb-section--review cb-section--review-detail">
      <div className="cb-review-detail__topbar">
        <Link to="/cabinet/review" className="cb-review-detail__back">← К списку</Link>
        {variantUrl ? (
          <Link to={variantUrl} className="cb-review-detail__open-variant">
            Открыть вариант
          </Link>
        ) : null}
      </div>

      <CabinetPageHeader title={review.title || "Проверка домашнего задания"} />

      <section className="cb-review-detail__meta">
        <div>
          <span className="cb-review-detail__meta-label">Ученик</span>
          <strong>{review.student_name || "—"}</strong>
        </div>
        <div>
          <span className="cb-review-detail__meta-label">Статус</span>
          <strong>{review.status_label || review.status}</strong>
        </div>
        <div>
          <span className="cb-review-detail__meta-label">Сдано</span>
          <strong>{formatReviewDate(submission?.submitted_at)}</strong>
        </div>
        {submission?.score != null ? (
          <div>
            <span className="cb-review-detail__meta-label">Авто-баллы</span>
            <strong>{submission.score}%</strong>
          </div>
        ) : null}
      </section>

      {error ? <p className="cb-inline-error" role="alert">{error}</p> : null}
      {notice ? <p className="cb-inline-success" role="status">{notice}</p> : null}

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
        {reviewCtx?.description ? (
          <p className="cb-review-detail__hw-desc">{reviewCtx.description}</p>
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
        ) : (
          <p className="cb-review-detail__empty-answer">
            В этом домашнем задании пока нет отдельных материалов.
          </p>
        )}
        {canAddHomeworkTask ? (
          <p className="cb-review-detail__panel-hint">
            При добавлении задания ученик сразу получит оповещение.
          </p>
        ) : null}
      </section>

      {awaitingSubmission ? (
        <section className="cb-review-detail__panel">
          <h2 className="cb-review-detail__panel-title">Ожидает сдачи</h2>
          <p className="cb-review-detail__empty-answer">
            Задание выдано. Ответы ученика появятся здесь после сдачи.
          </p>
        </section>
      ) : null}

      {!awaitingSubmission && homeworkReviewData ? (
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
              {submission?.attached_file_url ? (
                <p>
                  <a href={submission.attached_file_url} target="_blank" rel="noreferrer">
                    {submission.attached_file_name || "Прикреплённый файл"}
                  </a>
                </p>
              ) : null}
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
      ) : !awaitingSubmission ? (
        <>
          <section className="cb-review-detail__panel">
            <h2 className="cb-review-detail__panel-title">Часть 1 — краткий ответ</h2>
            <p className="cb-review-detail__panel-hint">
              Ответы проверяются автоматически. Добавьте комментарий при необходимости.
            </p>
            {part1Tasks.length === 0 ? (
              <p className="cb-review-detail__empty-answer">Задания части 1 не загружены</p>
            ) : (
              <div className="cb-review-detail__tasks">
                {part1Tasks.map((task) => {
                  const answer = homeworkTaskAnswer(result, task.id, task.number, variant?.tasks);
                  const verdict = getPart1Verdict(task, answer);
                  const tableAnswer = isTableAnswerTask(subject, task.number);
                  return (
                    <article key={task.id} className="cb-review-detail__task">
                      <div className="cb-review-detail__task-head">
                        <span className="cb-review-detail__task-num">{task.number}</span>
                        <strong>Задание {task.number}</strong>
                        <VerdictBadge verdict={verdict} />
                      </div>
                      <TaskCondition task={task} level={level} subject={subject} />
                      <div className="cb-review-detail__answer-block">
                        <span className="cb-review-detail__section-label">Правильный ответ</span>
                        <div
                          className={`cb-review-detail__task-answer${tableAnswer ? " cb-review-detail__task-answer--pre" : ""}`}
                        >
                          {task.answer ? (
                            <MathContent html={String(task.answer)} plainHtml />
                          ) : (
                            <span className="cb-review-detail__empty-answer">Нет ответа в базе</span>
                          )}
                        </div>
                      </div>
                      <div className="cb-review-detail__answer-block">
                        <span className="cb-review-detail__section-label">Ответ ученика</span>
                        <div
                          className={`cb-review-detail__task-answer${tableAnswer ? " cb-review-detail__task-answer--pre" : ""}`}
                        >
                          {answer || <span className="cb-review-detail__empty-answer">Нет ответа</span>}
                        </div>
                      </div>
                      {!isReadOnly ? (
                        <textarea
                          className="cb-review-detail__comment"
                          rows={2}
                          placeholder="Комментарий к заданию (необязательно)"
                          value={taskComments[String(task.id)] || ""}
                          onChange={(e) => setTaskComments((p) => ({
                            ...p,
                            [task.id]: e.target.value,
                          }))}
                        />
                      ) : homeworkTaskComment(result, task.id, task.number) ? (
                        <p className="cb-review-detail__task-note">
                          {homeworkTaskComment(result, task.id, task.number)}
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="cb-review-detail__panel">
            <h2 className="cb-review-detail__panel-title">Часть 2 — развёрнутый ответ</h2>
            {part2Tasks.length === 0 ? (
              <p className="cb-review-detail__empty-answer">Задания части 2 не загружены</p>
            ) : (
              <div className="cb-review-detail__tasks">
                {part2Tasks.map((task) => {
                  const answer = homeworkTaskAnswer(result, task.id, task.number, variant?.tasks);
                  const studentAttachments = homeworkTaskAttachments(result, task.id, task.number);
                  const teacherAttachments = homeworkTeacherAttachments(result, task.id, task.number);
                  const max = taskMaxScore(task);
                  const scoreVal = scores[String(task.id)] ?? homeworkTaskScore(result, task.id);
                  return (
                    <article key={task.id} className="cb-review-detail__task">
                      <div className="cb-review-detail__task-head">
                        <span className="cb-review-detail__task-num">{task.number}</span>
                        <strong>Задание {task.number}</strong>
                      </div>
                      <TaskCondition task={task} level={level} subject={subject} />
                      <div className="cb-review-detail__answer-block">
                        <span className="cb-review-detail__section-label">Правильный ответ</span>
                        {task.answer ? (
                          <div className="cb-review-detail__task-answer">
                            <MathContent html={String(task.answer)} plainHtml />
                          </div>
                        ) : (
                          <p className="cb-review-detail__empty-answer">Нет ответа в базе</p>
                        )}
                      </div>
                      <div className="cb-review-detail__answer-block">
                        <span className="cb-review-detail__section-label">Ответ ученика</span>
                        {answer ? (
                          <div className="cb-review-detail__task-answer">{answer}</div>
                        ) : (
                          <p className="cb-review-detail__empty-answer">Текстовый ответ не указан</p>
                        )}
                      </div>
                      <div className="cb-review-detail__task-files">
                        <span className="cb-review-detail__section-label">Файлы ученика</span>
                        <AttachmentList attachments={studentAttachments} />
                      </div>
                      <div className="cb-review-detail__score-row">
                        <label htmlFor={`score-${task.id}`}>
                          Баллы (0–{max})
                        </label>
                        {isReadOnly ? (
                          <strong>{scoreVal === "" ? "—" : scoreVal}</strong>
                        ) : (
                          <input
                            id={`score-${task.id}`}
                            type="number"
                            min={0}
                            max={max}
                            step={1}
                            value={scoreVal === "" ? "" : scoreVal}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "") {
                                setScores((p) => {
                                  const next = { ...p };
                                  delete next[String(task.id)];
                                  return next;
                                });
                                return;
                              }
                              const n = Math.max(0, Math.min(max, Number(raw) || 0));
                              setScores((p) => ({ ...p, [task.id]: n }));
                            }}
                          />
                        )}
                      </div>
                      {!isReadOnly ? (
                        <textarea
                          className="cb-review-detail__comment"
                          rows={2}
                          placeholder="Комментарий к заданию (необязательно)"
                          value={taskComments[String(task.id)] || ""}
                          onChange={(e) => setTaskComments((p) => ({
                            ...p,
                            [task.id]: e.target.value,
                          }))}
                        />
                      ) : homeworkTaskComment(result, task.id, task.number) ? (
                        <p className="cb-review-detail__task-note">
                          {homeworkTaskComment(result, task.id, task.number)}
                        </p>
                      ) : null}
                      <div className="cb-review-detail__task-files">
                        <span className="cb-review-detail__section-label">Файлы с разбором ошибок</span>
                        <ReviewFeedbackUpload
                          reviewId={reviewId}
                          taskId={task.id}
                          taskNumber={task.number}
                          enabled={isPending}
                          initialAttachments={teacherAttachments}
                          onChange={load}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
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
              onClick={() => navigate("/cabinet/review")}
            >
              К списку работ
            </button>
          </div>
        </section>
      ) : null}

      <div className="cb-review-detail__footer">
        <Link
          to={
            review?.student || submission?.student
              ? `/cabinet/journal?student=${encodeURIComponent(String(review?.student || submission?.student))}&tab=errors`
              : "/cabinet/journal"
          }
          className="cb-review-detail__btn cb-review-detail__btn--ghost"
        >
          Ошибки ученика
        </Link>
        {canCopyHomework || submission?.homework ? (
          <div className="cb-review-detail__more" ref={moreMenuRef}>
            <button
              type="button"
              className="cb-review-detail__more-btn"
              aria-label="Ещё действия"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              disabled={busy}
              onClick={() => setMoreMenuOpen((open) => !open)}
            >
              ⋯
            </button>
            {moreMenuOpen ? (
              <div className="cb-review-detail__menu" role="menu">
                {canEditHomework ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="cb-review-detail__menu-item"
                    disabled={busy}
                    onClick={() => {
                      setMoreMenuOpen(false);
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
                      handleDeleteHomework();
                    }}
                  >
                    Удалить ДЗ
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {isPending && !awaitingSubmission ? (
          <>
            <button
              type="button"
              className="cb-review-detail__btn cb-review-detail__btn--ghost"
              disabled={busy}
              onClick={handleReturn}
            >
              Вернуть на доработку
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
    </CabinetPageShell>
  );
}
