import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
// @ts-ignore JSX module without d.ts
import ExamTaskDrawingShell, { ExamTaskDrawingHeaderButton } from "../components/ExamTaskDrawingShell";
import { getLevelDef, type LevelId } from "../data/levels";
import {
  GRADES_BY_LEVEL,
  SUBJECTS_BY_LEVEL,
  type SubjectDefinition,
  type SubjectId,
} from "../data/subjects";
import { formatTasksCount } from "../utils/formatTasksCount";
import { openWorkbook } from "../utils/buildWorkbookHtml";
import {
  isInformaticsCodeEditorContext,
} from "../utils/isOgeInformaticsTask";
import type { TaskFileSource } from "../components/InformaticsCodeEditor/types";

import MathContent from "../components/MathContent";

const InformaticsCodeEditorEntry = lazy(
  () => import("../components/InformaticsCodeEditor/InformaticsCodeEditorEntry")
);

type BankTask = {
  id: number;
  task_number: number | null;
  task_title: string;
  subtopic: string | null;
  text: string;
  answer?: string | null;
  file_url?: string | null;
  part_id?: number | null;
  part_title?: string | null;
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
  id: number | null;
  title: string;
  task_list_id: number | null;
  task_number: number | null;
  task_count: number;
  no_subtopic?: boolean;
  no_subtopic_scope?: "all" | "task";
};

/** Значение select и query-параметр subtopic=none */
const SUBTOPIC_NONE = "none";

type FiltersResponse = {
  task_numbers: TaskNumberOption[];
  subtopics: SubtopicOption[];
};

const PER_PAGE = 5000;
const ALL_TASKS_BOARD_VARIANT_ID = "task-bank";

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

type AllTasksFilters = {
  level: LevelId;
  subject: SubjectId;
  vprGrade: number;
  taskListId: string;
  subtopicId: string;
  onlyFipi: boolean;
  page: number;
};

function readFiltersFromSearchParams(sp: URLSearchParams): AllTasksFilters {
  const levelRaw = sp.get("level");
  const level = LEVEL_OPTIONS.some((o) => o.id === levelRaw)
    ? (levelRaw as LevelId)
    : "oge";

  const subjects = SUBJECTS_BY_LEVEL[level] ?? [];
  const subjectRaw = sp.get("subject");
  const subject =
    subjects.find((s) => s.id === subjectRaw && !s.comingSoon)?.id ??
    subjects.find((s) => !s.comingSoon)?.id ??
    "inf";

  const grades = GRADES_BY_LEVEL.vpr;
  const gradeRaw = Number(sp.get("grade"));
  const vprGrade =
    level === "vpr" && grades.includes(gradeRaw) ? gradeRaw : (grades[0] ?? 7);

  const taskListId = sp.get("task")?.trim() ?? "";
  const subtopicRaw = sp.get("subtopic")?.trim() ?? "";
  const subtopicId = subtopicRaw === SUBTOPIC_NONE ? SUBTOPIC_NONE : subtopicRaw;
  const onlyFipi = sp.get("fipi") === "1";
  const page = Math.max(1, Number(sp.get("page")) || 1);

  return { level, subject, vprGrade, taskListId, subtopicId, onlyFipi, page };
}

