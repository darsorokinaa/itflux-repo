import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  fetchStudentAssignment,
  submitStudentAssignment,
} from "../../../utils/cabinetAuth";
import HomeworkReviewResults, { buildHomeworkReviewFromVariant } from "../../HomeworkReviewResults";
import { parseVariantApiUrl } from "../../cabinetReviewUtils";
import CabinetIcon from "../../CabinetIcons";
import {
  StudentPageShell,
  formatDueDate,
} from "../StudentSectionUi";
import { usePageTitle } from "../../hooks/usePageTitle";

const TASK_TYPE_META = {
  text: { icon: "note", typeLabel: "Текст" },
  file: { icon: "folder", typeLabel: "Файл" },
  external_link: { icon: "export", typeLabel: "Ссылка" },
  interactive: { icon: "interactives", typeLabel: "Интерактив" },
  generated_task: { icon: "tasks", typeLabel: "Набор задач" },
};

function isHttpUrl(value) {
  return /^https?:\/\//i.test((value || "").trim());
}

function isOpenableUrl(value) {
  const text = (value || "").trim();
  if (!text) return false;
  return isHttpUrl(text) || text.startsWith("/");
}

function resolveTaskHref(task) {
  return [task.open_url, task.file_url, task.description].find(isOpenableUrl) || "";
}

function isInternalVariantHref(href) {
  return (href || "").startsWith("/") && /\/variant\/\d+/i.test(href);
}

function looksLikePdf(title) {
  return /\.pdf$/i.test((title || "").trim());
}

function getBadgeProps(status, statusLabel, variantSubmitted) {
  if (status === "checked") {
    return { status: "checked", label: statusLabel || "Проверено" };
  }
  // variantSubmitted = реальная сдача (submitted_at), не черновик ответов.
  if (status === "submitted" || variantSubmitted) {
    return { status: "reviewing", label: "На проверке" };
  }
  if (status === "new") return { status: "new", label: "Новое" };
  return { status, label: statusLabel };
}

function getTaskMeta(task) {
  const base = TASK_TYPE_META[task.task_type] || TASK_TYPE_META.text;
  let typeLabel = base.typeLabel;
  if (task.is_variant || task.task_type === "generated_task") {
    typeLabel = "Набор задач";
  } else if (looksLikePdf(task.title)) {
    typeLabel = "Презентация / PDF";
  }
  return { ...base, typeLabel };
}

function getTaskAction(task, isChecked, hasResultsBlock) {
  if (task.is_variant && isChecked && hasResultsBlock) {
    return {
      scrollToResults: true,
      label: "Посмотреть результаты",
      variant: true,
    };
  }
  const href = resolveTaskHref(task);
  if (href) {
    return {
      href,
      label: task.is_variant
        ? "Решить"
        : (task.task_type === "file" ? "Скачать" : "Открыть"),
      external: !isInternalVariantHref(href),
      variant: task.is_variant || isInternalVariantHref(href),
    };
  }
  if (task.task_type === "interactive" && task.interactive_id) {
    return {
      href: `/cabinet/student/interactives/${task.interactive_id}/play`,
      label: "Открыть",
      external: false,
    };
  }
  return null;
}

