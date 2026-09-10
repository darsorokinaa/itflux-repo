import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useSearchParams } from "react-router-dom";
import { getLevelDef } from "../data/levels";
import {
  GRADES_BY_LEVEL,
  buildSubjectDefinition,
  type SubjectDefinition,
  type SubjectId,
} from "../data/subjects";
import { fetchExamCatalog, type CatalogLevel } from "../utils/examCatalog";
import { formatGroupsCount, formatTasksCount } from "../utils/formatTasksCount";
import VariantCreateBar from "../components/VariantCreateBar";
import WorkbookCreateBar from "../components/WorkbookCreateBar";
import type { WorkbookTask } from "../utils/buildWorkbookHtml";
import { fetchCabinetSession } from "../utils/cabinetAuth";
import { copyGlobalTaskToMyBank, fetchMyTask, fetchMyTasksMeta } from "../utils/teacherTaskBankApi";
import { useAccessGate } from "../hooks/useAccessGate";
import "../styles/my-task-bank.css";
import { collectTaskFiles } from "../components/TaskFileAttachment";
// @ts-ignore JSX module without d.ts
import ImageLightbox from "../components/ImageLightbox";
import {
  AllTasksTagsCatalogSidebar,
  fetchTaskTagsCatalog,
  useCanEditTaskTags,
  type TaskTag,
} from "../components/AllTasksTagEditor";
import {
  AllTasksStaffCatalogSidebar,
  createStaffGroup,
  createStaffSubtopic,
  fetchStaffGroups,
  fetchStaffSubtopics,
  updateStaffTaskList,
  useCanEditBankTasks,
  type StaffGroupOption,
  type StaffSubtopicOption,
  type StaffTaskPatch,
} from "../components/AllTasksStaffEditor";
import {
  AllTasksBankItem,
  AllTasksGroupItem,
  EMPTY_STAFF_TASK_LISTS,
  type BankTask,
} from "../components/AllTasksBankItem";

// TEMP: кнопка «Код» временно скрыта
// const InformaticsCodeEditorEntry = lazy(
//   () => import("../components/InformaticsCodeEditor/InformaticsCodeEditorEntry")
// );

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

function toPickDraftTask(
  task: {
    id: number;
    task_number?: number | null;
    exam_task_number?: number | null;
    text?: string;
    text_preview?: string;
    answer?: string | null;
    subtopic?: string | null;
    task_title?: string | null;
    file_url?: string | null;
    attachments?: BankTask["attachments"];
    author?: string | null;
  },
  mode?: "workbook" | "variant" | null
): WorkbookTask {
  if (mode === "variant") {
    return {
      id: task.id,
      task_number: task.task_number ?? task.exam_task_number ?? null,
      text: "",
    };
  }
  const files = collectTaskFiles(task);
  return {
    id: task.id,
    task_number: task.task_number ?? task.exam_task_number ?? null,
    text: task.text || task.text_preview || "",
    answer: task.answer,
    subtopic: task.subtopic,
    task_title: task.task_title,
    file_url: files[0]?.url || task.file_url || null,
    author: task.author,
  };
}

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
  id: number | string | null;
  title: string;
  task_list_id: number | null;
  task_number: number | null;
  task_count: number;
};

type FiltersResponse = {
  task_numbers: TaskNumberOption[];
  subtopics: SubtopicOption[];
  authors?: string[];
};

const PER_PAGE = 5000;

const DEFAULT_VPR_GRADES = [7, 8, 10];

