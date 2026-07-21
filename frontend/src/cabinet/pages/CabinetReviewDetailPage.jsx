import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import MathContent from "../../components/MathContent";
import TaskFileAttachment from "../../components/TaskFileAttachment";
import {
  CabinetPageShell,
  CabinetPageHeader,
} from "../CabinetSectionUi";
import {
  buildTeacherVariantUrl,
  computePart1TaskCorrect,
  formatReviewDate,
  homeworkTaskAnswer,
  homeworkTaskAttachments,
  homeworkTaskChecked,
  homeworkTaskComment,
  homeworkTaskScore,
  homeworkTeacherAttachments,
  inferExamTaskPart,
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
  checkReviewItem,
  deleteHomework,
  deleteReviewFeedback,
  fetchReviewItem,
  returnReviewItem,
  uploadReviewFeedback,
} from "../../utils/cabinetAuth";
import ConfirmActionModal from "../components/ConfirmActionModal";
import HomeworkReviewSummary, {
  buildHomeworkReviewFromVariant,
} from "../HomeworkReviewResults";

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
  return {
    teacherComment: review?.teacher_comment || submission?.teacher_comment || "",
    scores,
    taskComments,
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
  const [review, setReview] = useState(null);
  const [variant, setVariant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [teacherComment, setTeacherComment] = useState("");
  const [scores, setScores] = useState({});
  const [taskComments, setTaskComments] = useState({});
  const [confirmAction, setConfirmAction] = useState(null);

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
  const isReadOnly = !isPending;
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
    if (part1Tasks.length) {
      data.part1 = data.part1.map((row) => {
        const task = part1Tasks.find((t) => String(t.id) === row.taskId);
        if (!task) return row;
        const answer = homeworkTaskAnswer(result, task.id, task.number);
        const saved = homeworkTaskChecked(result, task.id);
        const verdict = saved ?? computePart1TaskCorrect(task, answer, subject);
        return { ...row, verdict };
      });
    }
    if (part2Tasks.length) {
      data.part2 = data.part2.map((row) => ({
        ...row,
        score: scores[row.taskId] ?? scores[String(row.taskId)] ?? row.score,
      }));
    }
    return data;
  }, [reviewCtx, variant, result, level, subject, part1Tasks, part2Tasks, scores]);

  const buildAutoChecked = useCallback(() => {
    const autoChecked = {};
    part1Tasks.forEach((task) => {
      const answer = homeworkTaskAnswer(result, task.id, task.number);
      const verdict = computePart1TaskCorrect(task, answer, subject);
      autoChecked[String(task.id)] = verdict === true;
    });
    return autoChecked;
  }, [part1Tasks, result, subject]);

  const buildPayload = () => ({
    teacher_comment: teacherComment.trim(),
    scores,
    checked: buildAutoChecked(),
    comments_by_task_id: taskComments,
  });

  const runCheck = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await checkReviewItem(reviewId, buildPayload());
      setReview(updated);
      navigate("/cabinet/review");
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
      onConfirm: runCheck,
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

  const getPart1Verdict = (task, answer) => {
    if (isReadOnly) {
      const saved = homeworkTaskChecked(result, task.id);
      if (saved !== null) return saved;
    }
    return computePart1TaskCorrect(task, answer, subject);
  };

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

      {homeworkReviewData ? (
        <section className="cb-review-detail__panel cb-review-detail__panel--summary">
          <HomeworkReviewSummary
            review={homeworkReviewData}
            className="hw-review-results cb-review-detail__summary"
          />
        </section>
      ) : null}

      {!reviewCtx?.has_variant ? (
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
      ) : (
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
                  const answer = homeworkTaskAnswer(result, task.id, task.number);
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
                  const answer = homeworkTaskAnswer(result, task.id, task.number);
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
      )}

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

      <div className="cb-review-detail__footer">
        <Link
          to="/cabinet/journal"
          className="cb-review-detail__btn cb-review-detail__btn--ghost"
        >
          Итоги урока
        </Link>
        {submission?.homework ? (
          <button
            type="button"
            className="cb-review-detail__btn cb-review-detail__btn--danger"
            disabled={busy}
            onClick={handleDeleteHomework}
            title="Удалить домашнее задание вместе с работой ученика"
          >
            Удалить ДЗ
          </button>
        ) : null}
        {isPending ? (
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
    </CabinetPageShell>
  );
}