function AssignmentResourceCard({ task, isChecked, hasResultsBlock, onScrollToResults }) {
  const meta = getTaskMeta(task);
  const action = getTaskAction(task, isChecked, hasResultsBlock);
  const hint = action?.scrollToResults
    ? "Прокрутка к результатам на этой странице"
    : task.is_variant || action?.variant
      ? "Ответы отправятся учителю после сдачи варианта"
      : action?.external
        ? "Открывается в новой вкладке"
        : null;
  const showDescription = task.description
    && !isOpenableUrl(task.description)
    && !task.is_variant
    && task.task_type === "text";

  return (
    <article className={`st-hw-material${task.is_variant ? " st-hw-material--variant" : ""}`}>
      <div className="st-hw-material__icon" aria-hidden="true">
        <CabinetIcon name={meta.icon} />
      </div>
      <div className="st-hw-material__main">
        <div className="st-hw-material__name" title={task.title}>{task.title}</div>
        <div className="st-hw-material__meta">
          <span>{meta.typeLabel}</span>
          {hint ? <span>{hint}</span> : null}
        </div>
        {showDescription ? (
          <p className="st-hw-material__desc">{task.description}</p>
        ) : null}
      </div>
      {action ? (
        <div className="st-hw-material__action">
          {action.scrollToResults ? (
            <button
              type="button"
              className={`st-hw-btn st-hw-btn--small${action.variant ? " st-hw-btn--primary" : ""}`}
              onClick={onScrollToResults}
            >
              {action.label}
            </button>
          ) : action.external ? (
            <a
              href={action.href}
              className={`st-hw-btn st-hw-btn--small${action.variant ? " st-hw-btn--primary" : ""}`}
              target="_blank"
              rel="noreferrer"
            >
              {action.label}
            </a>
          ) : (
            <Link
              to={action.href}
              className={`st-hw-btn st-hw-btn--small${action.variant ? " st-hw-btn--primary" : ""}`}
            >
              {action.label}
            </Link>
          )}
        </div>
      ) : null}
    </article>
  );
}

function parseVariantMeta(openUrl) {
  const text = String(openUrl || "").trim();
  if (!text) return null;
  try {
    const u = new URL(text, typeof window !== "undefined" ? window.location.origin : "http://localhost/");
    const m = u.pathname.match(/\/(oge|ege|vpr)\/([^/]+)\/variant\/(\d+)/i);
    if (!m) return null;
    return { level: m[1], subject: m[2] };
  } catch {
    return null;
  }
}

function SummaryRow({ label, value, emphasize }) {
  if (value == null || value === "") return null;
  return (
    <div className="st-hw-summary__row">
      <dt>{label}</dt>
      <dd className={emphasize ? "st-hw-summary__status" : undefined}>{value}</dd>
    </div>
  );
}

const STUDENT_HW_RESULTS_ID = "st-hw-results";

