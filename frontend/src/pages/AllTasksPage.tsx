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
import { formatGroupsCount, formatTasksCount } from "../utils/formatTasksCount";
import VariantCreateBar from "../components/VariantCreateBar";
import WorkbookCreateBar from "../components/WorkbookCreateBar";
import type { WorkbookTask } from "../utils/buildWorkbookHtml";
import { isInformaticsCodeEditorContext } from "../utils/isOgeInformaticsTask";
import type { TaskFileSource } from "../components/InformaticsCodeEditor/types";

import MathContent from "../components/MathContent";
import TaskFileAttachment from "../components/TaskFileAttachment";

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
  author?: string | null;
};

type BankResponse = {
  total: number;
  page: number;
  per_page: number;
  tasks: BankTask[];
};

type BankGroupInstance = {
  group_id: number;
  subtopic_id: number | null;
  tasks: BankTask[];
};

type BankGroupResponse = {
  total: number;
  page: number;
  per_page: number;
  instances: BankGroupInstance[];
};

type GroupBankDescriptor = {
  linkedKey: string;
  taskNumbers: number[];
  label: string;
};

type TasksStructureItem = {
  type: "single" | "group" | "linked_group";
  linked_key?: string;
  task_numbers?: number[];
  tasks?: Array<{
    tasklist_id: number;
    task_number: number;
    task_title?: string;
  }>;
};

type BankDisplayEntry =
  | { kind: "single"; task: BankTask }
  | { kind: "group"; groupId: number; tasks: BankTask[] };

function buildGroupByTaskListId(
  items: TasksStructureItem[]
): Map<string, GroupBankDescriptor> {
  const map = new Map<string, GroupBankDescriptor>();
  for (const item of items) {
    if (item.type !== "group" && item.type !== "linked_group") continue;
    const numsRaw =
      item.task_numbers && item.task_numbers.length
        ? [...item.task_numbers]
        : (item.tasks || [])
            .map((x) => x.task_number)
            .filter((n): n is number => n != null);
    const numsSorted = [...new Set(numsRaw.map((n) => Number(n)))].sort((a, b) => a - b);
    if (!numsSorted.length) continue;
    const linkedKey =
      item.type === "linked_group"
        ? String(item.linked_key || numsSorted.join("_"))
        : numsSorted.join("_");
    const label =
      numsSorted.length === 1
        ? `Группа · задание ${numsSorted[0]}`
        : `Группа ${numsSorted[0]}–${numsSorted[numsSorted.length - 1]}`;
    const desc: GroupBankDescriptor = { linkedKey, taskNumbers: numsSorted, label };
    for (const t of item.tasks || []) {
      if (t.tasklist_id != null) {
        map.set(String(t.tasklist_id), desc);
      }
    }
  }
  return map;
}

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
};

type FiltersResponse = {
  task_numbers: TaskNumberOption[];
  subtopics: SubtopicOption[];
};

const PER_PAGE = 5000;
const ALL_TASKS_BOARD_VARIANT_ID = "task-bank";
const NO_ANSWER_SUBTOPIC_VALUE = "no-answer";

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

function getActiveSubjectsForAllTasks(level: LevelId) {
  return (SUBJECTS_BY_LEVEL[level] ?? []).map((s) =>
    s.id === "rus" ? { ...s, comingSoon: false } : s
  );
}

