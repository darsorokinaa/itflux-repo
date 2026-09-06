import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { fetchCabinetSession } from "../utils/cabinetAuth";
import { useAccessGate } from "../hooks/useAccessGate";
import { trackGoal } from "../utils/analytics";
import {
  archiveMyTask,
  duplicateMyTask,
  fetchMyTasks,
  fetchMyTasksCatalog,
  mergeCatalogSubjects,
} from "../utils/teacherTaskBankApi";
import { fetchExamCatalog } from "../utils/examCatalog";
import MathContent from "../components/MathContent";
import TaskFileAttachment from "../components/TaskFileAttachment";
import TaskNoAnswerBadge from "../components/TaskNoAnswerBadge";
import "../styles/my-task-bank.css";

const STATUS_CHIPS = [
  { id: "all", label: "Все" },
  { id: "ready", label: "Готовые" },
  { id: "draft", label: "Черновики" },
  { id: "archived", label: "Архив" },
];

function statusLabel(status) {
  if (status === "draft") return "Черновик";
  if (status === "archived") return "Архив";
  return "Готово";
}

function plural(n, one, few, many) {
  const abs = Math.abs(Number(n) || 0) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}

function copyText(value) {
  const text = String(value || "");
  if (!text) return Promise.resolve(false);
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

function MetaSep() {
  return (
    <span className="all-tasks-item__meta-sep" aria-hidden>
      ·
    </span>
  );
}

function taskFiles(task) {
  const seen = new Set();
  const files = [];
  for (const att of task.attachments || []) {
    if (!att?.url || seen.has(att.url)) continue;
    seen.add(att.url);
    files.push({ url: att.url, name: att.name || "" });
  }
  if (task.file_url && !seen.has(task.file_url)) {
    files.push({ url: task.file_url, name: "" });
  }
  return files;
}

export function MyTaskBankShell({ children, className = "" }) {
  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <div className={`mtb-page all-tasks-page${className ? ` ${className}` : ""}`}>{children}</div>
      </div>
    </div>
  );
}

function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      const tag = event.target?.tagName;
      if (tag === "OPTION" || tag === "SELECT") return;
      if (ref.current && !ref.current.contains(event.target)) onClose();
    };
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

