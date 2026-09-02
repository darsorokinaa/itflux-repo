import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  fetchStudentAssignment,
  submitStudentAssignment,
} from "../../../utils/cabinetAuth";
import HomeworkReviewResults, {
  buildHomeworkReviewFromVariant,
  FileLinks,
} from "../../HomeworkReviewResults";
import { homeworkTeacherCommentAttachments, parseVariantApiUrl } from "../../cabinetReviewUtils";
import CabinetIcon from "../../CabinetIcons";
import {
  extraHomeworkText,
  isOpenableUrl,
  resolveTaskHref,
  visibleHomeworkResourceTasks,
} from "../../homeworkTaskDisplay";
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
  if (task.task_type === "interactive" && (task.interactive_assignment_id || task.interactive_id)) {
    return {
      href: `/cabinet/student/interactives/${task.interactive_assignment_id || task.interactive_id}/play`,
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [item, setItem] = useState(null);
  const [answer, setAnswer] = useState("");
  const [attachedFiles, setAttachedFiles] = useState([]);
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
          setAttachedFiles([]);
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
    setAttachedFiles([]);
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

  useEffect(() => {
    if (!isChecked) return undefined;
    if (searchParams.get("focus") !== "results") return undefined;
    const timer = window.setTimeout(scrollToResults, 80);
    return () => window.clearTimeout(timer);
  }, [isChecked, homeworkReview, item, searchParams]);

  const answerSummary = useMemo(() => {
    if (!item) return "";
    if (variantSubmitted) return "вариант отправлен";
    if (item.answer_text?.trim() || item.attached_file_url || (item.attached_files || []).length) return "отправлен";
    if (["submitted", "checked"].includes(item.status)) return "отправлен";
    return "не отправлен";
  }, [item, variantSubmitted]);

  const handleSubmit = async () => {
    if (missingAttachment && !attachedFiles.length) {
      setValidationMsg("Прикрепите файлы ответа, затем нажмите «Дослать файлы».");
      return;
    }
    if (!answer.trim() && !attachedFiles.length) {
      setValidationMsg("Сначала напишите ответ или нажмите «Прикрепить файлы» и выберите файлы.");
      return;
    }
    setSubmitting(true);
    setMsg("");
    setValidationMsg("");
    try {
      const hadFile = attachedFiles.length > 0;
      const formData = new FormData();
      formData.append("answer_text", answer || "");
      attachedFiles.forEach((file) => {
        formData.append("attached_file", file, file.name || "file");
      });
      const result = await submitStudentAssignment(id, formData);
      setMsg("Ответ отправлен");
      setIsDirty(false);
      isDirtyRef.current = false;
      setAttachedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadAssignment({ preserveLocal: false });
      const savedCount = Array.isArray(result?.attached_files) ? result.attached_files.length : 0;
      const fileFailed = hadFile && result && savedCount === 0 && !result.attached_file_url && !result.attached_file_name;
      setFileUploadFailed(fileFailed);
      if (fileFailed) {
        setMsg("Ответ отправлен, но файлы могли не сохраниться. Проверьте вложения или отправьте ещё раз.");
      }
    } catch (e) {
      setMsg(e.message || "Ошибка");
    } finally {
      setSubmitting(false);
    }
  };

  const savedAttachedFiles = item?.attached_files?.length
    ? item.attached_files
    : item?.attached_file_url
      ? [{ id: "main", name: item.attached_file_name || "Прикреплённый файл", url: item.attached_file_url }]
      : [];

  const addAttachedFiles = (fileList) => {
    const next = Array.from(fileList || []);
    if (!next.length) return;
    setAttachedFiles((prev) => {
      const merged = [...prev];
      next.forEach((file) => {
        const exists = merged.some(
          (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified,
        );
        if (!exists) merged.push(file);
      });
      return merged.slice(0, 20);
    });
    setIsDirty(true);
    isDirtyRef.current = true;
    if (validationMsg) setValidationMsg("");
    setMsg("");
  };

  const clearAttachedFile = (index) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    setIsDirty(true);
    isDirtyRef.current = true;
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
  const briefText = extraHomeworkText(item.tasks, item.description) || defaultBrief;
  const materialTasks = visibleHomeworkResourceTasks(item.tasks, {
    description: item.description,
    attachments: item.attachments,
  });
  const materialsCount = (item.attachments || []).length + materialTasks.length;
  const manualStats = item?.result?.manual_stats || null;
  const commentFiles = homeworkTeacherCommentAttachments(item?.result);
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
      ? "Добавьте текст или файлы, затем отправьте работу преподавателю."
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
        {canEditAnswer ? (
          <div className="st-hw-top-actions">
            <button
              type="button"
              className="st-hw-btn st-hw-btn--primary"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? "Отправка…"
                : missingAttachment
                  ? "Дослать файлы"
                  : "Отправить ответ"}
            </button>
          </div>
        ) : isChecked ? (
          <div className="st-hw-top-actions">
            <button
              type="button"
              className="st-hw-btn st-hw-btn--primary"
              onClick={scrollToResults}
            >
              Результаты
            </button>
          </div>
        ) : !variantOnly ? (
          <div className="st-hw-top-actions">
            <button type="button" className="st-hw-btn st-hw-btn--primary" disabled>
              Отправлено
            </button>
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

          {isChecked ? (
            <div id={STUDENT_HW_RESULTS_ID} className="st-hw-results-anchor">
              {hasVariant && item.result && !homeworkReview ? (
                <section className="st-hw-card">
                  <p className="st-hw-card__text">Загрузка результатов…</p>
                </section>
              ) : null}

              {homeworkReview ? (
                <HomeworkReviewResults
                  review={homeworkReview}
                  teacherComment={item.teacher_comment}
                  className="st-hw-review"
                />
              ) : null}

              {!hasVariant ? (
                <section className="st-hw-card st-hw-card--result">
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
                  {item.teacher_comment?.trim() || commentFiles.length ? (
                    <div className="st-hw-teacher-comment">
                      <span className="st-hw-teacher-comment__label">Комментарий учителя</span>
                      {item.teacher_comment?.trim() ? <p>{item.teacher_comment}</p> : null}
                      <FileLinks files={commentFiles} />
                    </div>
                  ) : (
                    <p className="st-hw-empty">Комментарий пока не добавлен</p>
                  )}
                </section>
              ) : null}
            </div>
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
                        <label className={`st-hw-btn st-hw-btn--small${attachedFiles.length ? " is-selected" : ""}`}>
                          <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="st-hw-file-input"
                            onChange={(e) => {
                              addAttachedFiles(e.target.files);
                              e.target.value = "";
                            }}
                          />
                          {attachedFiles.length ? "Добавить ещё" : "Прикрепить файлы"}
                        </label>
                        <span className="st-hw-attach-hint">
                          Можно прикрепить несколько файлов: фото, PDF или документы
                        </span>
                      </div>
                      <span className="st-hw-attach-hint">{draftHint}</span>
                    </div>
                  </div>
                  {attachedFiles.length ? (
                    <div className="st-hw-attached-files is-visible">
                      {attachedFiles.map((file, index) => (
                        <div key={`${file.name}-${file.size}-${file.lastModified}-${index}`} className="st-hw-attached-file">
                          <span>{file.name}</span>
                          <button type="button" className="st-hw-remove-file" onClick={() => clearAttachedFile(index)}>
                            Удалить
                          </button>
                        </div>
                      ))}
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
                          ? "Дослать файлы"
                          : "Отправить ответ"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="st-hw-answer-readonly">
                  {answer?.trim() || item.answer_text?.trim() || "Ответ не указан"}
                  {savedAttachedFiles.length ? (
                    <div className="st-hw-attached-files is-visible">
                      {savedAttachedFiles.map((file) => (
                        <p key={file.id || file.url} className="st-hw-file-link">
                          {file.url ? (
                            <a href={file.url} target="_blank" rel="noreferrer">
                              {file.name || "Прикреплённый файл"}
                            </a>
                          ) : (
                            <span>{file.name || "Прикреплённый файл"}</span>
                          )}
                        </p>
                      ))}
                    </div>
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
