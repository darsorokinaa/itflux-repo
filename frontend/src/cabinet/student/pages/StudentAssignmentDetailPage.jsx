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
  StudentStatusBadge,
  formatDueDate,
} from "../StudentSectionUi";

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
    <article className={`st-hw-resource${task.is_variant ? " st-hw-resource--variant" : ""}`}>
      <div className="st-hw-resource__left">
        <span className="st-hw-resource__icon" aria-hidden="true">
          <CabinetIcon name={meta.icon} />
        </span>
        <div className="st-hw-resource__body">
          <strong className="st-hw-resource__title">{task.title}</strong>
          <span className="st-hw-resource__type">{meta.typeLabel}</span>
          {hint ? <span className="st-hw-resource__hint">{hint}</span> : null}
          {showDescription ? (
            <p className="st-hw-resource__desc">{task.description}</p>
          ) : null}
        </div>
      </div>
      {action ? (
        action.scrollToResults ? (
          <button
            type="button"
            className={`st-hw-resource__btn${action.variant ? " st-hw-resource__btn--primary" : ""}`}
            onClick={onScrollToResults}
          >
            {action.label}
          </button>
        ) : action.external ? (
          <a
            href={action.href}
            className={`st-hw-resource__btn${action.variant ? " st-hw-resource__btn--primary" : ""}`}
            target="_blank"
            rel="noreferrer"
          >
            {action.label}
          </a>
        ) : (
          <Link
            to={action.href}
            className={`st-hw-resource__btn${action.variant ? " st-hw-resource__btn--primary" : ""}`}
          >
            {action.label}
          </Link>
        )
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

function SummaryRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="st-hw-summary__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
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
  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [validationMsg, setValidationMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [variantTasks, setVariantTasks] = useState(null);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const loadAssignment = useCallback((opts = {}) => {
    const preserveLocal = opts.preserveLocal ?? isDirtyRef.current;
    setLoading(true);
    return fetchStudentAssignment(id)
      .then((d) => {
        setItem(d);
        if (!preserveLocal) {
          setAnswer(d.answer_text || "");
          setAttachedFile(null);
          setIsDirty(false);
        }
      })
      .catch(() => {
        if (!preserveLocal) setItem(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setIsDirty(false);
    isDirtyRef.current = false;
    loadAssignment({ preserveLocal: false });
  }, [id, loadAssignment]);

  useEffect(() => {
    const onFocus = () => { loadAssignment({ preserveLocal: true }); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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

  const missingAttachment =
    item?.status === "submitted"
    && !item?.attached_file_url
    && !item?.attached_file_name;
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
      if (hadFile && result && !result.attached_file_url && !result.attached_file_name) {
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

  return (
    <StudentPageShell className="st-hw-page">
      <header className="st-hw-header">
        <button
          type="button"
          className="st-hw-back"
          onClick={() => navigate("/cabinet/student/assignments")}
        >
          <CabinetIcon name="arrowLeft" />
          Назад
        </button>

        <div className="st-hw-header__main">
          <div className="st-hw-header__title-row">
            <h1 className="st-hw-header__title">{item.title}</h1>
            {badge ? <StudentStatusBadge status={badge.status} label={badge.label} /> : null}
          </div>
          <p className="st-hw-header__type">{item.type_label || "Домашнее задание"}</p>
          {dueLabel ? (
            <p className="st-hw-header__due">
              <CabinetIcon name="clock" />
              Срок: {dueLabel}
            </p>
          ) : null}
        </div>
      </header>

      <div className="st-hw-layout">
        <div className="st-hw-main">
          <section className="st-hw-card">
            <h2 className="st-hw-card__title">Что нужно сделать</h2>
            <p className="st-hw-card__text">{briefText}</p>
          </section>

          <section className="st-hw-card">
            <h2 className="st-hw-card__title">Задания и материалы</h2>
            {taskCount > 0 ? (
              <div className="st-hw-resources">
                {item.tasks.map((task) => (
                  <AssignmentResourceCard
                    key={task.id}
                    task={task}
                    isChecked={isChecked}
                    hasResultsBlock={isChecked && Boolean(item.result)}
                    onScrollToResults={scrollToResults}
                  />
                ))}
              </div>
            ) : (
              <p className="st-hw-empty">Материалы не прикреплены</p>
            )}
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

          {isChecked && item.result ? (
            <div id={STUDENT_HW_RESULTS_ID} className="st-hw-results-anchor">
              {homeworkReview ? (
                <HomeworkReviewResults
                  review={homeworkReview}
                  teacherComment={item.teacher_comment}
                  className="st-hw-review"
                />
              ) : (
                <section className="st-hw-card">
                  <p className="st-hw-card__text">Загрузка результатов…</p>
                </section>
              )}
            </div>
          ) : null}

          {!variantOnly ? (
            <section className="st-hw-card st-hw-card--answer">
              <h2 className="st-hw-card__title">Ваш ответ</h2>
              {canEditAnswer ? (
                <>
                  {missingAttachment ? (
                    <div className="st-hw-answer-readonly">
                      {answer?.trim() || item.answer_text?.trim() || "Ответ без файла"}
                    </div>
                  ) : (
                    <textarea
                      className="st-hw-textarea"
                      value={answer}
                      onChange={(e) => {
                        setAnswer(e.target.value);
                        setIsDirty(true);
                        if (validationMsg) setValidationMsg("");
                      }}
                      placeholder="Напишите ответ или комментарий к выполненному заданию"
                    />
                  )}
                  <div className="st-hw-file-row">
                    <label className={`st-hw-file-btn${attachedFile ? " st-hw-file-btn--selected" : ""}`}>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="st-hw-file-input"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.rtf,.csv,.png,.jpg,.jpeg,.gif,.webp,.zip,.rar,.7z,.py,.js,.html,.css,.heic,.heif"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          setAttachedFile(file);
                          setIsDirty(Boolean(file) || isDirtyRef.current);
                          if (validationMsg) setValidationMsg("");
                          if (file) setMsg("");
                        }}
                      />
                      <CabinetIcon name="folder" />
                      {attachedFile ? "Файл выбран" : "Прикрепить файл"}
                    </label>
                    <span
                      className={`st-hw-file-name${attachedFile ? " st-hw-file-name--selected" : ""}`}
                      title={attachedFile?.name || undefined}
                    >
                      {attachedFile?.name
                        || item.attached_file_name
                        || (missingAttachment
                          ? "Файл ещё не прикреплён — добавьте его"
                          : "Можно добавить текст или файл")}
                    </span>
                    {attachedFile ? (
                      <button
                        type="button"
                        className="st-hw-file-btn st-hw-file-btn--remove"
                        onClick={clearAttachedFile}
                      >
                        Убрать файл
                      </button>
                    ) : null}
                  </div>
                  {validationMsg ? (
                    <p className="st-hw-validation" role="alert">{validationMsg}</p>
                  ) : null}
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

          {(isChecked || item.result_percent != null) ? (
            <section className="st-hw-card st-hw-card--result">
              <h2 className="st-hw-card__title">Результат</h2>
              {item.result_percent != null ? (
                <p className="st-hw-result-score">{Math.round(item.result_percent)}%</p>
              ) : null}
              {item.teacher_comment && !homeworkReview ? (
                <div className="st-hw-teacher-comment">
                  <span className="st-hw-teacher-comment__label">Комментарий учителя</span>
                  <p>{item.teacher_comment}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          {!variantOnly ? (
            <div className="st-hw-submit st-hw-submit--desktop">
              {canEditAnswer ? (
                <button
                  type="button"
                  className="st-hw-submit__btn"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting
                    ? "Отправка…"
                    : missingAttachment
                      ? "Дослать файл"
                      : "Сдать задание"}
                </button>
              ) : (
                <button type="button" className="st-hw-submit__btn st-hw-submit__btn--sent" disabled>
                  {isChecked ? "Задание проверено" : "Ответ отправлен"}
                </button>
              )}
            </div>
          ) : null}
        </div>

        <aside className="st-hw-summary">
          <div className="st-hw-summary__card">
            <h2 className="st-hw-summary__title">Сводка</h2>
            <dl className="st-hw-summary__list">
              <SummaryRow label="Статус" value={badge?.label} />
              <SummaryRow label="Срок" value={dueLabel || null} />
              <SummaryRow label="Урок" value={item.topic || null} />
              <SummaryRow label="Материалы" value={taskCount ? String(taskCount) : "0"} />
              <SummaryRow label="Ответ" value={answerSummary} />
              {isChecked && item.result_percent != null ? (
                <SummaryRow
                  label="Результат"
                  value={`${Math.round(item.result_percent)}%`}
                />
              ) : null}
            </dl>
            {isChecked && item.teacher_comment ? (
              <div className="st-hw-summary__comment">
                <span>Комментарий учителя</span>
                <p>{item.teacher_comment}</p>
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      {!variantOnly ? (
        <div className="st-hw-submit st-hw-submit--mobile">
          {canEditAnswer ? (
            <button
              type="button"
              className="st-hw-submit__btn"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? "Отправка…"
                : missingAttachment
                  ? "Дослать файл"
                  : "Сдать задание"}
            </button>
          ) : (
            <button type="button" className="st-hw-submit__btn st-hw-submit__btn--sent" disabled>
              {isChecked ? "Задание проверено" : "Ответ отправлен"}
            </button>
          )}
        </div>
      ) : null}

      {msg ? <p className="st-toast" role="status">{msg}</p> : null}
    </StudentPageShell>
  );
}