function buildQuery(
  level: string,
  vprGrade: number,
  vprAdvanced: boolean,
  extra?: Record<string, string | undefined>
): string {
  const p = new URLSearchParams();
  if (level === "vpr") {
    p.set("grade", String(vprGrade));
    if (vprAdvanced) p.set("advanced", "1");
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
    }
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

const FIPI_FILTER_LEVELS = new Set(["oge", "ege"]);

type AllTasksFilters = {
  level: string;
  subject: SubjectId;
  vprGrade: number;
  vprAdvanced: boolean;
  taskListId: string;
  subtopicId: string;
  onlyFipi: boolean;
  author: string;
  source: "all" | "global" | "mine";
  page: number;
};

function subjectsFromCatalog(catalog: CatalogLevel[], level: string): SubjectDefinition[] {
  const row = catalog.find((item) => item.id === level);
  if (!row?.subjects?.length) return [];
  return row.subjects.map((s) => buildSubjectDefinition(s.id, { title: s.title, comingSoon: false }));
}

const ALL_TASKS_FILTERS_STORAGE_KEY = "itflux:all-tasks-filters:v1";
const ALL_TASKS_FILTER_PARAM_KEYS = [
  "level",
  "subject",
  "grade",
  "advanced",
  "task",
  "subtopic",
  "fipi",
  "author",
  "source",
  "page",
] as const;

function searchParamsHaveFilters(sp: URLSearchParams): boolean {
  return ALL_TASKS_FILTER_PARAM_KEYS.some((key) => {
    const value = sp.get(key);
    return value != null && value !== "";
  });
}

function readFiltersFromSearchParams(
  sp: URLSearchParams,
  catalog: CatalogLevel[],
): AllTasksFilters {
  const levelRaw = (sp.get("level") || "").toLowerCase();
  const catalogLoaded = catalog.length > 0;
  const level = catalogLoaded
    ? (catalog.some((o) => o.id === levelRaw) ? levelRaw : (catalog[0]?.id || "oge"))
    : (levelRaw || "oge");

  const subjects = subjectsFromCatalog(catalog, level);
  const subjectRaw = (sp.get("subject") || "") as SubjectId;
  const subject = catalogLoaded
    ? (subjects.find((s) => s.id === subjectRaw)?.id ?? subjects[0]?.id ?? "inf")
    : (subjectRaw || "inf");

  const grades = (GRADES_BY_LEVEL as Record<string, number[]>).vpr || DEFAULT_VPR_GRADES;
  const gradeRaw = Number(sp.get("grade"));
  const vprGrade =
    level === "vpr" && grades.includes(gradeRaw) ? gradeRaw : (grades[0] ?? 7);
  const vprAdvanced = level === "vpr" && sp.get("advanced") === "1";

  const taskListId = sp.get("task")?.trim() ?? "";
  const subtopicRaw = sp.get("subtopic")?.trim() ?? "";
  const subtopicId = subtopicRaw;
  const usesFipiFilter = FIPI_FILTER_LEVELS.has(level);
  const onlyFipi = usesFipiFilter && sp.get("fipi") === "1";
  const author = sp.get("author")?.trim() ?? "";
  const src = (sp.get("source") || "").trim();
  const source: AllTasksFilters["source"] =
    src === "mine" || src === "global" || src === "all" ? src : "all";
  const page = Math.max(1, Number(sp.get("page")) || 1);

  return { level, subject, vprGrade, vprAdvanced, taskListId, subtopicId, onlyFipi, author, source, page };
}

function writeFiltersToSearchParams(f: AllTasksFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set("level", f.level);
  p.set("subject", f.subject);
  if (f.level === "vpr") {
    p.set("grade", String(f.vprGrade));
    if (f.vprAdvanced) p.set("advanced", "1");
  }
  if (f.taskListId) p.set("task", f.taskListId);
  if (f.subtopicId) p.set("subtopic", f.subtopicId);
  if (FIPI_FILTER_LEVELS.has(f.level)) {
    if (f.onlyFipi) p.set("fipi", "1");
  }
  if (f.author) {
    p.set("author", f.author);
  }
  if (f.source && f.source !== "all") {
    p.set("source", f.source);
  }
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

function loadStoredFilterParams(): URLSearchParams | null {
  try {
    const raw = localStorage.getItem(ALL_TASKS_FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AllTasksFilters>;
    if (!parsed || typeof parsed !== "object") return null;
    return writeFiltersToSearchParams({
      level: String(parsed.level || ""),
      subject: (parsed.subject || "inf") as SubjectId,
      vprGrade: Number(parsed.vprGrade) || 7,
      vprAdvanced: Boolean(parsed.vprAdvanced),
      taskListId: String(parsed.taskListId || ""),
      subtopicId: String(parsed.subtopicId || ""),
      onlyFipi: Boolean(parsed.onlyFipi),
      author: String(parsed.author || ""),
      source:
        parsed.source === "mine" || parsed.source === "global" || parsed.source === "all"
          ? parsed.source
          : "all",
      page: Math.max(1, Number(parsed.page) || 1),
    });
  } catch {
    return null;
  }
}

function persistAllTasksFilters(f: AllTasksFilters) {
  try {
    localStorage.setItem(ALL_TASKS_FILTERS_STORAGE_KEY, JSON.stringify(f));
  } catch {
    /* quota / private mode */
  }
}

function resolveFiltersFromLocation(
  sp: URLSearchParams,
  catalog: CatalogLevel[],
): AllTasksFilters {
  if (!searchParamsHaveFilters(sp)) {
    const stored = loadStoredFilterParams();
    if (stored) return readFiltersFromSearchParams(stored, catalog);
  }
  return readFiltersFromSearchParams(sp, catalog);
}

export default function AllTasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [catalog, setCatalog] = useState<CatalogLevel[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchExamCatalog()
      .then((rows) => {
        if (!cancelled) setCatalog(rows);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      })
      .finally(() => {
        if (!cancelled) setCatalogReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const initialFilters = useMemo(
    () => resolveFiltersFromLocation(searchParams, []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при первом монтировании
    []
  );

  const [level, setLevel] = useState<string>(initialFilters.level);
  const [subject, setSubject] = useState<SubjectId>(initialFilters.subject);
  const [onlyFipi, setOnlyFipi] = useState(initialFilters.onlyFipi);
  const [author, setAuthor] = useState(initialFilters.author);
  const [vprGrade, setVprGrade] = useState<number>(initialFilters.vprGrade);
  const [vprAdvanced, setVprAdvanced] = useState(initialFilters.vprAdvanced);
  const [taskListId, setTaskListId] = useState(initialFilters.taskListId);
  const [subtopicId, setSubtopicId] = useState(initialFilters.subtopicId);
  const [page, setPage] = useState(initialFilters.page);
  const [isTeacher, setIsTeacher] = useState(false);
  const [taskSource, setTaskSource] = useState<"all" | "global" | "mine">(initialFilters.source);
  const [copyBusyId, setCopyBusyId] = useState<number | null>(null);
  const [copyMessage, setCopyMessage] = useState<string>("");
  const [copyMeta, setCopyMeta] = useState<{
    copies_this_period?: number;
    copy_limit?: number | null;
    tasks?: number;
    task_limit?: number | null;
  } | null>(null);
  const { modal: accessModal, openFromError, openGate } = useAccessGate({
    authenticated: isTeacher,
    sourcePage: "/tasks",
  });

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((session) => {
        if (!cancelled) {
          setIsTeacher(!!session?.authenticated && session?.user?.role === "teacher");
        }
      })
      .catch(() => {
        if (!cancelled) setIsTeacher(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTeacher) return undefined;
    let cancelled = false;
    fetchMyTasksMeta()
      .then((meta) => {
        if (!cancelled) setCopyMeta(meta?.usage || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isTeacher]);

  const usesFipiFilter = FIPI_FILTER_LEVELS.has(level);

  const levelSubjectRef = useRef<{ level: string; subject: SubjectId } | null>(
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
  const [lightbox, setLightbox] = useState({ open: false, src: "" });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const img = (e.target as HTMLElement).closest("img");
      if (!img) return;
      const container = img.closest(".all-tasks-item__html");
      if (!container) return;
      e.preventDefault();
      e.stopPropagation();
      setLightbox({ open: true, src: (img as HTMLImageElement).src });
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);
  const [openAnswers, setOpenAnswers] = useState<Record<number, boolean>>({});
  const [pickDraft, setPickDraft] = useState<WorkbookTask[]>([]);
  const [pickMode, setPickMode] = useState<"workbook" | "variant" | null>(null);

  useEffect(() => {
    const pick = searchParams.get("pick");
    const addId = Number(searchParams.get("add") || "");
    if (pick === "variant") {
      setPickMode("variant");
    }
    if (!addId) return undefined;
    let cancelled = false;
    fetchMyTask(addId)
      .then((task) => {
        if (cancelled || !task?.id) return;
        setPickMode("variant");
        if (task.level) setLevel(String(task.level));
        if (task.subject) setSubject(task.subject as SubjectId);
        if (task.task_list_id) setTaskListId(String(task.task_list_id));
        setPickDraft((prev) => {
          if (prev.some((item) => item.id === task.id)) return prev;
          return [
            ...prev,
            toPickDraftTask(task, "variant"),
          ];
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume deep-link once
  }, []);
  const canEditTaskTags = useCanEditTaskTags();
  const canEditBankTasks = useCanEditBankTasks();
  const [tagCatalog, setTagCatalog] = useState<TaskTag[]>([]);
  const [staffGroups, setStaffGroups] = useState<StaffGroupOption[]>([]);
  const [staffSubtopics, setStaffSubtopics] = useState<StaffSubtopicOption[]>([]);
  const [staffGroupId, setStaffGroupId] = useState("");
  const [filtersTick, setFiltersTick] = useState(0);

  useEffect(() => {
    if (!canEditTaskTags) {
      setTagCatalog([]);
      return;
    }
    let cancelled = false;
    fetchTaskTagsCatalog()
      .then((tags) => {
        if (!cancelled) setTagCatalog(tags);
      })
      .catch(() => {
        if (!cancelled) setTagCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canEditTaskTags]);

  useEffect(() => {
    if (!canEditBankTasks) {
      setStaffGroups([]);
      setStaffSubtopics([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchStaffGroups(level, subject),
      fetchStaffSubtopics(level, subject),
    ])
      .then(([groups, subtopics]) => {
        if (cancelled) return;
        setStaffGroups(groups);
        setStaffSubtopics(subtopics);
      })
      .catch(() => {
        if (cancelled) return;
        setStaffGroups([]);
        setStaffSubtopics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canEditBankTasks, level, subject]);

  const reloadStaffCatalog = useCallback((opts?: { refreshFilters?: boolean }) => {
    if (!canEditBankTasks) return Promise.resolve();
    return Promise.all([
      fetchStaffGroups(level, subject),
      fetchStaffSubtopics(level, subject),
    ]).then(([groups, subtopics]) => {
      setStaffGroups(groups);
      setStaffSubtopics(subtopics);
      if (opts?.refreshFilters) {
        setFiltersTick((n) => n + 1);
      }
    });
  }, [canEditBankTasks, level, subject]);

  const handleTaskTagsChange = useCallback((taskId: number, tags: TaskTag[]) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, tags } : t)),
          }
        : prev
    );
    setGroupData((prev) =>
      prev
        ? {
            ...prev,
            instances: prev.instances.map((inst) => ({
              ...inst,
              tasks: inst.tasks.map((t) => (t.id === taskId ? { ...t, tags } : t)),
            })),
          }
        : prev
    );
  }, []);

  const handleStaffTaskSaved = useCallback((patch: StaffTaskPatch) => {
    const apply = (t: BankTask): BankTask =>
      t.id === patch.id
        ? {
            ...t,
            answer: patch.answer,
            task_list_id: patch.task_list_id,
            task_number: patch.task_number,
            task_title: patch.task_title,
            group_id: patch.group_id,
            subtopic_id: patch.subtopic_id,
            subtopic: patch.subtopic,
          }
        : t;
    setData((prev) =>
      prev ? { ...prev, tasks: prev.tasks.map(apply) } : prev
    );
    setGroupData((prev) =>
      prev
        ? {
            ...prev,
            instances: prev.instances.map((inst) => ({
              ...inst,
              tasks: inst.tasks.map(apply),
            })),
          }
        : prev
    );
    void reloadStaffCatalog({ refreshFilters: true });
  }, [reloadStaffCatalog]);

  const handleTagCatalogChange = useCallback((tags: TaskTag[]) => {
    setTagCatalog(tags);
    const alive = new Set(tags.map((t) => t.id));
    const prune = (rowTags?: TaskTag[]) =>
      (rowTags || []).filter((t) => alive.has(t.id));
    setData((prev) =>
      prev
        ? {
            ...prev,
            tasks: prev.tasks.map((t) => ({ ...t, tags: prune(t.tags) })),
          }
        : prev
    );
    setGroupData((prev) =>
      prev
        ? {
            ...prev,
            instances: prev.instances.map((inst) => ({
              ...inst,
              tasks: inst.tasks.map((t) => ({ ...t, tags: prune(t.tags) })),
            })),
          }
        : prev
    );
  }, []);

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

  const openBoardForTask = useCallback((taskId: number) => {
    setOpenBoardForTaskId(taskId);
  }, []);

  const consumeBoardOpenRequest = useCallback(() => {
    setOpenBoardForTaskId(null);
  }, []);

  const handleCopyToBank = useCallback(
    async (task: BankTask) => {
      if (!isTeacher) {
        openGate({
          reason: "anonymous",
          resourceType: "teacher_tasks",
          requiredPlan: "start",
          sourcePage: "copy",
          returnUrl: "/tasks/my",
        });
        return;
      }
      setCopyBusyId(task.id);
      setCopyMessage("");
      try {
        const copy = await copyGlobalTaskToMyBank(task.id);
        setCopyMessage(
          `Скопировано в мой банк: ${copy.public_code || `№${copy.local_number}`}`
        );
        setCopyMeta((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            copies_this_period: (prev.copies_this_period || 0) + 1,
            tasks: (prev.tasks || 0) + 1,
          };
        });
      } catch (err) {
        if (!openFromError(err, { sourcePage: "copy" })) {
          setCopyMessage(err instanceof Error ? err.message : "Не удалось скопировать");
        }
      } finally {
        setCopyBusyId(null);
      }
    },
    [isTeacher, openFromError, openGate]
  );

  const subjects = useMemo(() => subjectsFromCatalog(catalog, level), [catalog, level]);
  const levelOptions = catalog;
  const levelDef = getLevelDef(level);
  const levelTitle = levelOptions.find((row) => row.id === level)?.label
    || levelDef?.title
    || level.toUpperCase();
  /** Таблица «Раздел / Содержание» — только школьная программа → программирование. */
  const useProgTaskSheet = level === "school" && subject === "prog";

  const subtopicsForTask = useMemo(() => {
    if (!filterOptions && !(canEditBankTasks && taskListId)) return [];
    if (!taskListId) {
      return (filterOptions?.subtopics ?? []).filter(
        (s) => s.task_list_id == null && (String(s.id) === "none" || String(s.id) === "no-answer")
      );
    }
    const tlId = Number(taskListId);
    const fromFilters = (filterOptions?.subtopics ?? []).filter(
      (s) => s.task_list_id === tlId && s.id != null
    );
    if (!canEditBankTasks) return fromFilters;
    const seen = new Set(fromFilters.map((s) => String(s.id)));
    const extras: SubtopicOption[] = staffSubtopics
      .filter((s) => s.task_list_id === tlId && !seen.has(String(s.id)))
      .map((s) => ({
        id: s.id,
        title: s.title,
        task_list_id: s.task_list_id,
        task_number: s.task_number ?? null,
        task_count: s.task_count ?? 0,
      }));
    return extras.length ? [...fromFilters, ...extras] : fromFilters;
  }, [canEditBankTasks, filterOptions, staffSubtopics, taskListId]);

  useEffect(() => {
    if (!catalogReady) return;
    const payload: AllTasksFilters = {
      level,
      subject,
      vprGrade,
      vprAdvanced,
      taskListId,
      subtopicId,
      onlyFipi: usesFipiFilter ? onlyFipi : false,
      author,
      source: taskSource,
      page,
    };
    persistAllTasksFilters(payload);
    const next = writeFiltersToSearchParams(payload);
    setSearchParams((prev) => (prev.toString() === next.toString() ? prev : next), {
      replace: true,
    });
  }, [catalogReady, level, subject, vprGrade, vprAdvanced, taskListId, subtopicId, onlyFipi, author, taskSource, page, usesFipiFilter, setSearchParams]);

  useEffect(() => {
    if (!catalogReady || !catalog.length) return;
    const next = resolveFiltersFromLocation(searchParams, catalog);
    if (!catalog.some((row) => row.id === level)) {
      setLevel(next.level);
      setSubject(next.subject);
      return;
    }
    const list = subjectsFromCatalog(catalog, level);
    if (!list.some((s) => s.id === subject)) {
      setSubject(list[0]?.id ?? next.subject);
      return;
    }
    if (level === "vpr") {
      const grades = (GRADES_BY_LEVEL as Record<string, number[]>).vpr || DEFAULT_VPR_GRADES;
      if (grades.length && !grades.includes(vprGrade)) {
        setVprGrade(grades[0]);
      }
    }
    const prev = levelSubjectRef.current;
    if (prev && (prev.level !== level || prev.subject !== subject)) {
      setTaskListId("");
      setSubtopicId("");
      setPage(1);
      if (FIPI_FILTER_LEVELS.has(level)) {
        setAuthor("");
      } else {
        setOnlyFipi(false);
      }
    }
    levelSubjectRef.current = { level, subject };
  }, [catalog, catalogReady, level, subject, vprGrade, searchParams]);

  useEffect(() => {
    if (filtersLoading || !filterOptions || !taskListId) return;
    const ok = filterOptions.task_numbers.some(
      (t) => String(t.task_list_id) === taskListId
    );
    if (!ok) setTaskListId("");
  }, [filterOptions, taskListId, filtersLoading]);

  useEffect(() => {
    let cancelled = false;
    const url = `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/tasks/${buildQuery(level, vprGrade, vprAdvanced, {
      source: isTeacher && taskSource !== "global" ? taskSource : undefined,
    })}`;

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
  }, [level, subject, vprGrade, vprAdvanced, isTeacher, taskSource]);

  useEffect(() => {
    let cancelled = false;
    setFiltersLoading(true);
    const qs = buildQuery(level, vprGrade, vprAdvanced, {
      task_list_id: taskListId || undefined,
      source: isTeacher && taskSource !== "global" ? taskSource : undefined,
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
  }, [level, subject, vprGrade, vprAdvanced, taskListId, filtersTick, isTeacher, taskSource]);

  useEffect(() => {
    if (!subtopicId) return;
    const inFilters = subtopicsForTask.some((s) => String(s.id) === subtopicId);
    const inStaff = staffSubtopics.some((s) => String(s.id) === subtopicId);
    if (!inFilters && !inStaff) setSubtopicId("");
  }, [staffSubtopics, subtopicsForTask, subtopicId]);

  useEffect(() => {
    if (!author) return;
    const authors = filterOptions?.authors ?? [];
    if (authors.length && !authors.includes(author)) {
      setAuthor("");
    }
  }, [filterOptions, author]);

  const fetchTasks = useCallback(async () => {
    if (!staffGroupId && !taskListId && !subtopicId) {
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
    const onlyFipiParam = usesFipiFilter && onlyFipi ? "1" : undefined;
    const authorParam = author ? author : undefined;

    try {
      if (staffGroupId) {
        const qs = buildQuery(level, vprGrade, vprAdvanced, {
          page: String(page),
          per_page: String(PER_PAGE),
          only_fipi: onlyFipiParam,
          author: authorParam,
          group_id: staffGroupId,
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
        setActiveGroupDescriptor({
          linkedKey: staffGroupId,
          taskNumbers: [],
          label: `Группа ${staffGroupId}`,
        });
      } else if (groupDescriptor) {
        const qs = buildQuery(level, vprGrade, vprAdvanced, {
          page: String(page),
          per_page: String(PER_PAGE),
          only_fipi: onlyFipiParam,
          author: authorParam,
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
        const qs = buildQuery(level, vprGrade, vprAdvanced, {
          page: String(page),
          per_page: String(PER_PAGE),
          raw_html: undefined,
          only_fipi: onlyFipiParam,
          author: authorParam,
          task_list_id: taskListId || undefined,
          subtopic_id: subtopicId || undefined,
          source: isTeacher && taskSource !== "global" ? taskSource : undefined,
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
    author,
    usesFipiFilter,
    page,
    vprGrade,
    vprAdvanced,
    taskListId,
    subtopicId,
    staffGroupId,
    groupByTaskListId,
    isTeacher,
    taskSource,
  ]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    setOpenAnswers({});
  }, [level, subject, vprGrade, vprAdvanced, taskListId, subtopicId, staffGroupId, onlyFipi, author, page]);

  useEffect(() => {
    setPickMode(null);
    setPickDraft([]);
    setStaffGroupId("");
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
    const subtitleParts = [levelTitle, subjectTitle];

    if (level === "vpr") {
      subtitleParts.push(`${vprGrade} класс`);
      subtitleParts.push(vprAdvanced ? "углублённый" : "базовый");
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
      level: level,
    };
  }, [
    filterOptions?.task_numbers,
    level,
    levelTitle,
    subject,
    subjectTitle,
    taskListId,
    vprGrade,
    vprAdvanced,
  ]);

  const togglePickGroup = useCallback((tasks: BankTask[], checked: boolean) => {
    if (checked) {
      setPickDraft((prev) => {
        const existing = new Set(prev.map((item) => item.id));
        const next = [...prev];
        for (const task of tasks) {
          if (existing.has(task.id)) continue;
          existing.add(task.id);
          next.push(toPickDraftTask(task, pickMode));
        }
        return next;
      });
      return;
    }
    const removeIds = new Set(tasks.map((task) => task.id));
    setPickDraft((prev) => prev.filter((item) => !removeIds.has(item.id)));
  }, [pickMode]);

  const togglePickTask = useCallback((task: BankTask, checked: boolean) => {
    if (checked) {
      setPickDraft((prev) => {
        if (prev.some((item) => item.id === task.id)) return prev;
        return [...prev, toPickDraftTask(task, pickMode)];
      });
      return;
    }
    setPickDraft((prev) => prev.filter((item) => item.id !== task.id));
  }, [pickMode]);

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
        next.push(toPickDraftTask(task, pickMode));
      }
      return next;
    });
  }, [pickMode, visibleTasks]);

  const resetPage = () => setPage(1);

  // TEMP: кнопка «Код» временно скрыта
  const showCodeSidebar = false;
  // const showCodeSidebar = isInformaticsCodeEditorContext(level, subject);
  const showTagsSidebar = canEditTaskTags;
  const showStaffSidebar = canEditBankTasks;
  const showSidebars = showTagsSidebar || showStaffSidebar;

  // const getCodeEditorTaskSources = useCallback((): TaskFileSource[] => {
  //   return (data?.tasks ?? [])
  //     .filter((t) => t.file_url)
  //     .slice(0, 80)
  //     .map((t) => ({
  //       id: t.id,
  //       label: t.task_number != null ? `№${t.task_number} · id ${t.id}` : `id ${t.id}`,
  //       fileUrl: t.file_url,
  //     }));
  // }, [data?.tasks]);

  return (
    <div className="digital-flow-page">
      <div
        className={[
          "digital-flow-page__wrap",
          showCodeSidebar ? "digital-flow-page__wrap--with-code-sidebar" : "",
          showSidebars ? "digital-flow-page__wrap--with-tags-sidebar" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <main
          className={`all-tasks-page${pickMode ? " all-tasks-page--workbook-mode" : ""}`}
          data-level={level}
          data-subject={subject}
        >
          {accessModal}
          <button
            type="button"
            className="all-tasks-filters-toggle"
            aria-expanded={filtersOpen}
            aria-controls="all-tasks-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <span>Фильтры</span>
            <span className="all-tasks-filters-toggle__meta">
              {levelTitle}
              {level === "vpr" && vprAdvanced ? " · углублённый" : ""}
              {usesFipiFilter && onlyFipi ? " · ФИПИ" : ""}
              {author ? ` · ${author}` : ""}
            </span>
          </button>

          <div
            id="all-tasks-filters"
            className={`all-tasks-filters${filtersOpen ? " is-open" : ""}`}
            style={{ "--filter-accent": levelDef?.bg ?? "#2b52f5" } as CSSProperties}
          >
            {isTeacher ? (
              <div className="all-tasks-filter" style={{ minWidth: "100%", maxWidth: "100%" }}>
                <span className="all-tasks-filter__label">Источник задач</span>
                <div className="mtb-chips" style={{ marginBottom: 0 }}>
                  {([
                    ["all", "Все", ""],
                    ["global", "Общий банк", "mtb-chip--platform"],
                    ["mine", "Мои задачи", "mtb-chip--mine"],
                  ] as const).map(([id, label, tone]) => (
                      <button
                        key={id}
                        type="button"
                        className={`mtb-chip ${tone}${taskSource === id ? " is-active" : ""}`.trim()}
                        onClick={() => {
                          setTaskSource(id);
                          resetPage();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                </div>
                {copyMessage ? <p className="all-tasks-meta">{copyMessage}</p> : null}
                {copyMeta?.copy_limit != null
                  && copyMeta.copy_limit - (copyMeta.copies_this_period || 0) === 1 ? (
                  <p className="all-tasks-meta">Осталось 1 копирование в этом месяце</p>
                ) : null}
              </div>
            ) : null}
            <label className="all-tasks-filter">
              <span className="all-tasks-filter__label">Уровень</span>
              <select
                className="all-tasks-filter__control"
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value);
                  setTaskListId("");
                  setSubtopicId("");
                  resetPage();
                }}
              >
                {levelOptions.map((opt) => (
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
              <>
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
                    {((GRADES_BY_LEVEL as Record<string, number[]>).vpr || DEFAULT_VPR_GRADES).map((g) => (
                      <option key={g} value={g}>
                        {g} класс
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
                      checked={vprAdvanced}
                      onChange={(e) => {
                        setVprAdvanced(e.target.checked);
                        resetPage();
                      }}
                    />
                    <span
                      className={`tasks-page-subtopic-checkbox-visual${vprAdvanced ? " selected" : ""}`}
                      aria-hidden
                    />
                    <span>Углублённый уровень</span>
                  </span>
                </label>
              </>
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
                  setStaffGroupId("");
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
                disabled={filtersLoading || (!taskListId && subtopicsForTask.length === 0)}
                onChange={(e) => {
                  setSubtopicId(e.target.value);
                  resetPage();
                }}
              >
                <option value="">Все подтемы</option>
                {subtopicsForTask.map((s) => (
                  <option key={String(s.id)} value={String(s.id)}>
                    {s.title}
                    {` (${s.task_count})`}
                  </option>
                ))}
              </select>
            </label>

            {usesFipiFilter ? (
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
            ) : null}
            {isTeacher || !usesFipiFilter ? (
              <label className="all-tasks-filter">
                <span className="all-tasks-filter__label">Автор</span>
                <select
                  className="all-tasks-filter__control"
                  value={author}
                  disabled={filtersLoading}
                  onChange={(e) => {
                    setAuthor(e.target.value);
                    resetPage();
                  }}
                >
                  <option value="">Все</option>
                  {(filterOptions?.authors ?? []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
                const noAnswerOnly = subtopicId === "no-answer";
                const selectedSubtopic = subtopicId
                  ? noAnswerOnly
                    ? null
                    : subtopicsForTask.find((s) => String(s.id) === subtopicId)
                  : null;
                return (
                  <div className="all-tasks-meta__inner">
                    <span className="all-tasks-meta__count">
                      {bankUsesGroups ? formatGroupsCount(visibleTotal) : formatTasksCount(visibleTotal)}
                      {usesFipiFilter && onlyFipi ? " · только ФИПИ" : ""}
                      {author ? ` · ${author}` : ""}
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

          {!staffGroupId && !taskListId && !subtopicId && !loading && !error ? (
            <div className="all-tasks-empty all-tasks-empty--pick" role="status">
              <p className="all-tasks-empty__title">Выберите задание</p>
              <p className="all-tasks-empty__lead">
                {canEditBankTasks
                  ? "Выберите группу или подтему справа либо номер в фильтре «Задание»."
                  : "Укажите номер в фильтре «Задание», чтобы показать задачи из банка."}
              </p>
            </div>
          ) : null}

          {(taskListId || staffGroupId || subtopicId) && !loading && !error && displayEntries.length === 0 ? (
            <p className="all-tasks-empty" role="status">
              {staffGroupId && !taskListId
                ? "В этой группе пока нет заданий. Добавьте их в карточке задания."
                : `По выбранным фильтрам заданий нет. Смените задание, подтему${
                    usesFipiFilter
                      ? " или снимите «Только ФИПИ»."
                      : author
                        ? " или сбросьте фильтр «Автор»."
                        : "."
                  }`}
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
                const groupInPick = entry.tasks.every((task) =>
                  pickDraftIds.has(task.id)
                );
                return (
                  <AllTasksGroupItem
                    key={`group-${entry.groupId}`}
                    groupId={entry.groupId}
                    tasks={entry.tasks}
                    subdivision={(entry as { subdivision?: string | null }).subdivision}
                    pickMode={Boolean(pickMode)}
                    inPick={groupInPick}
                    onToggleGroup={togglePickGroup}
                    subject={subject}
                    level={level}
                    useProgTaskSheet={useProgTaskSheet}
                    boardsByTask={boardsByTask}
                    openAnswers={openAnswers}
                    openBoardForTaskId={openBoardForTaskId}
                    boardPersistHasDraft={boardPersistHasDraft}
                    onOpenBoard={openBoardForTask}
                    onBoardPersist={handleBoardPersist}
                    onConsumedBoardOpenRequest={consumeBoardOpenRequest}
                    canEditTaskTags={canEditTaskTags}
                    tagCatalog={tagCatalog}
                    onTaskTagsChange={handleTaskTagsChange}
                    canEditBankTasks={canEditBankTasks}
                    taskLists={filterOptions?.task_numbers ?? EMPTY_STAFF_TASK_LISTS}
                    staffGroups={staffGroups}
                    staffSubtopics={staffSubtopics}
                    onStaffSaved={handleStaffTaskSaved}
                    onToggleAnswer={toggleAnswer}
                  />
                );
              }

              const t = entry.task;
              const taskNumber = t.task_number ?? entryIndex + 1;
              const taskBoardPersist = boardsByTask[String(t.id)];
              return (
                <AllTasksBankItem
                  key={t.id}
                  task={t}
                  taskNumber={taskNumber}
                  pickMode={Boolean(pickMode)}
                  inPick={pickDraftIds.has(t.id)}
                  onTogglePick={togglePickTask}
                  isTeacher={isTeacher}
                  copyBusy={copyBusyId === t.id}
                  onCopyToBank={handleCopyToBank}
                  useProgTaskSheet={useProgTaskSheet}
                  hasTaskBoardDraft={boardPersistHasDraft(taskBoardPersist)}
                  onOpenBoard={openBoardForTask}
                  subject={subject}
                  level={level}
                  persistEntry={taskBoardPersist}
                  openBoardRequested={openBoardForTaskId === t.id}
                  onBoardPersist={handleBoardPersist}
                  onConsumedBoardOpenRequest={consumeBoardOpenRequest}
                  canEditTaskTags={canEditTaskTags}
                  tagCatalog={tagCatalog}
                  onTaskTagsChange={handleTaskTagsChange}
                  canEditBankTasks={canEditBankTasks}
                  taskLists={filterOptions?.task_numbers ?? EMPTY_STAFF_TASK_LISTS}
                  staffGroups={staffGroups}
                  staffSubtopics={staffSubtopics}
                  onStaffSaved={handleStaffTaskSaved}
                  answerOpen={!!openAnswers[t.id]}
                  onToggleAnswer={toggleAnswer}
                />
              );
            })}
          </ul>

        </main>

        {showSidebars ? (
          <div className="all-tasks-sidebars">
            {showStaffSidebar ? (
              <AllTasksStaffCatalogSidebar
                groups={staffGroups}
                subtopics={staffSubtopics}
                taskLists={filterOptions?.task_numbers ?? []}
                selectedTaskListId={taskListId}
                selectedGroupId={staffGroupId}
                selectedSubtopicId={subtopicId}
                onSelectTaskList={(id) => {
                  setTaskListId(id);
                  setSubtopicId("");
                  setStaffGroupId("");
                  resetPage();
                }}
                onRenameTaskList={async (taskListPk, title) => {
                  const updated = await updateStaffTaskList(level, subject, taskListPk, title);
                  const nextTitle = updated.task_title || title;
                  setFilterOptions((prev) =>
                    prev
                      ? {
                          ...prev,
                          task_numbers: prev.task_numbers.map((row) =>
                            row.task_list_id === taskListPk
                              ? { ...row, task_title: nextTitle }
                              : row
                          ),
                        }
                      : prev
                  );
                  const applyTitle = (t: BankTask): BankTask =>
                    t.task_list_id === taskListPk ? { ...t, task_title: nextTitle } : t;
                  setData((prev) =>
                    prev ? { ...prev, tasks: prev.tasks.map(applyTitle) } : prev
                  );
                  setGroupData((prev) =>
                    prev
                      ? {
                          ...prev,
                          instances: prev.instances.map((inst) => ({
                            ...inst,
                            tasks: inst.tasks.map(applyTitle),
                          })),
                        }
                      : prev
                  );
                  await reloadStaffCatalog({ refreshFilters: true });
                }}
                onSelectGroup={(id) => {
                  setStaffGroupId(id);
                  setTaskListId("");
                  setSubtopicId("");
                  resetPage();
                }}
                onSelectSubtopic={(item) => {
                  setStaffGroupId("");
                  if (item.task_list_id != null) {
                    setTaskListId(String(item.task_list_id));
                  }
                  setSubtopicId(String(item.id));
                  resetPage();
                }}
                onCreateGroup={async () => {
                  const created = await createStaffGroup(level, subject);
                  await reloadStaffCatalog({ refreshFilters: true });
                  setStaffGroupId(String(created.id));
                  setTaskListId("");
                  setSubtopicId("");
                  resetPage();
                }}
                onCreateSubtopic={async (title, taskListPk, fromTask) => {
                  const created = await createStaffSubtopic(
                    level,
                    subject,
                    fromTask
                      ? { task_list_id: taskListPk, from_task: true }
                      : { title, task_list_id: taskListPk }
                  );
                  await reloadStaffCatalog({ refreshFilters: true });
                  setStaffGroupId("");
                  if (created.task_list_id != null) {
                    setTaskListId(String(created.task_list_id));
                  }
                  setSubtopicId(String(created.id));
                  resetPage();
                }}
              />
            ) : null}
            {showTagsSidebar ? (
              <AllTasksTagsCatalogSidebar
                tags={tagCatalog}
                onTagsChange={handleTagCatalogChange}
              />
            ) : null}
          </div>
        ) : null}

        {/* TEMP: кнопка «Код» временно скрыта
        {showCodeSidebar ? (
          <Suspense fallback={null}>
            <InformaticsCodeEditorEntry getTaskSources={getCodeEditorTaskSources} />
          </Suspense>
        ) : null}
        */}
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
      <ImageLightbox
        src={lightbox.src}
        open={lightbox.open}
        onClose={() => setLightbox((s) => ({ ...s, open: false }))}
      />
    </div>
  );
}
