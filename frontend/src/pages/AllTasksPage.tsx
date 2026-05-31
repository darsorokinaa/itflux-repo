import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Nav from "../components/Nav";
import MathContent from "../components/MathContent";
import TaskFileAttachment from "../components/TaskFileAttachment";
import { getLevelDef, type LevelId } from "../data/levels";
import {
  GRADES_BY_LEVEL,
  SUBJECTS_BY_LEVEL,
  type SubjectDefinition,
  type SubjectId,
} from "../data/subjects";
import { formatTasksCount } from "../utils/formatTasksCount";
import {
  isOgeInformaticsPart2TaskNumber,
  isOgeInformaticsTask,
} from "../utils/isOgeInformaticsTask";

type BankTask = {
  id: number;
  task_number: number | null;
  task_title: string;
  subtopic: string | null;
  text: string;
  file_url?: string | null;
  part_id?: number | null;
  part_title?: string | null;
};

type AnswerState = {
  open: boolean;
  loading: boolean;
  html: string | null;
  error: string | null;
};

type BankResponse = {
  total: number;
  page: number;
  per_page: number;
  tasks: BankTask[];
};

type TaskNumberOption = {
  task_list_id: number;
  task_number: number;
  task_title: string;
  task_count: number;
};

type SubtopicOption = {
  id: number;
  title: string;
  task_list_id: number;
  task_number: number;
  task_count: number;
};

type FiltersResponse = {
  task_numbers: TaskNumberOption[];
  subtopics: SubtopicOption[];
};

const PER_PAGE = 5000;