function BankMenu({ code }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  if (!code) return null;
  return (
    <div className="mtb-more mtb-more--bank" ref={ref}>
      <button
        type="button"
        className="mtb-icon-btn mtb-icon-btn--quiet"
        aria-label="Код банка"
        title="Код банка"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open ? (
        <div className="mtb-more__menu">
          <div className="mtb-more__meta">Код банка: {code}</div>
          <button
            type="button"
            onClick={async () => {
              const ok = await copyText(code);
              if (ok) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }
            }}
          >
            {copied ? "Скопировано" : "Скопировать код"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RowMenu({ task, onAction, busy }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="mtb-more" ref={ref}>
      <button
        type="button"
        className="mtb-icon-btn"
        aria-label="Ещё"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open ? (
        <div className="mtb-more__menu">
          <Link to={`/tasks/my/${task.id}`} onClick={() => setOpen(false)}>Просмотреть</Link>
          <Link to={`/tasks/my/${task.id}/edit`} onClick={() => setOpen(false)}>Редактировать</Link>
          <button type="button" onClick={() => { setOpen(false); onAction("duplicate", task); }}>Дублировать</button>
          <button
            type="button"
            onClick={async () => {
              const ok = await copyText(task.public_code);
              if (ok) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }
            }}
          >
            {copied ? "Скопировано" : "Скопировать код"}
          </button>
          {task.status === "archived" ? null : (
            <button type="button" onClick={() => { setOpen(false); onAction("archive", task); }}>Архивировать</button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TaskBankQuotaHint({ usage, onUpgrade }) {
  const used = Number(usage?.tasks || 0);
  const limit = usage?.task_limit;
  if (limit == null) return null;
  const ratio = limit > 0 ? used / limit : 0;
  const remaining = Math.max(0, limit - used);
  const over = used > limit;
  const full = used >= limit;
  let text = `${used} из ${limit}`;
  if (over) {
    text = `${used} задач · лимит тарифа ${limit}`;
  } else if (full) {
    text = `${used} из ${limit} задач`;
  } else if (ratio >= 0.9) {
    text = `Осталось ${remaining} ${remaining === 1 ? "место" : "места"} в личном банке`;
  } else if (ratio >= 0.75) {
    text = `${used} из ${limit} задач`;
  }
  return (
    <span className={`mtb-quota${full ? " mtb-quota--full" : ratio >= 0.8 ? " mtb-quota--near" : ""}`}>
      <span className="mtb-quota__text">{text}</span>
      {ratio >= 0.8 ? (
        <button type="button" className="mtb-quota__link" onClick={onUpgrade}>
          Увеличить лимит →
        </button>
      ) : null}
      {ratio >= 0.8 && !full ? (
        <span className="mtb-quota__bar" aria-hidden>
          <span className="mtb-quota__fill" style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
        </span>
      ) : null}
    </span>
  );
}

export default function MyTaskBankPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [authedTeacher, setAuthedTeacher] = useState(null);
  const [data, setData] = useState(null);
  const [catalog, setCatalog] = useState({ subjects: [], levels: [], task_numbers: [], subtopics: [], tags: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openAnswers, setOpenAnswers] = useState({});
  const approachedRef = useRef(false);

  const q = searchParams.get("q") || "";
  const status = searchParams.get("status") || "all";
  const subject = searchParams.get("subject") || "";
  const level = searchParams.get("level") || "";
  const exam = searchParams.get("exam") || "";
  const taskListId = searchParams.get("task") || "";
  const subtopicId = searchParams.get("subtopic") || "";
  const tagId = searchParams.get("tag") || "";
  const examPart = searchParams.get("exam_part") || "";
  const page = Math.max(1, Number(searchParams.get("page") || 1));

  const setParam = useCallback((key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    fetchCabinetSession()
      .then((session) => {
        const user = session?.authenticated ? session.user : null;
        setAuthedTeacher(user?.role === "teacher" ? user : false);
      })
      .catch(() => setAuthedTeacher(false));
  }, []);

  const load = useCallback(async () => {
    if (authedTeacher !== null && authedTeacher === false) return;
    setLoading(true);
    setError("");
    try {
      const payload = await fetchMyTasks({
        q,
        status,
        subject,
        level,
        exam,
        task_list_id: taskListId,
        subtopic_id: subtopicId,
        tag_id: tagId,
        exam_part: examPart,
        page,
        per_page: 20,
      });
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить банк");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [authedTeacher, q, status, subject, level, exam, taskListId, subtopicId, tagId, examPart, page]);

  useEffect(() => {
    if (authedTeacher) load();
  }, [authedTeacher, load]);

  useEffect(() => {
    if (!authedTeacher) return undefined;
    let cancelled = false;
    Promise.all([
      fetchMyTasksCatalog({ subject, level, task_list_id: taskListId }),
      fetchExamCatalog().catch(() => []),
    ])
      .then(([catalogData, examRows]) => {
        if (cancelled) return;
        const fromExam = [];
        for (const row of examRows || []) {
          for (const item of row.subjects || []) {
            fromExam.push({ id: item.id, name: item.title });
          }
        }
        setCatalog((prev) => ({
          ...catalogData,
          subjects: mergeCatalogSubjects(fromExam, catalogData?.subjects, prev.subjects),
          levels: (catalogData?.levels || []).length ? catalogData.levels : prev.levels,
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authedTeacher, subject, level, taskListId]);

  const counts = data?.counts || {};
  const tasks = data?.tasks || [];
  const usage = data?.usage || {};
  const capabilities = data?.capabilities || {};
  const bankIsEmpty = !!data && (counts.all || 0) + (counts.archived || 0) === 0;
  const { modal: accessModal, openFromError, openGate } = useAccessGate({
    authenticated: Boolean(authedTeacher),
    currentPlan: data?.plan_slug || "",
    sourcePage: "/tasks/my",
  });

  const openAuthGate = useCallback((trigger = "create") => {
    openGate({
      reason: "anonymous",
      resourceType: "teacher_tasks",
      requiredPlan: "start",
      sourcePage: trigger,
      returnUrl: "/tasks/my",
    });
  }, [openGate]);

  const openTaskLimitGate = useCallback((trigger = "create") => {
    if (!authedTeacher) {
      openAuthGate(trigger);
      return;
    }
    openGate({
      reason: "limit_reached",
      resourceType: "teacher_tasks",
      requiredPlan: "teacher",
      currentPlan: data?.plan_slug || "",
      limit: usage.task_limit,
      current: usage.tasks,
      sourcePage: trigger,
    });
  }, [openGate, openAuthGate, authedTeacher, data?.plan_slug, usage.task_limit, usage.tasks]);

  const openCreate = useCallback(() => {
    if (!authedTeacher) {
      openAuthGate("create");
      return;
    }
    if (capabilities.create_task === false) {
      openTaskLimitGate("create");
      return;
    }
    navigate("/tasks/my/new");
  }, [authedTeacher, capabilities.create_task, navigate, openAuthGate, openTaskLimitGate]);

  useEffect(() => {
    const used = Number(usage.tasks || 0);
    const limit = usage.task_limit;
    if (limit == null || limit <= 0) return;
    const ratio = used / limit;
    if (ratio >= 0.75 && ratio < 1 && !approachedRef.current) {
      approachedRef.current = true;
      trackGoal("teacher_task_limit_approached", {
        plan: data?.plan_slug || "",
        usage: used,
        limit,
        trigger: "bank",
      });
    }
  }, [usage.tasks, usage.task_limit, data?.plan_slug]);

  const addToVariant = useCallback((task) => {
    if (!task.level || !task.subject) return;
    navigate(`/tasks?level=${encodeURIComponent(task.level)}&subject=${encodeURIComponent(task.subject)}&source=all&pick=variant&add=${task.id}`);
  }, [navigate]);

  const toggleAnswer = useCallback((id) => {
    setOpenAnswers((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const onAction = async (kind, task) => {
    setBusyId(task.id);
    setError("");
    try {
      if (kind === "duplicate") {
        if (capabilities.create_task === false) {
          openTaskLimitGate("duplicate");
          return;
        }
        const copy = await duplicateMyTask(task.id);
        navigate(`/tasks/my/${copy.id}/edit`);
        return;
      }
      if (kind === "archive") {
        await archiveMyTask(task.id);
        await load();
      }
    } catch (err) {
      if (openFromError(err, { sourcePage: "duplicate" })) return;
      setError(err instanceof Error ? err.message : "Не удалось выполнить действие");
    } finally {
      setBusyId(null);
    }
  };

  if (authedTeacher === false) {
    return (
      <MyTaskBankShell>
        {accessModal}
        <div className="mtb-empty">
          <div className="mtb-empty__icon" aria-hidden>
            <FileText size={22} strokeWidth={2} />
          </div>
          <h2>Мой банк задач</h2>
          <p>Создавайте свои задания, копируйте из общего банка и используйте их в вариантах.</p>
          <button type="button" className="mtb-btn mtb-btn--primary" onClick={openCreate}>+ Создать задачу</button>
          <Link className="mtb-empty__link" to="/tasks">Найти в общем банке →</Link>
        </div>
      </MyTaskBankShell>
    );
  }

  return (
    <MyTaskBankShell>
      {accessModal}
      {error ? <p className="all-tasks-meta__error">{error}</p> : null}

      {loading && !data ? <p className="all-tasks-meta">Загрузка…</p> : null}

      {bankIsEmpty ? (
        <div className="mtb-empty">
          <div className="mtb-empty__icon" aria-hidden>
            <FileText size={22} strokeWidth={2} />
          </div>
          <h2>Пока здесь нет задач</h2>
          <p>Создайте свою первую задачу или добавьте подходящее задание из общего банка.</p>
          <button type="button" className="mtb-btn mtb-btn--primary" onClick={openCreate}>+ Создать задачу</button>
          <Link className="mtb-empty__link" to="/tasks">Найти в общем банке →</Link>
        </div>
      ) : data ? (
        <>
          <button
            type="button"
            className="all-tasks-filters-toggle"
            aria-expanded={filtersOpen}
            aria-controls="my-tasks-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <span>Фильтры</span>
            <span className="all-tasks-filters-toggle__meta">
              {STATUS_CHIPS.find((chip) => chip.id === status)?.label || "Все"}
              {subject ? ` · ${catalog.subjects.find((row) => row.id === subject)?.name || subject}` : ""}
            </span>
          </button>

          <div
            id="my-tasks-filters"
            className={`all-tasks-filters${filtersOpen ? " is-open" : ""}`}
          >
            <div className="all-tasks-filter all-tasks-filter--status">
              <span className="all-tasks-filter__label">Статус</span>
              <div className="mtb-chips" style={{ marginBottom: 0 }} role="tablist" aria-label="Статус">
                {STATUS_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    role="tab"
                    aria-selected={status === chip.id}
                    className={`mtb-chip${status === chip.id ? " is-active" : ""}`}
                    onClick={() => setParam("status", chip.id === "all" ? "" : chip.id)}
                  >
                    {chip.label} {counts[chip.id] != null ? counts[chip.id] : ""}
                  </button>
                ))}
              </div>
            </div>

            <label className="all-tasks-filter all-tasks-filter--search">
              <span className="all-tasks-filter__label">Поиск</span>
              <input
                className="all-tasks-filter__control"
                type="search"
                placeholder="Поиск по моим задачам"
                defaultValue={q}
                key={q}
                aria-label="Поиск по моим задачам"
                onKeyDown={(e) => {
                  if (e.key === "Enter") setParam("q", e.currentTarget.value.trim());
                }}
                onBlur={(e) => setParam("q", e.currentTarget.value.trim())}
              />
            </label>

            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Предмет</span>
              <select
                className="all-tasks-filter__control"
                value={subject}
                onChange={(e) => setParam("subject", e.target.value)}
              >
                <option value="">Все предметы</option>
                {(catalog.subjects || []).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>

            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Экзамен</span>
              <select
                className="all-tasks-filter__control"
                value={exam}
                onChange={(e) => {
                  const next = new URLSearchParams(searchParams);
                  if (e.target.value) next.set("exam", e.target.value);
                  else next.delete("exam");
                  next.delete("level");
                  next.delete("page");
                  setSearchParams(next);
                }}
              >
                <option value="">Все</option>
                <option value="ege">ЕГЭ</option>
                <option value="oge">ОГЭ</option>
                <option value="none">без экзамена</option>
              </select>
            </label>

            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Уровень</span>
              <select
                className="all-tasks-filter__control"
                value={level}
                onChange={(e) => setParam("level", e.target.value)}
              >
                <option value="">Все</option>
                {(catalog.levels || []).map((item) => (
                  <option key={item.id} value={item.id}>{item.title}</option>
                ))}
              </select>
            </label>

            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Задание</span>
              <select
                className="all-tasks-filter__control"
                value={taskListId}
                onChange={(e) => setParam("task", e.target.value)}
              >
                <option value="">Все</option>
                {(catalog.task_numbers || []).map((item) => (
                  <option key={item.task_list_id} value={item.task_list_id}>
                    №{item.task_number}{item.task_title ? ` — ${item.task_title}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Подтема</span>
              <select
                className="all-tasks-filter__control"
                value={subtopicId}
                onChange={(e) => setParam("subtopic", e.target.value)}
              >
                <option value="">Все подтемы</option>
                {(catalog.subtopics || []).map((item) => (
                  <option key={item.id} value={item.id}>{item.title}</option>
                ))}
              </select>
            </label>

            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Часть</span>
              <select
                className="all-tasks-filter__control"
                value={examPart}
                onChange={(e) => setParam("exam_part", e.target.value)}
              >
                <option value="">Все</option>
                <option value="1">Первая</option>
                <option value="2">Вторая</option>
              </select>
            </label>

            {(catalog.tags || []).length ? (
              <label className="all-tasks-filter">
                <span className="all-tasks-filter__label">Тег</span>
                <select
                  className="all-tasks-filter__control"
                  value={tagId}
                  onChange={(e) => setParam("tag", e.target.value)}
                >
                  <option value="">Все</option>
                  {(catalog.tags || []).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="all-tasks-meta" aria-live="polite">
            <div className="all-tasks-meta__inner">
              <span className="all-tasks-meta__count">
                {loading
                  ? "Загрузка…"
                  : `${counts.all || 0} ${plural(counts.all || 0, "задача", "задачи", "задач")}`}
              </span>
              {(counts.draft || 0) > 0 ? (
                <span className="all-tasks-meta__badge">
                  {counts.draft} {plural(counts.draft, "черновик", "черновика", "черновиков")}
                </span>
              ) : null}
              {(data.used_in_variants || 0) > 0 ? (
                <span className="all-tasks-meta__sub">
                  {data.used_in_variants} использовались
                </span>
              ) : null}
              <TaskBankQuotaHint usage={usage} onUpgrade={() => openTaskLimitGate("quota")} />
              {usage.copy_limit != null && usage.copy_limit - (usage.copies_this_period || 0) === 1 ? (
                <span className="mtb-quota__soft">Осталось 1 копирование в этом месяце</span>
              ) : null}
              <div className="all-tasks-meta__actions">
                <BankMenu code={data.bank_code} />
                <button type="button" className="all-tasks-workbook-btn" onClick={openCreate}>
                  Создать задачу
                </button>
                <Link className="all-tasks-workbook-btn all-tasks-workbook-btn--variant" to="/tasks">
                  Из общего банка
                </Link>
              </div>
            </div>
          </div>

          {loading ? <p className="all-tasks-meta">Загрузка…</p> : null}

          {!loading && tasks.length === 0 ? (
            <p className="all-tasks-empty" role="status">
              По выбранным фильтрам заданий нет. Измените поиск или фильтры.
            </p>
          ) : (
            <ul className="all-tasks-list">
              {tasks.map((task) => {
                const draft = task.status === "draft";
                const archived = task.status === "archived";
                const answerHtml = String(task.answer_html || task.answer || "").trim();
                const answerOpen = !!openAnswers[task.id];
                const files = taskFiles(task);
                return (
                  <li key={task.id} className="all-tasks-list__item">
                    <article
                      className="all-tasks-item"
                      data-task-id={task.id}
                    >
                      <div className="all-tasks-item__card">
                        <div className="all-tasks-item__head">
                          <p className="all-tasks-item__meta">
                            <span className="all-tasks-item__num">№{task.local_number}</span>
                            <span className="mtb-badge mtb-badge--mine">Моя задача</span>
                            {task.public_code ? (
                              <>
                                <MetaSep />
                                <span>{task.public_code}</span>
                              </>
                            ) : null}
                            <MetaSep />
                            <span>ID {task.id}</span>
                            {task.task_title ? (
                              <>
                                <MetaSep />
                                <span>{task.task_title}</span>
                              </>
                            ) : null}
                            {task.subtopic ? (
                              <>
                                <MetaSep />
                                <span>{task.subtopic}</span>
                              </>
                            ) : null}
                            {task.status !== "ready" ? (
                              <>
                                <MetaSep />
                                <span>{statusLabel(task.status)}</span>
                              </>
                            ) : null}
                            {!answerHtml ? <TaskNoAnswerBadge /> : null}
                          </p>
                          <div className="all-tasks-item__actions">
                            {draft ? (
                              <Link
                                className="all-tasks-item__answer-btn"
                                to={`/tasks/my/${task.id}/edit`}
                              >
                                Продолжить
                              </Link>
                            ) : archived ? null : (
                              <button
                                type="button"
                                className="all-tasks-item__answer-btn"
                                disabled={busyId === task.id}
                                onClick={() => addToVariant(task)}
                              >
                                В вариант
                              </button>
                            )}
                            <RowMenu task={task} onAction={onAction} busy={busyId === task.id} />
                          </div>
                        </div>
                        <div className="all-tasks-item__content">
                          <MathContent
                            html={task.text || task.text_preview || ""}
                            className="all-tasks-item__html"
                            plainHtml
                          />
                          {files.map((file) => (
                            <TaskFileAttachment
                              key={file.url}
                              href={file.url}
                              name={file.name}
                            />
                          ))}
                          {task.author ? (
                            <div className="task-author">{task.author}</div>
                          ) : null}
                        </div>
                        {answerHtml ? (
                          <div className="all-tasks-item__answer-foot">
                            <button
                              type="button"
                              className="all-tasks-item__answer-btn"
                              onClick={() => toggleAnswer(task.id)}
                              aria-expanded={answerOpen ? "true" : "false"}
                            >
                              {answerOpen ? "Скрыть ответ" : "Посмотреть ответ"}
                            </button>
                          </div>
                        ) : null}
                        {answerOpen ? (
                          <div
                            className="all-tasks-item__answer"
                            role="region"
                            aria-live="polite"
                            aria-label="Правильный ответ"
                          >
                            <MathContent
                              html={answerHtml}
                              className="all-tasks-item__html all-tasks-item__html--answer"
                              plainHtml
                            />
                          </div>
                        ) : null}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}

          {data.total > data.per_page ? (
            <div className="all-tasks-pager">
              <button
                type="button"
                className="all-tasks-pager__btn"
                disabled={page <= 1}
                onClick={() => setParam("page", String(page - 1))}
              >
                Назад
              </button>
              <span className="all-tasks-pager__info">
                Стр. {data.page} из {Math.ceil(data.total / data.per_page)}
              </span>
              <button
                type="button"
                className="all-tasks-pager__btn"
                disabled={page * data.per_page >= data.total}
                onClick={() => setParam("page", String(page + 1))}
              >
                Дальше
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </MyTaskBankShell>
  );
}