function readFiltersFromSearchParams(sp: URLSearchParams): AllTasksFilters {
  const levelRaw = sp.get("level");
  const level = LEVEL_OPTIONS.some((o) => o.id === levelRaw)
    ? (levelRaw as LevelId)
    : "oge";

  const subjects = getActiveSubjectsForAllTasks(level);
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
  const subtopicId = subtopicRaw === "none" ? "" : subtopicRaw;
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
  const [groupByTaskListId, setGroupByTaskListId] = useState<
    Map<string, GroupBankDescriptor>
  >(new Map());
  const [data, setData] = useState<BankResponse | null>(null);
  const [groupData, setGroupData] = useState<BankGroupResponse | null>(null);
  const [bankUsesGroups, setBankUsesGroups] = useState(false);
  const [activeGroupDescriptor, setActiveGroupDescriptor] =
    useState<GroupBankDescriptor | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openBoardForTaskId, setOpenBoardForTaskId] = useState<number | null>(null);
  const [boardsByTask, setBoardsByTask] = useState<Record<string, any>>({});
  const [openAnswers, setOpenAnswers] = useState<Record<number, boolean>>({});
  const [pickDraft, setPickDraft] = useState<WorkbookTask[]>([]);
  const [pickMode, setPickMode] = useState<"workbook" | "variant" | null>(null);

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

  const subjects = getActiveSubjectsForAllTasks(level);
  const levelDef = getLevelDef(level);

  const subtopicsForTask = useMemo(() => {
    if (!filterOptions || !taskListId) return [];
    const tlId = Number(taskListId);
    return filterOptions.subtopics.filter(
      (s) => s.task_list_id === tlId && s.id != null
    );
  }, [filterOptions, taskListId]);

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
    const list = getActiveSubjectsForAllTasks(level);
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
    const url = `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/tasks/${buildQuery(level, vprGrade)}`;

    fetch(url, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { tasks?: TasksStructureItem[] }) => {
        if (!cancelled) {
          setGroupByTaskListId(buildGroupByTaskListId(json.tasks ?? []));
        }
      })
      .catch(() => {
        if (!cancelled) setGroupByTaskListId(new Map());
      });

    return () => {
      cancelled = true;
    };
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
    if (!subtopicId || subtopicId === NO_ANSWER_SUBTOPIC_VALUE) return;
    const ok = subtopicsForTask.some((s) => String(s.id) === subtopicId);
    if (!ok) setSubtopicId("");
  }, [subtopicsForTask, subtopicId]);

  const fetchTasks = useCallback(async () => {
    if (!taskListId) {
      setData(null);
      setGroupData(null);
      setBankUsesGroups(false);
      setActiveGroupDescriptor(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const groupDescriptor = taskListId ? groupByTaskListId.get(taskListId) ?? null : null;

    try {
      if (groupDescriptor) {
        const qs = buildQuery(level, vprGrade, {
          page: String(page),
          per_page: String(PER_PAGE),
          only_fipi: onlyFipi ? "1" : undefined,
          linked_key: groupDescriptor.linkedKey,
          subtopic_id: subtopicId || undefined,
        });
        const res = await fetch(
          `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/group-instances/${qs}`,
          { credentials: "same-origin" }
        );
        if (!res.ok) {
          throw new Error(`Ошибка загрузки (${res.status})`);
        }
        const json: BankGroupResponse = await res.json();
        setGroupData(json);
        setData(null);
        setBankUsesGroups(true);
        setActiveGroupDescriptor(groupDescriptor);
      } else {
        const qs = buildQuery(level, vprGrade, {
          page: String(page),
          per_page: String(PER_PAGE),
          raw_html: undefined,
          only_fipi: onlyFipi ? "1" : undefined,
          task_list_id: taskListId || undefined,
          subtopic_id: subtopicId || undefined,
        });
        const res = await fetch(
          `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/task-bank/${qs}`,
          { credentials: "same-origin" }
        );
        if (!res.ok) {
          throw new Error(`Ошибка загрузки (${res.status})`);
        }
        const json: BankResponse = await res.json();
        setData(json);
        setGroupData(null);
        setBankUsesGroups(false);
        setActiveGroupDescriptor(null);
      }
    } catch (e) {
      setData(null);
      setGroupData(null);
      setBankUsesGroups(false);
      setActiveGroupDescriptor(null);
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [
    level,
    subject,
    onlyFipi,
    page,
    vprGrade,
    taskListId,
    subtopicId,
    groupByTaskListId,
  ]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    setOpenAnswers({});
  }, [level, subject, vprGrade, taskListId, subtopicId, onlyFipi, page]);

  useEffect(() => {
    setPickMode(null);
    setPickDraft([]);
  }, [level, subject]);

  const displayEntries = useMemo((): BankDisplayEntry[] => {
    if (bankUsesGroups) {
      const instances = groupData?.instances ?? [];
      return instances.map((group) => ({
        kind: "group" as const,
        groupId: group.group_id,
        tasks: group.tasks,
      }));
    }
    const list = data?.tasks ?? [];
    return list.map((task) => ({ kind: "single" as const, task }));
  }, [bankUsesGroups, data?.tasks, groupData?.instances]);

  const visibleTasks = useMemo(
    () =>
      displayEntries.flatMap((entry) =>
        entry.kind === "group" ? entry.tasks : [entry.task]
      ),
    [displayEntries]
  );

  const visibleTotal = bankUsesGroups
    ? groupData?.total ?? 0
    : data?.total ?? 0;

  const canBuildWorkbook = Boolean(
    !loading && !error && displayEntries.length > 0
  );

  const pickDraftIds = useMemo(
    () => new Set(pickDraft.map((task) => task.id)),
    [pickDraft]
  );

  const subjectTitle = useMemo(
    () => subjects.find((s) => s.id === subject)?.title ?? subject,
    [subject, subjects]
  );

  const workbookMeta = useMemo(() => {
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

    return {
      title: "Рабочая тетрадь",
      subtitle: subtitleParts.join(" · "),
      subject: subject,
    };
  }, [
    filterOptions?.task_numbers,
    level,
    levelDef?.label,
    subject,
    subjectTitle,
    taskListId,
    vprGrade,
  ]);

  const togglePickGroup = useCallback((tasks: BankTask[], checked: boolean) => {
    if (checked) {
      setPickDraft((prev) => {
        const existing = new Set(prev.map((item) => item.id));
        const next = [...prev];
        for (const task of tasks) {
          if (existing.has(task.id)) continue;
          existing.add(task.id);
          next.push({
            id: task.id,
            task_number: task.task_number,
            text: task.text,
            answer: task.answer,
            subtopic: task.subtopic,
            task_title: task.task_title,
            file_url: task.file_url,
            author: task.author,
          });
        }
        return next;
      });
      return;
    }
    const removeIds = new Set(tasks.map((task) => task.id));
    setPickDraft((prev) => prev.filter((item) => !removeIds.has(item.id)));
  }, []);

  const togglePickTask = useCallback((task: BankTask, checked: boolean) => {
    if (checked) {
      setPickDraft((prev) => {
        if (prev.some((item) => item.id === task.id)) return prev;
        return [
          ...prev,
          {
            id: task.id,
            task_number: task.task_number,
            text: task.text,
            answer: task.answer,
            subtopic: task.subtopic,
            task_title: task.task_title,
            file_url: task.file_url,
            author: task.author,
          },
        ];
      });
      return;
    }
    setPickDraft((prev) => prev.filter((item) => item.id !== task.id));
  }, []);

  const startWorkbookMode = useCallback(() => {
    setPickDraft([]);
    setPickMode("workbook");
  }, []);

  const startVariantMode = useCallback(() => {
    setPickDraft([]);
    setPickMode("variant");
  }, []);

  const exitPickMode = useCallback(() => {
    setPickMode(null);
    setPickDraft([]);
  }, []);

  const allVisibleInPick = useMemo(
    () =>
      displayEntries.length > 0 &&
      displayEntries.every((entry) => {
        if (entry.kind === "group") {
          return entry.tasks.every((task) => pickDraftIds.has(task.id));
        }
        return pickDraftIds.has(entry.task.id);
      }),
    [displayEntries, pickDraftIds]
  );

  const addAllVisibleToPick = useCallback(() => {
    setPickDraft((prev) => {
      const existing = new Set(prev.map((task) => task.id));
      const next = [...prev];
      for (const task of visibleTasks) {
        if (existing.has(task.id)) continue;
        existing.add(task.id);
        next.push({
          id: task.id,
          task_number: task.task_number,
          text: task.text,
          answer: task.answer,
          subtopic: task.subtopic,
          task_title: task.task_title,
          file_url: task.file_url,
          author: task.author,
        });
      }
      return next;
    });
  }, [visibleTasks]);

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
        <main className={`all-tasks-page${pickMode ? " all-tasks-page--workbook-mode" : ""}`}>
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

            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Подтема</span>
              <select
                className="all-tasks-filter__control"
                value={subtopicId}
                disabled={filtersLoading || !taskListId}
                onChange={(e) => {
                  setSubtopicId(e.target.value);
                  resetPage();
                }}
              >
                <option value="">Все подтемы</option>
                <option value={NO_ANSWER_SUBTOPIC_VALUE}>Без ответа</option>
                {subtopicsForTask.map((s) => (
                  <option key={String(s.id)} value={String(s.id)}>
                    {s.title}
                    {` (${s.task_count})`}
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
            ) : data || groupData ? (
              (() => {
                const selectedTaskNum = taskListId
                  ? filterOptions?.task_numbers?.find(
                      (t) => String(t.task_list_id) === taskListId
                    )
                  : null;
                const noAnswerOnly = subtopicId === NO_ANSWER_SUBTOPIC_VALUE;
                const selectedSubtopic = subtopicId
                  ? noAnswerOnly
                    ? null
                    : subtopicsForTask.find((s) => String(s.id) === subtopicId)
                  : null;
                return (
                  <div className="all-tasks-meta__inner">
                    <span className="all-tasks-meta__count">
                      {bankUsesGroups ? formatGroupsCount(visibleTotal) : formatTasksCount(visibleTotal)}
                      {onlyFipi ? " · только ФИПИ" : ""}
                    </span>
                    {bankUsesGroups && activeGroupDescriptor ? (
                      <span className="all-tasks-meta__badge">
                        {activeGroupDescriptor.label}
                      </span>
                    ) : null}
                    {selectedTaskNum && !bankUsesGroups ? (
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
                    {noAnswerOnly ? (
                      <span className="all-tasks-meta__sub">Без ответа</span>
                    ) : null}
                    {canBuildWorkbook && !pickMode ? (
                      <div className="all-tasks-meta__actions">
                        <button
                          type="button"
                          className="all-tasks-workbook-btn"
                          onClick={startWorkbookMode}
                        >
                          Создать рабочую тетрадь
                        </button>
                        <button
                          type="button"
                          className="all-tasks-workbook-btn all-tasks-workbook-btn--variant"
                          onClick={startVariantMode}
                        >
                          Создать вариант
                        </button>
                      </div>
                    ) : null}
                    {pickMode ? (
                      <button
                        type="button"
                        className="all-tasks-workbook-btn all-tasks-workbook-btn--cancel"
                        onClick={exitPickMode}
                      >
                        Отмена
                      </button>
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
                Укажите номер в фильтре «Задание», чтобы показать задачи из банка.
              </p>
            </div>
          ) : null}

          {taskListId && !loading && !error && displayEntries.length === 0 ? (
            <p className="all-tasks-empty" role="status">
              По выбранным фильтрам заданий нет. Смените задание, подтему или снимите «Только ФИПИ».
            </p>
          ) : null}

          {pickMode ? (
            <div className="all-tasks-workbook-hint" role="status">
              <p className="all-tasks-workbook-hint__text">
                {pickMode === "variant"
                  ? "Отметьте галочкой задания для варианта, затем нажмите «Создать вариант» внизу справа."
                  : "Отметьте галочкой задания для тетради, затем нажмите «Создать тетрадь» внизу справа."}
              </p>
              <button
                type="button"
                className="all-tasks-workbook-hint__add-all"
                onClick={addAllVisibleToPick}
                disabled={!displayEntries.length || allVisibleInPick}
              >
                Добавить все
              </button>
            </div>
          ) : null}

          <ul className="all-tasks-list">
            {displayEntries.map((entry, entryIndex) => {
              if (entry.kind === "group") {
                const groupNums = entry.tasks
                  .map((t) => t.task_number)
                  .filter((n): n is number => n != null);
                const groupInPick = entry.tasks.every((task) =>
                  pickDraftIds.has(task.id)
                );
                const groupHasMissingAnswer = entry.tasks.some(
                  (t) => !(t.answer && String(t.answer).trim())
                );
                return (
                  <li key={`group-${entry.groupId}`} className="all-tasks-list__item">
                    <article
                      className={[
                        "all-tasks-item",
                        "all-tasks-item--group",
                        pickMode && groupInPick ? "all-tasks-item--in-workbook" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-group-id={entry.groupId}
                    >
                      <div className="all-tasks-item__card">
                        <header className="all-tasks-item__head all-tasks-item__head--group">
                          <p className="all-tasks-item__meta">
                            <span className="all-tasks-item__num">Группа заданий</span>
                            <span className="all-tasks-item__meta-sep" aria-hidden>
                              ·
                            </span>
                            <span>вариант #{entry.groupId}</span>
                            {groupNums.length ? (
                              <>
                                <span className="all-tasks-item__meta-sep" aria-hidden>
                                  ·
                                </span>
                                <span>№{groupNums.join(", ")}</span>
                              </>
                            ) : null}
                            {groupHasMissingAnswer ? (
                              <span className="task-no-answer-badge">Пока без ответа</span>
                            ) : null}
                          </p>
                          <div className="all-tasks-item__actions">
                            {pickMode ? (
                              <label className="all-tasks-item__workbook-check">
                                <input
                                  type="checkbox"
                                  checked={groupInPick}
                                  onChange={(e) =>
                                    togglePickGroup(entry.tasks, e.target.checked)
                                  }
                                />
                                <span>Добавить группу</span>
                              </label>
                            ) : null}
                          </div>
                        </header>
                        <div className="all-tasks-item__group-body">
                          {(() => {
                            const renderGroupTask = (t: BankTask) => {
                              const taskNumber = t.task_number ?? 0;
                              const taskBoardPersist = boardsByTask[String(t.id)];
                              const hasTaskBoardDraft = boardPersistHasDraft(taskBoardPersist);
                              const answerOpen = !!openAnswers[t.id];
                              const answerHtml = (t.answer || "").trim();
                              return (
                                <section
                                  key={t.id}
                                  className="all-tasks-item__group-part"
                                  data-task-id={t.id}
                                  data-task-number={t.task_number ?? undefined}
                                >
                                  <div className="all-tasks-item__group-part-head">
                                    <p className="all-tasks-item__meta">
                                      <span className="all-tasks-item__num">№{taskNumber}</span>
                                      <span className="all-tasks-item__meta-sep" aria-hidden>
                                        ·
                                      </span>
                                      <span>ID {t.id}</span>
                                      {t.task_title ? (
                                        <>
                                          <span className="all-tasks-item__meta-sep" aria-hidden>
                                            ·
                                          </span>
                                          <span>{t.task_title}</span>
                                        </>
                                      ) : null}
                                      {t.part_title ? (
                                        <>
                                          <span className="all-tasks-item__meta-sep" aria-hidden>
                                            ·
                                          </span>
                                          <span>{t.part_title}</span>
                                        </>
                                      ) : null}
                                      {!answerHtml ? (
                                        <span className="task-no-answer-badge">Пока без ответа</span>
                                      ) : null}
                                    </p>
                                    <div className="all-tasks-item__actions">
                                      {answerHtml ? (
                                        <button
                                          type="button"
                                          className="all-tasks-item__answer-btn"
                                          onClick={() => toggleAnswer(t.id)}
                                          aria-expanded={answerOpen ? "true" : "false"}
                                        >
                                          {answerOpen ? "Скрыть ответ" : "Посмотреть ответ"}
                                        </button>
                                      ) : null}
                                      <ExamTaskDrawingHeaderButton
                                        onClick={() => setOpenBoardForTaskId(t.id)}
                                        hasDraft={hasTaskBoardDraft}
                                      />
                                    </div>
                                  </div>
                                  <div className="all-tasks-item__content">
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
                                      onConsumedBoardOpenRequest={() =>
                                        setOpenBoardForTaskId(null)
                                      }
                                    >
                                      <LazyVisible minHeight={120}>
                                        <MathContent
                                          html={t.text || ""}
                                          className="all-tasks-item__html"
                                          plainHtml
                                          ogeMathChoiceEnhance={subject === "math"}
                                        />
                                        {t.file_url ? (
                                          <TaskFileAttachment href={t.file_url} />
                                        ) : null}
                                        {t.author ? (
                                          <div className="task-author">{t.author}</div>
                                        ) : null}
                                      </LazyVisible>
                                    </ExamTaskDrawingShell>
                                  </div>
                                  {answerOpen ? (
                                    <div
                                      className="all-tasks-item__answer"
                                      role="region"
                                      aria-live="polite"
                                      aria-label="Правильный ответ"
                                    >
                                      {answerHtml ? (
                                        <MathContent
                                          html={answerHtml}
                                          className="all-tasks-item__html all-tasks-item__html--answer"
                                          plainHtml
                                        />
                                      ) : (
                                        <p>Ответ не указан.</p>
                                      )}
                                    </div>
                                  ) : null}
                                </section>
                              );
                            };

                            const firstTask = entry.tasks[0];
                            const otherTasks = entry.tasks.slice(1);

                            return (
                              <>
                                <div className="all-tasks-item__group-col all-tasks-item__group-col--main">
                                  {firstTask && renderGroupTask(firstTask)}
                                </div>
                                {otherTasks.length > 0 && (
                                  <div className="all-tasks-item__group-col all-tasks-item__group-col--sub">
                                    {otherTasks.map((t) => renderGroupTask(t))}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </article>
                  </li>
                );
              }

              const t = entry.task;
              const taskNumber = t.task_number ?? entryIndex + 1;
              const taskBoardPersist = boardsByTask[String(t.id)];
              const hasTaskBoardDraft = boardPersistHasDraft(taskBoardPersist);
              const answerOpen = !!openAnswers[t.id];
              const answerHtml = (t.answer || "").trim();
              const inPick = pickDraftIds.has(t.id);
              return (
                <li key={t.id} className="all-tasks-list__item">
                  <article
                    className={[
                      "all-tasks-item",
                      pickMode && inPick ? "all-tasks-item--in-workbook" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-task-id={t.id}
                    data-task-number={t.task_number ?? undefined}
                  >
                    <div className="all-tasks-item__card">
                      <header className="all-tasks-item__head">
                        <p className="all-tasks-item__meta">
                          <span className="all-tasks-item__num">№{taskNumber}</span>
                          <span className="all-tasks-item__meta-sep" aria-hidden>
                            ·
                          </span>
                          <span>ID {t.id}</span>
                          {t.task_title ? (
                            <>
                              <span className="all-tasks-item__meta-sep" aria-hidden>
                                ·
                              </span>
                              <span>{t.task_title}</span>
                            </>
                          ) : null}
                          {t.subtopic ? (
                            <>
                              <span className="all-tasks-item__meta-sep" aria-hidden>
                                ·
                              </span>
                              <span>{t.subtopic}</span>
                            </>
                          ) : null}
                          {!answerHtml ? (
                            <span className="task-no-answer-badge">Пока без ответа</span>
                          ) : null}
                        </p>
                        <div className="all-tasks-item__actions">
                          {pickMode ? (
                            <label className="all-tasks-item__workbook-check">
                              <input
                                type="checkbox"
                                checked={inPick}
                                onChange={(e) => togglePickTask(t, e.target.checked)}
                              />
                              <span>Добавить</span>
                            </label>
                          ) : null}
                          {answerHtml ? (
                            <button
                              type="button"
                              className="all-tasks-item__answer-btn"
                              onClick={() => toggleAnswer(t.id)}
                              aria-expanded={answerOpen ? "true" : "false"}
                            >
                              {answerOpen ? "Скрыть ответ" : "Посмотреть ответ"}
                            </button>
                          ) : null}
                          <ExamTaskDrawingHeaderButton
                            onClick={() => setOpenBoardForTaskId(t.id)}
                            hasDraft={hasTaskBoardDraft}
                          />
                        </div>
                      </header>
                      <div className="all-tasks-item__content">
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
                          <LazyVisible minHeight={120}>
                            <MathContent
                              html={t.text || ""}
                              className="all-tasks-item__html"
                              plainHtml
                              ogeMathChoiceEnhance={subject === "math"}
                            />
                            {t.file_url ? <TaskFileAttachment href={t.file_url} /> : null}
                            {t.author ? (
                              <div className="task-author">{t.author}</div>
                            ) : null}
                          </LazyVisible>
                        </ExamTaskDrawingShell>
                      </div>
                      {answerOpen ? (
                        <div
                          className="all-tasks-item__answer"
                          role="region"
                          aria-live="polite"
                          aria-label="Правильный ответ"
                        >
                          {answerHtml ? (
                            <MathContent
                              html={answerHtml}
                              className="all-tasks-item__html all-tasks-item__html--answer"
                              plainHtml
                            />
                          ) : (
                            <p>Ответ не указан.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </article>
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

      <WorkbookCreateBar
        active={pickMode === "workbook"}
        tasks={pickDraft}
        meta={workbookMeta}
        onCreated={exitPickMode}
      />
      <VariantCreateBar
        active={pickMode === "variant"}
        tasks={pickDraft}
        level={level}
        subject={subject}
        subjectName={subjectTitle}
        onCreated={exitPickMode}
      />
    </div>
  );
}