const LazyVisible = memo(function LazyVisible({
  minHeight = 140,
  rootMargin = "600px 0px",
  children,
}: {
  minHeight?: number;
  rootMargin?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [visible, rootMargin]);

  return (
    <div
      ref={ref}
      className="all-tasks-lazy"
      style={visible ? undefined : { minHeight }}
    >
      {visible ? (
        children
      ) : (
        <div className="all-tasks-lazy__skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  );
});

const LEVEL_OPTIONS: ReadonlyArray<{ id: LevelId; label: string }> = [
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
  { id: "vpr", label: "Школьная база (ВПР)" },
];

function buildQuery(
  level: LevelId,
  vprGrade: number,
  extra?: Record<string, string | undefined>
): string {
  const p = new URLSearchParams();
  if (level === "vpr") p.set("grade", String(vprGrade));
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
    }
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default function AllTasksPage() {
  const [level, setLevel] = useState<LevelId>("oge");
  const [subject, setSubject] = useState<SubjectId>("inf");
  const [onlyFipi, setOnlyFipi] = useState(false);
  const [vprGrade, setVprGrade] = useState<number>(() => GRADES_BY_LEVEL.vpr[0] ?? 7);
  const [taskListId, setTaskListId] = useState("");
  const [subtopicId, setSubtopicId] = useState("");
  const [page, setPage] = useState(1);

  const [filterOptions, setFilterOptions] = useState<FiltersResponse | null>(null);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [data, setData] = useState<BankResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});

  useEffect(() => {
    setAnswers({});
  }, [level, subject, vprGrade, taskListId, subtopicId, onlyFipi, page]);

  const toggleAnswer = useCallback(async (taskId: number) => {
    const current = answers[taskId];
    if (current?.html != null) {
      setAnswers((prev) => ({
        ...prev,
        [taskId]: { ...prev[taskId], open: !prev[taskId].open },
      }));
      return;
    }
    if (current?.loading) return;
    setAnswers((prev) => ({
      ...prev,
      [taskId]: { open: true, loading: true, html: null, error: null },
    }));
    try {
      const res = await fetch(
        `/api/search_task/?q=${encodeURIComponent(String(taskId))}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) throw new Error(`Ошибка ${res.status}`);
      const json = await res.json();
      const t = Array.isArray(json.tasks) ? json.tasks[0] : null;
      const html: string = t?.answer || "";
      setAnswers((prev) => ({
        ...prev,
        [taskId]: {
          open: true,
          loading: false,
          html: html || "<p>Ответ не указан</p>",
          error: null,
        },
      }));
    } catch (e) {
      setAnswers((prev) => ({
        ...prev,
        [taskId]: {
          open: true,
          loading: false,
          html: null,
          error: e instanceof Error ? e.message : "Не удалось загрузить ответ",
        },
      }));
    }
  }, [answers]);

  const subjects = SUBJECTS_BY_LEVEL[level] ?? [];
  const levelDef = getLevelDef(level);

  const subtopicsForTask = useMemo(() => {
    if (!filterOptions) return [];
    if (!taskListId) return filterOptions.subtopics;
    const tlId = Number(taskListId);
    return filterOptions.subtopics.filter((s) => s.task_list_id === tlId);
  }, [filterOptions, taskListId]);

  useEffect(() => {
    const list = SUBJECTS_BY_LEVEL[level] ?? [];
    if (!list.some((s) => s.id === subject)) {
      setSubject(list[0]?.id ?? "inf");
    }
    if (level === "vpr") {
      const grades = GRADES_BY_LEVEL.vpr;
      if (grades.length && !grades.includes(vprGrade)) {
        setVprGrade(grades[0]);
      }
    }
    setTaskListId("");
    setSubtopicId("");
    setPage(1);
  }, [level, subject, vprGrade]);

  useEffect(() => {
    let cancelled = false;
    setFiltersLoading(true);
    const qs = buildQuery(level, vprGrade, {
      task_list_id: taskListId || undefined,
    });
    const url = `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/task-bank-filters/${qs}`;

    fetch(url, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: FiltersResponse) => {
        if (!cancelled) setFilterOptions(json);
      })
      .catch(() => {
        if (!cancelled) setFilterOptions(null);
      })
      .finally(() => {
        if (!cancelled) setFiltersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [level, subject, vprGrade, taskListId]);

  useEffect(() => {
    if (!subtopicId) return;
    const ok = subtopicsForTask.some((s) => String(s.id) === subtopicId);
    if (!ok) setSubtopicId("");
  }, [subtopicsForTask, subtopicId]);

  const fetchTasks = useCallback(async () => {
    if (!taskListId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const qs = buildQuery(level, vprGrade, {
      page: String(page),
      per_page: String(PER_PAGE),
      only_fipi: onlyFipi ? "1" : undefined,
      task_list_id: taskListId || undefined,
      subtopic_id: subtopicId || undefined,
    });
    try {
      const res = await fetch(
        `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/task-bank/${qs}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) {
        throw new Error(`Ошибка загрузки (${res.status})`);
      }
      const json: BankResponse = await res.json();
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [level, subject, onlyFipi, page, vprGrade, taskListId, subtopicId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const totalPages = useMemo(() => {
    if (!data?.total) return 1;
    return Math.max(1, Math.ceil(data.total / PER_PAGE));
  }, [data?.total]);

  const resetPage = () => setPage(1);

  return (
    <div className="digital-flow-page">
      <Nav />
      <div className="digital-flow-page__wrap">
        <main className="all-tasks-page">
          <header className="section-head section-head--page">
            <h1 className="section-head__title">Все задачи</h1>
            <p className="section-head__lead">
              Фильтры по уровню, предмету, номеру задания и подтеме.
            </p>
          </header>

          <div
            className="all-tasks-filters"
            style={{ "--filter-accent": levelDef.bg } as CSSProperties}
          >
            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Уровень</span>
              <select
                className="all-tasks-filter__control"
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value as LevelId);
                  resetPage();
                }}
              >
                {LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Предмет</span>
              <select
                className="all-tasks-filter__control"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value as SubjectId);
                  resetPage();
                }}
              >
                {subjects.map((s: SubjectDefinition) => (
                  <option key={s.id} value={s.id} disabled={s.comingSoon}>
                    {s.title}
                    {s.comingSoon ? " (скоро)" : ""}
                  </option>
                ))}
              </select>
            </label>

            {level === "vpr" ? (
              <label className="all-tasks-filter">
                <span className="all-tasks-filter__label">Класс</span>
                <select
                  className="all-tasks-filter__control"
                  value={vprGrade}
                  onChange={(e) => {
                    setVprGrade(Number(e.target.value));
                    resetPage();
                  }}
                >
                  {GRADES_BY_LEVEL.vpr.map((g) => (
                    <option key={g} value={g}>
                      {g} класс
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Задание</span>
              <select
                className="all-tasks-filter__control"
                value={taskListId}
                disabled={filtersLoading}
                onChange={(e) => {
                  setTaskListId(e.target.value);
                  setSubtopicId("");
                  resetPage();
                }}
              >
                <option value="">Все</option>
                {(filterOptions?.task_numbers ?? []).map((t) => (
                  <option key={t.task_list_id} value={String(t.task_list_id)}>
                    №{t.task_number}
                    {t.task_title ? ` — ${t.task_title}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label
              className={`all-tasks-filter${!taskListId ? " all-tasks-filter--inactive" : ""}`}
              title={!taskListId ? "Сначала выберите задание" : undefined}
            >
              <span className="all-tasks-filter__label">Подтема</span>
              <select
                className="all-tasks-filter__control"
                value={subtopicId}
                disabled={!taskListId || filtersLoading}
                onChange={(e) => {
                  setSubtopicId(e.target.value);
                  resetPage();
                }}
              >
                <option value="">{taskListId ? "Все" : "Выберите задание"}</option>
                {subtopicsForTask.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.title}
                    {!taskListId ? ` (№${s.task_number})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="all-tasks-filter all-tasks-filter--check">
              <span className="all-tasks-filter__label all-tasks-filter__label--spacer" aria-hidden>
                &nbsp;
              </span>
              <span className="all-tasks-filter--check__row">
                <input
                  type="checkbox"
                  className="tasks-page-subtopic-checkbox-input"
                  checked={onlyFipi}
                  onChange={(e) => {
                    setOnlyFipi(e.target.checked);
                    resetPage();
                  }}
                />
                <span
                  className={`tasks-page-subtopic-checkbox-visual${onlyFipi ? " selected" : ""}`}
                  aria-hidden
                />
                <span>Только ФИПИ</span>
              </span>
            </label>
          </div>

          <div className="all-tasks-meta" aria-live="polite">
            {loading ? (
              <span>Загрузка…</span>
            ) : error ? (
              <span className="all-tasks-meta__error">{error}</span>
            ) : data ? (
              (() => {
                const selectedTaskNum = taskListId
                  ? filterOptions?.task_numbers?.find(
                      (t) => String(t.task_list_id) === taskListId
                    )
                  : null;
                const selectedSubtopic = subtopicId
                  ? subtopicsForTask.find((s) => String(s.id) === subtopicId)
                  : null;
                return (
                  <div className="all-tasks-meta__inner">
                    <span className="all-tasks-meta__count">
                      {formatTasksCount(data.total)}
                      {onlyFipi ? " · только ФИПИ" : ""}
                    </span>
                    {selectedTaskNum ? (
                      <span className="all-tasks-meta__badge">
                        №{selectedTaskNum.task_number}
                        {selectedTaskNum.task_title
                          ? ` · ${selectedTaskNum.task_title}`
                          : ""}
                      </span>
                    ) : null}
                    {selectedSubtopic ? (
                      <span className="all-tasks-meta__sub">
                        {selectedSubtopic.title}
                      </span>
                    ) : null}
                  </div>
                );
              })()
            ) : null}
          </div>

          {!taskListId && !loading && !error ? (
            <div className="all-tasks-empty all-tasks-empty--pick" role="status">
              <p className="all-tasks-empty__title">Выберите задание</p>
              <p className="all-tasks-empty__lead">
                Чтобы увидеть задачи, укажите номер задания в фильтре «Задание»
                (опционально — уровень, предмет, подтему и «Только ФИПИ»).
              </p>
            </div>
          ) : null}

          {taskListId && !loading && !error && data?.tasks.length === 0 ? (
            <p className="all-tasks-empty" role="status">
              По выбранным фильтрам заданий нет. Смените задание, подтему или снимите «Только ФИПИ».
            </p>
          ) : null}

          <ul className="all-tasks-list">
            {(data?.tasks ?? []).map((t, i) => {
              const ordinal = (data!.page - 1) * data!.per_page + i + 1;
              const a = answers[t.id];
              const isPart2 =
                t.part_id === 2 ||
                /(^|[^\dа-яё])2|втор/iu.test(t.part_title ?? "") ||
                isOgeInformaticsPart2TaskNumber(level, subject, t.task_number);
              const ogeInf13 = isOgeInformaticsTask(
                level,
                subject,
                t.task_number,
                13
              );
              const useExamTaskStyle = isPart2 || ogeInf13;
              return (
                <li
                  key={t.id}
                  className={`all-tasks-card${isPart2 ? " all-tasks-card--part2" : ""}${
                    ogeInf13 ? " all-tasks-card--oge-inf-13" : ""
                  }`}
                  data-task-number={t.task_number ?? undefined}
                  data-part={isPart2 ? "2" : "1"}
                  data-exam-style={useExamTaskStyle ? "1" : undefined}
                >
                  <div className="all-tasks-card__aside">
                    <span
                      className="all-tasks-card__num"
                      aria-label={`Задача №${ordinal} по порядку`}
                    >
                      {ordinal}
                    </span>
                    <span className="all-tasks-card__id">{t.id}</span>
                  </div>
                  <div className="all-tasks-card__content">
                    <LazyVisible minHeight={120}>
                      <MathContent
                        html={t.text || ""}
                        className="task-text all-tasks-card__text"
                        ogeInf13Enhance={ogeInf13}
                      />
                      {t.file_url ? (
                        <TaskFileAttachment href={t.file_url} />
                      ) : null}
                    </LazyVisible>
                  </div>
                  <div className="all-tasks-card__actions">
                    <button
                      type="button"
                      className="all-tasks-card__answer-btn"
                      onClick={() => toggleAnswer(t.id)}
                      aria-expanded={a?.open ? "true" : "false"}
                    >
                      {a?.loading
                        ? "Загрузка…"
                        : a?.open
                        ? "Скрыть ответ"
                        : "Посмотреть ответ"}
                    </button>
                  </div>
                  {a?.open ? (
                    <div className="all-tasks-card__answer" role="region" aria-live="polite">
                      <span className="all-tasks-card__answer-label">Ответ</span>
                      {a.error ? (
                        <p className="all-tasks-card__answer-error">{a.error}</p>
                      ) : a.html ? (
                        <MathContent
                          html={a.html}
                          className="task-text all-tasks-card__answer-content"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

        </main>
      </div>
    </div>
  );
}