function writeFiltersToSearchParams(f: AllTasksFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set("level", f.level);
  p.set("subject", f.subject);
  if (f.level === "vpr") p.set("grade", String(f.vprGrade));
  if (f.taskListId) p.set("task", f.taskListId);
  if (f.subtopicId) p.set("subtopic", f.subtopicId);
  if (f.onlyFipi) p.set("fipi", "1");
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

export default function AllTasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilters = useMemo(
    () => readFiltersFromSearchParams(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при первом монтировании
    []
  );

  const [level, setLevel] = useState<LevelId>(initialFilters.level);
  const [subject, setSubject] = useState<SubjectId>(initialFilters.subject);
  const [onlyFipi, setOnlyFipi] = useState(initialFilters.onlyFipi);
  const [vprGrade, setVprGrade] = useState<number>(initialFilters.vprGrade);
  const [taskListId, setTaskListId] = useState(initialFilters.taskListId);
  const [subtopicId, setSubtopicId] = useState(initialFilters.subtopicId);
  const [page, setPage] = useState(initialFilters.page);

  const levelSubjectRef = useRef<{ level: LevelId; subject: SubjectId } | null>(
    null
  );

  const [filterOptions, setFilterOptions] = useState<FiltersResponse | null>(null);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [data, setData] = useState<BankResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openBoardForTaskId, setOpenBoardForTaskId] = useState<number | null>(null);
  const [boardsByTask, setBoardsByTask] = useState<Record<string, any>>({});
  const [openAnswers, setOpenAnswers] = useState<Record<number, boolean>>({});

  const toggleAnswer = useCallback((taskId: number) => {
    setOpenAnswers((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  }, []);

  const boardPersistHasDraft = useCallback((persist: any) => {
    if (Array.isArray(persist?.overlayV1?.strokes) && persist.overlayV1.strokes.length > 0) return true;
    if (persist?.overlayV1?.snapshot && String(persist.overlayV1.snapshot).length > 400) return true;
    if (!persist?.history?.length) return false;
    const ix = typeof persist.historyIndex === "number" ? persist.historyIndex : persist.history.length - 1;
    if (ix < 0) return false;
    const e = persist.history[ix];
    if (typeof e === "string") return e.length > 2000;
    if (e?.objects?.length) return true;
    if (e?.bg && typeof e.bg === "string" && e.bg.length > 4500) return true;
    return false;
  }, []);

  const handleBoardPersist = useCallback((payload: any) => {
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

  const subjects = SUBJECTS_BY_LEVEL[level] ?? [];
  const levelDef = getLevelDef(level);

  const subtopicsForTask = useMemo(() => {
    if (!filterOptions) return [];
    const list = filterOptions.subtopics;
    if (!taskListId) {
      const global = list.find(
        (s) => s.no_subtopic && s.no_subtopic_scope === "all"
      );
      return global ? [global] : [];
    }
    const tlId = Number(taskListId);
    const forTask = list.filter(
      (s) =>
        s.task_list_id === tlId &&
        (!s.no_subtopic || s.no_subtopic_scope !== "all")
    );
    const noSt = forTask.find((s) => s.no_subtopic);
    const rest = forTask.filter((s) => !s.no_subtopic);
    return noSt ? [noSt, ...rest] : rest;
  }, [filterOptions, taskListId]);

  const canPickSubtopic = Boolean(taskListId || subtopicsForTask.length > 0);

  useEffect(() => {
    const next = writeFiltersToSearchParams({
      level,
      subject,
      vprGrade,
      taskListId,
      subtopicId,
      onlyFipi,
      page,
    });
    setSearchParams((prev) => (prev.toString() === next.toString() ? prev : next), {
      replace: true,
    });
  }, [level, subject, vprGrade, taskListId, subtopicId, onlyFipi, page, setSearchParams]);

  useEffect(() => {
    const list = SUBJECTS_BY_LEVEL[level] ?? [];
    if (!list.some((s) => s.id === subject)) {
      setSubject(list[0]?.id ?? "inf");
      return;
    }
    if (level === "vpr") {
      const grades = GRADES_BY_LEVEL.vpr;
      if (grades.length && !grades.includes(vprGrade)) {
        setVprGrade(grades[0]);
      }
    }
    const prev = levelSubjectRef.current;
    if (prev && (prev.level !== level || prev.subject !== subject)) {
      setTaskListId("");
      setSubtopicId("");
      setPage(1);
    }
    levelSubjectRef.current = { level, subject };
  }, [level, subject, vprGrade]);

  useEffect(() => {
    if (!filterOptions || !taskListId) return;
    const ok = filterOptions.task_numbers.some(
      (t) => String(t.task_list_id) === taskListId
    );
    if (!ok) setTaskListId("");
  }, [filterOptions, taskListId]);

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
    if (subtopicId === SUBTOPIC_NONE) {
      const ok = subtopicsForTask.some((s) => s.no_subtopic);
      if (!ok) setSubtopicId("");
      return;
    }
    const ok = subtopicsForTask.some((s) => String(s.id) === subtopicId);
    if (!ok) setSubtopicId("");
  }, [subtopicsForTask, subtopicId]);

  const fetchTasks = useCallback(async () => {
    if (!taskListId && subtopicId !== SUBTOPIC_NONE) {
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
      raw_html: "1",
      only_fipi: onlyFipi ? "1" : undefined,
      task_list_id: taskListId || undefined,
      subtopic_id:
        subtopicId === SUBTOPIC_NONE
          ? SUBTOPIC_NONE
          : subtopicId || undefined,
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

  useEffect(() => {
    setOpenAnswers({});
  }, [level, subject, vprGrade, taskListId, subtopicId, onlyFipi, page]);

  const selectedSubtopicTitle = useMemo(() => {
    if (!subtopicId) return "";
    if (subtopicId === SUBTOPIC_NONE) {
      return subtopicsForTask.find((s) => s.no_subtopic)?.title ?? "Без подтемы";
    }
    return subtopicsForTask.find((s) => String(s.id) === subtopicId)?.title ?? "";
  }, [subtopicId, subtopicsForTask]);

  const canBuildWorkbook = Boolean(!loading && !error && data?.tasks?.length);

  const handleCreateWorkbook = useCallback(() => {
    if (!data?.tasks?.length) return;

    const subjectTitle =
      subjects.find((s) => s.id === subject)?.title ?? subject;
    const subtitleParts = [levelDef?.label ?? level.toUpperCase(), subjectTitle];

    if (level === "vpr") {
      subtitleParts.push(`${vprGrade} класс`);
    }

    const selectedTaskNum = taskListId
      ? filterOptions?.task_numbers?.find(
          (t) => String(t.task_list_id) === taskListId
        )
      : null;

    if (selectedTaskNum) {
      subtitleParts.push(`Задание №${selectedTaskNum.task_number}`);
      if (selectedTaskNum.task_title) {
        subtitleParts.push(selectedTaskNum.task_title);
      }
    }

    if (selectedSubtopicTitle) {
      subtitleParts.push(selectedSubtopicTitle);
    }

    openWorkbook(
      data.tasks.map((task) => ({
        id: task.id,
        task_number: task.task_number,
        text: task.text,
        subtopic: task.subtopic,
        task_title: task.task_title,
      })),
      {
        title: "Рабочая тетрадь",
        subtitle: subtitleParts.join(" · "),
      }
    );
  }, [
    data?.tasks,
    filterOptions?.task_numbers,
    level,
    levelDef?.label,
    selectedSubtopicTitle,
    subject,
    subjects,
    taskListId,
    vprGrade,
  ]);

  const resetPage = () => setPage(1);

  const showCodeSidebar = isInformaticsCodeEditorContext(level, subject);

  const getCodeEditorTaskSources = useCallback((): TaskFileSource[] => {
    return (data?.tasks ?? [])
      .filter((t) => t.file_url)
      .slice(0, 80)
      .map((t) => ({
        id: t.id,
        label: t.task_number != null ? `№${t.task_number} · id ${t.id}` : `id ${t.id}`,
        fileUrl: t.file_url,
      }));
  }, [data?.tasks]);

  return (
    <div className="digital-flow-page">
      <div
        className={`digital-flow-page__wrap${showCodeSidebar ? " digital-flow-page__wrap--with-code-sidebar" : ""}`}
      >
        <main className="all-tasks-page">
          <header className="section-head section-head--page">
            <h1 className="section-head__title">Все задачи</h1>
            <p className="section-head__lead">
              Фильтры по уровню, предмету, номеру задания и подтеме.
            </p>
          </header>

          <button
            type="button"
            className="all-tasks-filters-toggle"
            aria-expanded={filtersOpen}
            aria-controls="all-tasks-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <span>Фильтры</span>
            <span className="all-tasks-filters-toggle__meta">
              {levelDef?.label ?? level.toUpperCase()}
              {onlyFipi ? " · ФИПИ" : ""}
            </span>
          </button>

          <div
            id="all-tasks-filters"
            className={`all-tasks-filters${filtersOpen ? " is-open" : ""}`}
            style={{ "--filter-accent": levelDef?.bg ?? "#2b52f5" } as CSSProperties}
          >
            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Уровень</span>
              <select
                className="all-tasks-filter__control"
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value as LevelId);
                  setTaskListId("");
                  setSubtopicId("");
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
                  setTaskListId("");
                  setSubtopicId("");
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
                    {t.task_count > 0 ? ` (${t.task_count})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label
              className={`all-tasks-filter${!canPickSubtopic ? " all-tasks-filter--inactive" : ""}`}
              title={
                !canPickSubtopic
                  ? "Сначала выберите задание или дождитесь загрузки фильтров"
                  : undefined
              }
            >
              <span className="all-tasks-filter__label">Подтема</span>
              <select
                className="all-tasks-filter__control"
                value={subtopicId}
                disabled={!canPickSubtopic || filtersLoading}
                onChange={(e) => {
                  setSubtopicId(e.target.value);
                  resetPage();
                }}
              >
                <option value="">
                  {taskListId ? "Все подтемы" : "Все задания — без подтемы"}
                </option>
                {subtopicsForTask.map((s) => (
                  <option
                    key={
                      s.no_subtopic
                        ? `none-${s.task_list_id ?? "all"}`
                        : String(s.id)
                    }
                    value={s.no_subtopic ? SUBTOPIC_NONE : String(s.id)}
                  >
                    {s.title}
                    {` (${s.task_count})`}
                    {!taskListId && s.task_number != null ? ` · №${s.task_number}` : ""}
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
                  ? subtopicId === SUBTOPIC_NONE
                    ? subtopicsForTask.find((s) => s.no_subtopic) ?? {
                        title: "Без подтемы",
                      }
                    : subtopicsForTask.find((s) => String(s.id) === subtopicId)
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
                    {canBuildWorkbook ? (
                      <button
                        type="button"
                        className="all-tasks-workbook-btn"
                        onClick={handleCreateWorkbook}
                      >
                        Создать рабочую тетрадь
                      </button>
                    ) : null}
                  </div>
                );
              })()
            ) : null}
          </div>

          {!taskListId && subtopicId !== SUBTOPIC_NONE && !loading && !error ? (
            <div className="all-tasks-empty all-tasks-empty--pick" role="status">
              <p className="all-tasks-empty__title">Выберите задание</p>
              <p className="all-tasks-empty__lead">
                Укажите номер в фильтре «Задание» или выберите в «Подтема» пункт
                «Без подтемы», чтобы показать все задачи без подтемы.
              </p>
            </div>
          ) : null}

          {(taskListId || subtopicId === SUBTOPIC_NONE) &&
          !loading &&
          !error &&
          data?.tasks.length === 0 ? (
            <p className="all-tasks-empty" role="status">
              По выбранным фильтрам заданий нет. Смените задание, подтему или снимите «Только ФИПИ».
            </p>
          ) : null}

          <ul className="all-tasks-list">
            {(data?.tasks ?? []).map((t, i) => {
              const ordinal = (data!.page - 1) * data!.per_page + i + 1;
              const taskBoardPersist = boardsByTask[String(t.id)];
              const hasTaskBoardDraft = boardPersistHasDraft(taskBoardPersist);
              const answerOpen = !!openAnswers[t.id];
              const answerHtml = (t.answer || "").trim();
              return (
                <li
                  key={t.id}
                  className="all-tasks-card all-tasks-card--raw"
                  data-task-number={t.task_number ?? undefined}
                >
                  <div className="all-tasks-card__aside">
                    <span
                      className="all-tasks-card__num"
                      aria-label={`Задача №${ordinal} по порядку`}
                    >
                      {ordinal}
                    </span>
                    <span className="all-tasks-card__id">id {t.id}</span>
                  </div>
                  <div className="all-tasks-card__content">
                    <div className="all-tasks-raw-item__meta">
                      {t.task_number != null ? <span>№{t.task_number}</span> : null}
                      {t.task_title ? <span>{t.task_title}</span> : null}
                      {t.subtopic ? <span>{t.subtopic}</span> : null}
                    </div>
                    <ExamTaskDrawingShell
                      enabled
                      taskId={t.id}
                      level={level}
                      subject={subject}
                      variantId={ALL_TASKS_BOARD_VARIANT_ID}
                      persistEntry={taskBoardPersist}
                      onDrawingPersist={(payload: any) =>
                        handleBoardPersist({ taskId: t.id, ...payload })
                      }
                      openBoardForTaskId={openBoardForTaskId}
                      onConsumedBoardOpenRequest={() => setOpenBoardForTaskId(null)}
                    >
                      <div className="all-tasks-raw-item__body">
                        <LazyVisible minHeight={120}>
                          <MathContent
                            className="all-tasks-raw-html"
                            html={t.text || ""}
                            ogeInf13Enhance={level === "oge" && subject === "inf" && t.task_number === 13}
                            ogeInf6Enhance={level === "oge" && subject === "inf" && t.task_number === 6}
                            egeInfFileEnhance={level === "ege" && subject === "inf"}
                            egeInf22Enhance={level === "ege" && subject === "inf" && t.task_number === 22}
                            egeInf1Enhance={level === "ege" && subject === "inf" && t.task_number === 1}
                            egeInf2Enhance={level === "ege" && subject === "inf" && t.task_number === 2}
                          />
                          {t.file_url ? (
                            <p className="all-tasks-raw-file">
                              <a href={t.file_url} target="_blank" rel="noreferrer">
                                Файл задания
                              </a>
                            </p>
                          ) : null}
                        </LazyVisible>
                      </div>
                    </ExamTaskDrawingShell>
                  </div>
                  <div className="all-tasks-card__actions">
                    {answerHtml ? (
                      <button
                        type="button"
                        className="all-tasks-card__answer-btn"
                        onClick={() => toggleAnswer(t.id)}
                        aria-expanded={answerOpen ? "true" : "false"}
                      >
                        {answerOpen ? "Скрыть ответ" : "Посмотреть ответ"}
                      </button>
                    ) : (
                      <span className="task-no-answer-badge">Пока без ответа</span>
                    )}
                    <div className="exam-task-card__status-cluster">
                      <ExamTaskDrawingHeaderButton 
                        onClick={() => setOpenBoardForTaskId(t.id)} 
                        hasDraft={hasTaskBoardDraft}
                      />
                    </div>
                  </div>
                  {answerOpen ? (
                    <div className="all-tasks-card__answer all-tasks-raw-answer" role="region" aria-live="polite">
                      <div className="all-tasks-card__answer-label">
                        <strong>Ответ</strong>
                      </div>
                      {answerHtml ? (
                        <MathContent
                          className="all-tasks-raw-html"
                          html={answerHtml}
                          ogeInf13Enhance={level === "oge" && subject === "inf" && t.task_number === 13}
                          ogeInf6Enhance={level === "oge" && subject === "inf" && t.task_number === 6}
                          egeInfFileEnhance={level === "ege" && subject === "inf"}
                        />
                      ) : (
                        <p>Ответ не указан.</p>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

        </main>

        {showCodeSidebar ? (
          <Suspense fallback={null}>
            <InformaticsCodeEditorEntry getTaskSources={getCodeEditorTaskSources} />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