export default function StudentAssignmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [item, setItem] = useState(null);
  const [answer, setAnswer] = useState("");
  const [attachedFile, setAttachedFile] = useState(null);
  const [fileUploadFailed, setFileUploadFailed] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [validationMsg, setValidationMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [variantTasks, setVariantTasks] = useState(null);
  const isDirtyRef = useRef(false);
  usePageTitle(item?.title || "Домашнее задание");

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const loadAssignment = useCallback((opts = {}) => {
    const preserveLocal = opts.preserveLocal ?? isDirtyRef.current;
    const silent = Boolean(opts.silent ?? preserveLocal);
    if (!silent) setLoading(true);
    return fetchStudentAssignment(id)
      .then((d) => {
        setItem(d);
        if (!preserveLocal) {
          setAnswer(d.answer_text || "");
          setAttachedFile(null);
          setIsDirty(false);
          setFileUploadFailed(false);
        }
      })
      .catch(() => {
        if (!preserveLocal) setItem(null);
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    setIsDirty(false);
    isDirtyRef.current = false;
    setAttachedFile(null);
    setFileUploadFailed(false);
    loadAssignment({ preserveLocal: false, silent: false });
  }, [id, loadAssignment]);

  useEffect(() => {
    // Не перезагружаем при focus после диалога выбора файла:
    // иначе input размонтируется до onChange и файл «теряется».
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (isDirtyRef.current) return;
      loadAssignment({ preserveLocal: true, silent: true });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadAssignment]);

  useEffect(() => {
    if (!item || item.status !== "checked" || !item.has_variant || !item.result) {
      setVariantTasks(null);
      return undefined;
    }
    const variantTask = (item.tasks || []).find((t) => t.is_variant);
    const apiUrl = parseVariantApiUrl(variantTask?.open_url);
    if (!apiUrl) {
      setVariantTasks(null);
      return undefined;
    }
    const ac = new AbortController();
    fetch(apiUrl, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setVariantTasks(Array.isArray(data?.tasks) ? data.tasks : null))
      .catch(() => setVariantTasks(null));
    return () => ac.abort();
  }, [item]);

  const hasVariant = Boolean(item?.has_variant);
  const variantOnly = hasVariant && !(item?.tasks || []).some(
    (task) => !task.is_variant && task.task_type !== "interactive",
  );
  const variantSubmitted = Boolean(item?.variant_submitted);

  const badge = useMemo(
    () => (item ? getBadgeProps(item.status, item.status_label, variantSubmitted) : null),
    [item, variantSubmitted],
  );

  const missingAttachment = fileUploadFailed && item?.status === "submitted";
  const canEditAnswer =
    item
    && !variantOnly
    && item.status !== "checked"
    && (item.status !== "submitted" || missingAttachment);
  const isChecked = item?.status === "checked";
  const dueLabel = item?.due_at ? formatDueDate(item.due_at) : "";
  const taskCount = item?.tasks?.length || 0;
  const homeworkReview = useMemo(() => {
    if (!isChecked || !item?.result || !variantTasks?.length) return null;
    const variantTask = (item.tasks || []).find((t) => t.is_variant);
    const meta = parseVariantMeta(variantTask?.open_url);
    if (!meta) return null;
    return buildHomeworkReviewFromVariant(
      variantTasks,
      item.result,
      meta.level,
      meta.subject
    );
  }, [isChecked, item, variantTasks]);

  const scrollToResults = () => {
    document.getElementById(STUDENT_HW_RESULTS_ID)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const answerSummary = useMemo(() => {
    if (!item) return "";
    if (variantSubmitted) return "вариант отправлен";
    if (item.answer_text?.trim() || item.attached_file_url) return "отправлен";
    if (["submitted", "checked"].includes(item.status)) return "отправлен";
    return "не отправлен";
  }, [item, variantSubmitted]);

  const handleSubmit = async () => {
    if (missingAttachment && !attachedFile) {
      setValidationMsg("Прикрепите файл ответа, затем нажмите «Дослать файл».");
      return;
    }
    if (!answer.trim() && !attachedFile) {
      setValidationMsg("Сначала напишите ответ или нажмите «Прикрепить файл» и выберите файл.");
      return;
    }
    setSubmitting(true);
    setMsg("");
    setValidationMsg("");
    try {
      const hadFile = Boolean(attachedFile);
      const formData = new FormData();
      formData.append("answer_text", answer || "");
      if (attachedFile) {
        formData.append("attached_file", attachedFile, attachedFile.name || "file");
      }
      const result = await submitStudentAssignment(id, formData);
      setMsg("Ответ отправлен");
      setIsDirty(false);
      isDirtyRef.current = false;
      setAttachedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadAssignment({ preserveLocal: false });
      const fileFailed = hadFile && result && !result.attached_file_url && !result.attached_file_name;
      setFileUploadFailed(fileFailed);
      if (fileFailed) {
        setMsg("Ответ отправлен, но файл мог не сохраниться. Проверьте вложение или отправьте ещё раз.");
      }
    } catch (e) {
      setMsg(e.message || "Ошибка");
    } finally {
      setSubmitting(false);
    }
  };

  const clearAttachedFile = () => {
    setAttachedFile(null);
    setIsDirty(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (validationMsg) setValidationMsg("");
  };

  if (loading) {
    return (
      <StudentPageShell>
        <div className="st-loading">Загрузка…</div>
      </StudentPageShell>
    );
  }

  if (!item) {
    return (
      <StudentPageShell>
        <p className="st-panel__empty">Задание не найдено</p>
      </StudentPageShell>
    );
  }

  const defaultBrief = hasVariant
    ? "Откройте вариант, решите задания и отправьте работу на проверку."
    : "Откройте материалы, выполните задание и отправьте ответ.";
  const briefText = item.description?.trim() || defaultBrief;
  const materialTasks = (item.tasks || []).filter((task) => {
    if (task.is_variant || task.task_type === "generated_task" || task.task_type === "interactive") {
      return true;
    }
    if (resolveTaskHref(task) || task.task_type === "file") return true;
    if (task.task_type === "text") {
      const desc = (task.description || "").trim();
      return desc && desc !== briefText;
    }
    return Boolean(task.title);
  });
  const materialsCount = materialTasks.length || taskCount;
  const manualStats = item?.result?.manual_stats || null;
  const draftHint = isDirty
    ? "Есть несохранённые изменения"
    : canEditAnswer
      ? "Черновик не сохранён"
      : isChecked
        ? "Работа проверена"
        : "Ответ отправлен";
  const summaryNote = isChecked
    ? (item.teacher_comment?.trim()
      ? item.teacher_comment
      : "Учитель проверил работу. Результаты — в блоке ниже.")
    : canEditAnswer
      ? "Добавьте текст или файл, затем отправьте работу преподавателю."
      : "Ответ отправлен преподавателю. Результаты появятся после проверки.";

  return (
    <StudentPageShell className="st-hw-page st-hw-page--redesign">
      <button
        type="button"
        className="st-hw-back"
        onClick={() => navigate("/cabinet/student/assignments")}
      >
        <CabinetIcon name="arrowLeft" />
        Назад
      </button>

      <header className="st-hw-topbar">
        <div className="st-hw-topbar__title">
          <h1>{item.title || "Домашнее задание"}</h1>
          <p className="st-hw-topbar__subtitle">{item.type_label || "Домашнее задание"}</p>
          <div className="st-hw-meta-row" aria-label="Сведения о задании">
            {badge ? (
              <span className="st-hw-status-pill">
                <span aria-hidden="true">●</span>
                {badge.label}
              </span>
            ) : null}
            {dueLabel ? (
              <span className="st-hw-meta-pill">
                <CabinetIcon name="clock" />
                Срок: {dueLabel}
              </span>
            ) : null}
            <span className="st-hw-meta-pill">
              <CabinetIcon name="folder" />
              {materialsCount} {materialsCount === 1 ? "материал" : "материалов"}
            </span>
          </div>
        </div>
        {!variantOnly ? (
          <div className="st-hw-top-actions">
            {canEditAnswer ? (
              <button
                type="button"
                className="st-hw-btn st-hw-btn--primary"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting
                  ? "Отправка…"
                  : missingAttachment
                    ? "Дослать файл"
                    : "Отправить ответ"}
              </button>
            ) : (
              <button type="button" className="st-hw-btn st-hw-btn--primary" disabled>
                {isChecked ? "Проверено" : "Отправлено"}
              </button>
            )}
          </div>
        ) : null}
      </header>

      <div className="st-hw-layout">
        <div className="st-hw-main">
          <section className="st-hw-card st-hw-card--task">
            <div className="st-hw-section-head">
              <div>
                <h2 className="st-hw-card__title">Что нужно сделать</h2>
                <p className="st-hw-section-desc">Инструкция преподавателя</p>
              </div>
            </div>
            <div className="st-hw-task-text-wrap">
              <p className="st-hw-task-text">{briefText}</p>
            </div>
          </section>

          <section className="st-hw-card">
            <div className="st-hw-section-head">
              <div>
                <h2 className="st-hw-card__title">Материалы</h2>
                <p className="st-hw-section-desc">
                  Откройте материалы, необходимые для выполнения задания
                </p>
              </div>
            </div>
            {(item.attachments || []).length > 0 ? (
              <ul className="st-hw-attachments">
                {(item.attachments || []).map((file) => {
                  const isImage = Boolean(file.is_image || String(file.mime_type || "").startsWith("image/"));
                  const href = file.url || file.preview_url || "";
                  return (
                    <li key={file.id || file.url} className="st-hw-attachments__item">
                      {isImage && (file.preview_url || href) ? (
                        <a className="st-hw-attachments__thumb" href={href} target="_blank" rel="noreferrer">
                          <img src={file.preview_url || href} alt={file.name || "Файл"} />
                        </a>
                      ) : (
                        <span className="st-hw-attachments__icon" aria-hidden="true">
                          <CabinetIcon name="file" />
                        </span>
                      )}
                      <span className="st-hw-attachments__meta">
                        <span className="st-hw-attachments__name">{file.name || file.original_name || "Файл"}</span>
                        <span className="st-hw-attachments__sub">
                          {[file.extension, file.size ? `${Math.round(file.size / 1024)} КБ` : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      {href ? (
                        <a className="st-hw-btn st-hw-btn--outline" href={href} target="_blank" rel="noreferrer">
                          Открыть
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {materialTasks.length > 0 ? (
              <div className="st-hw-materials">
                {materialTasks.map((task) => (
                  <AssignmentResourceCard
                    key={task.id}
                    task={task}
                    isChecked={isChecked}
                    hasResultsBlock={isChecked && Boolean(item.result)}
                    onScrollToResults={scrollToResults}
                  />
                ))}
              </div>
            ) : (item.attachments || []).length === 0 ? (
              <p className="st-hw-empty">Материалы не прикреплены</p>
            ) : null}
          </section>

          {variantOnly ? (
            <section className="st-hw-card st-hw-card--variant-info">
              <h2 className="st-hw-card__title">Решение варианта</h2>
              <p className="st-hw-card__text">
                {isChecked
                  ? "Работа проверена. Ниже — баллы, комментарии и результаты по заданиям."
                  : variantSubmitted
                    ? "Вариант отправлен на проверку. Результаты появятся после проверки учителем."
                    : "Нажмите «Решить», выполните задания и на странице варианта нажмите «Отправить работу»."}
              </p>
            </section>
          ) : null}

          {isChecked && hasVariant && item.result && !homeworkReview ? (
            <section className="st-hw-card">
              <p className="st-hw-card__text">Загрузка результатов…</p>
            </section>
          ) : null}

          {isChecked && homeworkReview ? (
            <div id={STUDENT_HW_RESULTS_ID} className="st-hw-results-anchor">
              <HomeworkReviewResults
                review={homeworkReview}
                teacherComment={item.teacher_comment}
                className="st-hw-review"
              />
            </div>
          ) : null}

          {isChecked && !hasVariant ? (
            <section id={STUDENT_HW_RESULTS_ID} className="st-hw-card st-hw-card--result">
              <div className="st-hw-section-head">
                <div>
                  <h2 className="st-hw-card__title">Результаты</h2>
                  <p className="st-hw-section-desc">Оценка и комментарий преподавателя</p>
                </div>
              </div>
              {item.result_percent != null ? (
                <p className="st-hw-result-score">{Math.round(item.result_percent)}%</p>
              ) : null}
              {manualStats ? (
                <div className="st-hw-manual-stats">
                  <div><span>Всего</span><strong>{manualStats.total ?? "—"}</strong></div>
                  <div><span>Правильно</span><strong>{manualStats.correct ?? "—"}</strong></div>
                  <div><span>Неправильно</span><strong>{manualStats.incorrect ?? "—"}</strong></div>
                  <div><span>Не решено</span><strong>{manualStats.unsolved ?? "—"}</strong></div>
                </div>
              ) : null}
              {item.teacher_comment?.trim() ? (
                <div className="st-hw-teacher-comment">
                  <span className="st-hw-teacher-comment__label">Комментарий учителя</span>
                  <p>{item.teacher_comment}</p>
                </div>
              ) : (
                <p className="st-hw-empty">Комментарий пока не добавлен</p>
              )}
            </section>
          ) : null}

          {!variantOnly ? (
            <section className="st-hw-card st-hw-card--answer" id="answerSection">
              <div className="st-hw-section-head">
                <div>
                  <h2 className="st-hw-card__title">Ваш ответ</h2>
                  <p className="st-hw-section-desc">
                    Напишите комментарий или прикрепите выполненное задание
                  </p>
                </div>
              </div>

              {canEditAnswer ? (
                <>
                  <div className="st-hw-answer-box">
                    {missingAttachment ? (
                      <div className="st-hw-answer-readonly st-hw-answer-readonly--in-box">
                        {answer?.trim() || item.answer_text?.trim() || "Ответ без файла"}
                      </div>
                    ) : (
                      <textarea
                        className="st-hw-textarea"
                        value={answer}
                        onChange={(e) => {
                          setAnswer(e.target.value);
                          setIsDirty(true);
                          isDirtyRef.current = true;
                          if (validationMsg) setValidationMsg("");
                          if (msg) setMsg("");
                        }}
                        placeholder="Напишите ответ или комментарий к выполненному заданию"
                        aria-label="Текст ответа"
                      />
                    )}
                    <div className="st-hw-attachment-area">
                      <div className="st-hw-attach-left">
                        <label className={`st-hw-btn st-hw-btn--small${attachedFile ? " is-selected" : ""}`}>
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="st-hw-file-input"
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              setAttachedFile(file);
                              setIsDirty(true);
                              isDirtyRef.current = true;
                              if (validationMsg) setValidationMsg("");
                              if (file) setMsg("");
                            }}
                          />
                          {attachedFile ? "Файл выбран" : "Прикрепить файл"}
                        </label>
                        <span className="st-hw-attach-hint">
                          Можно добавить текст, фотографию или документ
                        </span>
                      </div>
                      <span className="st-hw-attach-hint">{draftHint}</span>
                    </div>
                  </div>
                  {attachedFile || item.attached_file_name ? (
                    <div className="st-hw-attached-files is-visible">
                      <div className="st-hw-attached-file">
                        <span>{attachedFile?.name || item.attached_file_name}</span>
                        {attachedFile ? (
                          <button type="button" className="st-hw-remove-file" onClick={clearAttachedFile}>
                            Удалить
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {validationMsg ? (
                    <p className="st-hw-validation is-visible" role="alert">{validationMsg}</p>
                  ) : null}
                  {msg ? (
                    <div className="st-hw-success is-visible" role="status">{msg}</div>
                  ) : null}
                  <div className="st-hw-answer-actions">
                    <button
                      type="button"
                      className="st-hw-btn st-hw-btn--primary st-hw-btn--mobile-send"
                      onClick={handleSubmit}
                      disabled={submitting}
                    >
                      {submitting
                        ? "Отправка…"
                        : missingAttachment
                          ? "Дослать файл"
                          : "Отправить ответ"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="st-hw-answer-readonly">
                  {answer?.trim() || item.answer_text?.trim() || "Ответ не указан"}
                  {item.attached_file_url ? (
                    <p className="st-hw-file-link">
                      <a href={item.attached_file_url} target="_blank" rel="noreferrer">
                        {item.attached_file_name || "Прикреплённый файл"}
                      </a>
                    </p>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}
        </div>

        <aside className="st-hw-summary" aria-label="Сводка по домашнему заданию">
          <h2 className="st-hw-summary__title">Сводка</h2>
          <dl className="st-hw-summary__list">
            <SummaryRow label="Статус" value={badge?.label} emphasize />
            <SummaryRow label="Срок" value={dueLabel || null} />
            <SummaryRow label="Материалы" value={String(materialsCount)} />
            <SummaryRow label="Ответ" value={answerSummary} />
            {isChecked && item.result_percent != null ? (
              <SummaryRow label="Результат" value={`${Math.round(item.result_percent)}%`} />
            ) : null}
          </dl>
          <p className="st-hw-summary-note">{summaryNote}</p>
        </aside>
      </div>
    </StudentPageShell>
  );
}
