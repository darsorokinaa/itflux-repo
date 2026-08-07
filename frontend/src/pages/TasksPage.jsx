import { useState, useEffect, useRef, useLayoutEffect } from "react";
import {
  useParams,
  useNavigate,
  useSearchParams,
  Navigate,
  useLocation,
} from "react-router-dom";
import { FileText, Target, CircleHelp } from "lucide-react";

const SUBJECT_NAMES = {
  inf: "Информатика",
  history: "История",
  rus: "Русский язык",
  chem: "Химия",
  phys: "Физика",
  lit: "Литература",
  bio: "Биология",
};

/** Заголовок предмета: «профильная/базовая» только ЕГЭ; ОГЭ — всегда «Математика». */
/** ОГЭ / ЕГЭ / как в URL для прочих уровней */
function formatExamLevelRu(lv) {
  const k = String(lv || "").toLowerCase();
  if (k === "oge") return "ОГЭ";
  if (k === "ege") return "ЕГЭ";
  if (k === "vpr") return "ВПР";
  return (lv || "").toString().toUpperCase();
}

function formatSubjectDisplayName(level, subjectKey, rawName) {
  const lv = String(level || "").toLowerCase();
  const sub = String(subjectKey || "").toLowerCase();
  if (lv === "oge" && (sub === "math" || sub === "math_base")) return "Математика";
  if (lv === "ege" && sub === "math") return "Математика (профильная)";
  if (lv === "ege" && sub === "math_base") return "Математика (базовая)";
  return rawName != null && rawName !== ""
    ? rawName
    : (SUBJECT_NAMES[subjectKey] || subjectKey);
}

/** Предложный падеж для заголовка «Вариант по …» (по ключу из URL). */
function subjectPrepPhraseForVariantTitle(level, subjectKey) {
  const sub = String(subjectKey || "").toLowerCase();
  const lv = String(level || "").toLowerCase();
  const prepByKey = {
    inf: "информатике",
    history: "истории",
    rus: "русскому языку",
    chem: "химии",
    phys: "физике",
    lit: "литературе",
    bio: "биологии",
    math: "математике",
    math_base: "математике",
  };
  const prep = prepByKey[sub];
  if (!prep) return null;
  if (lv === "ege" && sub === "math") return `${prep} (профильная)`;
  if (lv === "ege" && sub === "math_base") return `${prep} (базовая)`;
  return prep;
}

function itemsIncludeTaskNumber(items, n) {
  for (const item of items) {
    if (item.type === "group" || item.type === "linked_group") {
      const nums = item.task_numbers || item.tasks?.map((t) => t.task_number) || [];
      if (nums.includes(n)) return true;
    } else if (item.task_number === n) return true;
  }
  return false;
}

const PART_VARIANT_HINTS = {
  1: "Краткие ответы и базовая экзаменационная часть.",
  2: "Задания с развёрнутым ответом: учитель выбирает критерии и ставит баллы.",
};

function partTitleFromTasks(items, partNum, getPart, getTitle) {
  for (const item of items) {
    if (Number(getPart(item)) !== Number(partNum)) continue;
    const title = getTitle(item);
    if (title) return title;
  }
  return "";
}

function collectAvailableParts(items, getPart) {
  const parts = new Set();
  for (const item of items) {
    const part = getPart(item);
    if (part != null && part !== "") parts.add(Number(part));
  }
  return [...parts].sort((a, b) => a - b);
}

/** Query для API ВПР: класс и углублённость (advanced 0/1). */
function vprApiQueryString(level, searchParams) {
  if (String(level || "").toLowerCase() !== "vpr") return "";
  const p = new URLSearchParams();
  const g = searchParams.get("grade");
  if (g) p.set("grade", g);
  p.set("advanced", searchParams.get("advanced") === "1" ? "1" : "0");
  return `?${p.toString()}`;
}

function TasksPage() {
  const { level, subject } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const pathNorm = (location.pathname || "").replace(/\/+$/, "") || "/";
  const isLessonJoinPath =
    (String(level || "").toLowerCase() === "lesson" &&
      String(subject || "").toLowerCase() === "join") ||
    pathNorm.toLowerCase() === "/lesson/join";

  const searchQuery = searchParams.get("search")?.trim() ?? "";
  const vprAdvanced =
    String(level || "").toLowerCase() === "vpr" && searchParams.get("advanced") === "1";
  const [tasks, setTasks] = useState([]);
  const [subjectNameFromApi, setSubjectNameFromApi] = useState(() =>
    formatSubjectDisplayName(level, subject, SUBJECT_NAMES[subject] || subject)
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [prepActionError, setPrepActionError] = useState(null);

  /** Подтемы для тренажёра: список по номерам заданий (только для одиночных заданий) */
  const [subtopicsByTask, setSubtopicsByTask] = useState([]);
  /** Выбранные id подтем — при непустом списке в тренажёре только задачи по этим подтемам */
  const [selectedSubtopicIds, setSelectedSubtopicIds] = useState([]);
  /** Подтемы показываются только после клика по номеру задания */
  const [subtopicsPanelOpen, setSubtopicsPanelOpen] = useState(false);
  /** Идентификатор номера, чьи подтемы сейчас отображаются (заменяется при выборе нового номера) */
  const [activeForSubtopics, setActiveForSubtopics] = useState(null);
  const subtopicsBlockRef = useRef(null);
  /** Количество задач по подтеме (id подтемы → число) */
  const [subtopicCounts, setSubtopicCounts] = useState({});

  /** Блок 2: счётчики по task_N / group_N */
  const [testCounts, setTestCounts] = useState({});
  /** Счётчики по подтемам для групп: { [identifier]: { [subtopicId]: count } } */
  const [groupSubtopicCounts, setGroupSubtopicCounts] = useState({});
  /** Фильтры «Только задачи ФИПИ» */
  const [onlyFipiVariant, setOnlyFipiVariant] = useState(false);
  const [onlyFipiTrainer, setOnlyFipiTrainer] = useState(false);
  /** ОГЭ инф. №13: одна подтема (радио) — id выбранной SubTopic */
  const [ogeInf13SubtopicId, setOgeInf13SubtopicId] = useState(null);
  /** Макет v2: выбранная структура варианта перед «Сгенерировать» */
  const [prepVariantChoice, setPrepVariantChoice] = useState("full");
  /** Подсветка карточек режима (вариант / тренировка) */
  const [prepModeFocus, setPrepModeFocus] = useState("variant");
  /** Левая колонка «как это работает» скрыта по умолчанию */
  const [showPrepIntro, setShowPrepIntro] = useState(true);
  const [submitBlock1, setSubmitBlock1] = useState(false);
  const [submitBlock2, setSubmitBlock2] = useState(false);

  const variantSectionRef = useRef(null);
  const trainerSectionRef = useRef(null);

  const vprQs = vprApiQueryString(level, searchParams);

  const appendVprOptions = (payload) => {
    if (String(level || "").toLowerCase() !== "vpr") return payload;
    const next = { ...payload };
    const g = searchParams.get("grade");
    if (g && /^\d+$/.test(String(g).trim())) next.vpr_grade = parseInt(String(g).trim(), 10);
    next.vpr_advanced = searchParams.get("advanced") === "1";
    return next;
  };

  useLayoutEffect(() => {
    document.body.classList.add("tasks-prep-v2-active");
    return () => document.body.classList.remove("tasks-prep-v2-active");
  }, []);

  useEffect(() => {
    if (!tasks.length) return;

    const parts = collectAvailableParts(tasks, (item) =>
      item.type === "group" || item.type === "linked_group"
        ? item.tasks?.[0]?.part
        : item.part
    );
    if (!parts.length) return;

    if (subject === "inf" && level === "ege") {
      setPrepVariantChoice(parts.length > 1 ? "full" : parts.includes(2) ? "part2" : "full");
      return;
    }

    if (parts.length === 1) {
      setPrepVariantChoice(`part${parts[0]}`);
      return;
    }

    setPrepVariantChoice((prev) => {
      const match = /^part(\d+)$/.exec(prev);
      if (match && parts.includes(Number(match[1]))) return prev;
      if (prev === "full") return "full";
      return "full";
    });
  }, [tasks, subject, level]);

  useEffect(() => {
    if (isLessonJoinPath) return undefined;
    let cancelled = false;
    fetch(`/api/${level}/${subject}/subtopics/${vprQs}`)
      .then((res) => (res.ok ? res.json() : { subtopics_by_task: [] }))
      .then((data) => {
        if (!cancelled) {
          setSubtopicsByTask(data.subtopics_by_task || []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSubtopicsByTask([]);
        }
      });
    return () => { cancelled = true; };
  }, [level, subject, isLessonJoinPath, vprQs]);

  useEffect(() => {
    if (isLessonJoinPath) return;
    if (level !== "oge" || subject !== "inf") {
      setOgeInf13SubtopicId(null);
      return;
    }
    const b = subtopicsByTask.find((row) => row.task_number === 13);
    const subs = b?.subtopics;
    if (!subs?.length) {
      setOgeInf13SubtopicId(null);
      return;
    }
    const ids = new Set(subs.map((st) => st.id));
    setOgeInf13SubtopicId((prev) => (prev != null && ids.has(prev) ? prev : subs[0].id));
  }, [level, subject, subtopicsByTask, isLessonJoinPath]);

  useEffect(() => {
    if (isLessonJoinPath) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSubjectNameFromApi(
      formatSubjectDisplayName(level, subject, SUBJECT_NAMES[subject] || subject)
    );
    fetch(`/api/${level}/${subject}/tasks/${vprQs}`)
      .then((res) => {
        if (res.status === 404) {
          throw new Error(
            "Предмет не найден в базе: нет записи Subject с таким subject_short (как в URL). Добавьте предмет в админке Django или выполните миграции (0035 создаёт history, если его ещё нет)."
          );
        }
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setTasks(data.tasks || []);
        setSubjectNameFromApi(
          formatSubjectDisplayName(
            level,
            subject,
            data.subject_name || SUBJECT_NAMES[subject] || subject
          )
        );
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || "Ошибка загрузки");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [level, subject, isLessonJoinPath, vprQs]);

  // На мобильных прокрутить к блоку подтем при открытии
  useEffect(() => {
    if (subtopicsPanelOpen && subtopicsByTask.length > 0 && (activeForSubtopics || Object.keys(testCounts).some((id) => (testCounts[id] ?? 0) > 0))) {
      const t = setTimeout(() => {
        subtopicsBlockRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [subtopicsPanelOpen, subtopicsByTask.length, testCounts, activeForSubtopics]);

  if (isLessonJoinPath) {
    return <Navigate to={{ pathname: "/lesson/join/", search: location.search }} replace />;
  }

  const matchesSearch = (item) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    if (item.type === "group" || item.type === "linked_group") {
      return (item.tasks || []).some(
        (t) =>
          (/^\d+$/.test(q) && t.task_number === parseInt(q, 10)) ||
          ((t.task_title || "").toLowerCase()).includes(q)
      );
    }
    if (/^\d+$/.test(q) && item.task_number === parseInt(q, 10)) return true;
    return ((item.task_title || "").toLowerCase()).includes(q);
  };

  const getItemPart = (item) =>
    item.type === "group" || item.type === "linked_group"
      ? item.tasks?.[0]?.part
      : item.part;

  // Определяем, есть ли у TaskList задачи автора ФИПИ (по данным подтем)
  const hasFipiForTaskList = (taskListId) => {
    const block = subtopicsByTask.find((b) => b.task_list_id === taskListId);
    if (!block) return false;
    return (block.subtopics || []).some((st) => (st.fipi_task_count ?? 0) > 0);
  };

  // ФИПИ-элемент: у одиночного номера или любой части группы есть хотя бы одна задача ФИПИ
  const isFipiItem = (item) => {
    if (item.type === "linked_group" || item.type === "group") {
      const ids = (item.tasks || []).map((t) => t.tasklist_id).filter(Boolean);
      return ids.some((id) => hasFipiForTaskList(id));
    }
    return hasFipiForTaskList(item.id);
  };

  // Для генерации варианта: при включённом фильтре берём только ФИПИ-элементы
  const tasksForVariant =
    onlyFipiVariant && subtopicsByTask.length > 0 ? tasks.filter(isFipiItem) : tasks;

  // Для тренажёра: фильтр ФИПИ + поиск по номеру/названию
  const tasksForTrainer =
    (onlyFipiTrainer && subtopicsByTask.length > 0 ? tasks.filter(isFipiItem) : tasks).filter(matchesSearch);

  const ogeInf13Block =
    level === "oge" && subject === "inf"
      ? subtopicsByTask.find((row) => row.task_number === 13)
      : null;

  const showOgeInf13VariantAside = (ogeInf13Block?.subtopics?.length ?? 0) >= 2;

  const ogeInf13SelectionError = (items) => {
    if (level !== "oge" || subject !== "inf") return null;
    const subs = ogeInf13Block?.subtopics;
    if (!subs || subs.length < 2) return null;
    if (!itemsIncludeTaskNumber(items, 13)) return null;
    if (ogeInf13SubtopicId == null || !subs.some((st) => st.id === ogeInf13SubtopicId)) {
      return "Выберите тип задания 13: текст или презентация.";
    }
    return null;
  };

  const postVariant = (payload, mode = "variant", extra = {}) => {
    setPrepActionError(null);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120000);
    return fetch(`/api/${level}/${subject}/variant/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: controller.signal,
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        window.clearTimeout(timeoutId);
        const text = await res.text();
        let data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error(
              res.ok
                ? "Сервер вернул некорректный ответ. Обновите страницу и попробуйте снова."
                : `Не удалось сформировать вариант (${res.status || "ошибка сервера"})`
            );
          }
        }
        if (!res.ok) {
          throw new Error(data?.error || res.statusText || "Не удалось сформировать вариант");
        }
        if (!data?.variant_id) {
          throw new Error("Сервер не вернул номер варианта");
        }
        return data;
      })
      .then((data) => {
        navigate(`/${level}/${subject}/variant/${data.variant_id}`, {
          state: { mode, subjectName: subjectNameFromApi, ...extra },
        });
      })
      .catch((err) => {
        window.clearTimeout(timeoutId);
        if (err?.name === "AbortError") {
          throw new Error("Сервер не ответил вовремя. Проверьте, что Django запущен на :8000.");
        }
        throw err;
      });
  };

  const handleVariantGenerationError = (err) => {
    const message = err?.message || "Не удалось сформировать вариант";
    setPrepActionError(message);
  };

  const warnEmptyVariantPayload = (items, partLabel) => {
    if (Object.keys(payloadFromTasks(items)).length > 0) return false;
    const fipiHint =
      onlyFipiVariant && subtopicsByTask.length > 0
        ? " Снимите «Только ФИПИ» или выберите другую часть."
        : "";
    setPrepActionError(
      partLabel
        ? `Для «${partLabel}» нет доступных заданий.${fipiHint}`
        : `Нет заданий для формирования варианта.${fipiHint}`
    );
    return true;
  };

  const payloadFromTasks = (items) => {
    const payload = {};
    items.forEach((item) => {
      if (item.type === "group" && item.tasks?.length) {
        item.tasks.forEach((t) => {
          const tid = t.tasklist_id ?? t.id;
          payload[String(tid)] = 1;
        });
      } else if (item.type === "linked_group" && item.tasks?.length) {
        item.tasks.forEach((t) => {
          payload[String(t.tasklist_id)] = 1;
        });
      } else {
        payload[String(item.id)] = 1;
      }
    });
    return payload;
  };

  /** Полный payload для варианта: content + tasks (для групп) + subtopic_ids при выборе подтем */
  const buildVariantPayload = (items) => {
    const content = payloadFromTasks(items);
    const payload = { content, ...(onlyFipiVariant ? { only_fipi: true } : {}) };

    if (selectedSubtopicIds.length > 0) {
      payload.subtopic_ids = selectedSubtopicIds;
      const tasksList = [];
      items.forEach((item) => {
        if ((item.type === "group" || item.type === "linked_group") && item.tasks?.length) {
          const nums = item.task_numbers || item.tasks.map((t) => t.task_number);
          const identifier = item.type === "linked_group" ? `linked_${item.linked_key}` : `group_${item.group_id}`;
          const bySt = groupSubtopicCounts[identifier];
          const entry = { task_numbers: nums, count: 1 };
          if (bySt && Object.keys(bySt).length > 0) {
            entry.subtopic_ids = Object.keys(bySt)
              .filter((k) => k !== "all")
              .map(Number)
              .filter((n) => !Number.isNaN(n));
            entry.subtopic_counts = { ...bySt };
          } else {
            const groupSubtopicIds = (item.subtopics || []).map((st) => st.id).filter(Boolean);
            entry.subtopic_ids = selectedSubtopicIds.filter((id) => groupSubtopicIds.includes(id));
          }
          tasksList.push(entry);
        }
      });
      if (tasksList.length > 0) payload.tasks = tasksList;
    }

    if (
      level === "oge" &&
      subject === "inf" &&
      itemsIncludeTaskNumber(items, 13) &&
      ogeInf13SubtopicId != null
    ) {
      const b = subtopicsByTask.find((row) => row.task_number === 13);
      const subs = b?.subtopics;
      if (subs && subs.length >= 2) {
        payload.oge_inf_13_subtopics = [ogeInf13SubtopicId];
      }
    }

    return appendVprOptions(payload);
  };

  const onPart = (partNum) => {
    const items = onlyFipiVariant
      ? tasks.filter((item) => getItemPart(item) === partNum).filter(isFipiItem)
      : tasksForVariant.filter((item) => getItemPart(item) === partNum && matchesSearch(item));
    const err13 = ogeInf13SelectionError(items);
    if (err13) {
      setPrepActionError(err13);
      return;
    }
    const payload = buildVariantPayload(items);
    const emptyLabel =
      partTitleFromTasks(
        items,
        partNum,
        getItemPart,
        (item) =>
          item.type === "linked_group" || item.type === "group"
            ? item.tasks?.[0]?.part_title
            : item.part_title
      ) || `Часть ${partNum}`;
    if (warnEmptyVariantPayload(items, emptyLabel)) return;
    setSubmitBlock1(true);
    postVariant(payload, `part${partNum}`)
      .catch(handleVariantGenerationError)
      .finally(() => setSubmitBlock1(false));
  };
  const onChooseAll = () => {
    const items = tasksForVariant;
    const err13 = ogeInf13SelectionError(items);
    if (err13) {
      setPrepActionError(err13);
      return;
    }
    const payload = buildVariantPayload(items);
    if (warnEmptyVariantPayload(items, "Полный вариант")) return;
    setSubmitBlock1(true);
    postVariant(payload, "variant")
      .catch(handleVariantGenerationError)
      .finally(() => setSubmitBlock1(false));
  };

  const runPrepVariantGeneration = () => {
    if (prepVariantChoice === "full") {
      onChooseAll();
      return;
    }
    const match = /^part(\d+)$/.exec(prepVariantChoice);
    if (match) {
      onPart(Number(match[1]));
    }
  };

  const buildPayloadFromTestCounts = () => {
    const content = {};
    const tasksList = [];
    const itemsById = Object.fromEntries(
      tasks.map((item) => [getIdentifier(item), item])
    );
    const allowedIds = new Set(
      (onlyFipiTrainer && subtopicsByTask.length > 0 ? tasks.filter(isFipiItem) : tasks).map(getIdentifier)
    );
    const useSubtopicCounts = selectedSubtopicIds.length > 0;
    const idsWithCount = tasks
      .map(getIdentifier)
      .filter((id) => allowedIds.has(id) && getEffectiveTaskCount(id) > 0);
    for (const identifier of idsWithCount) {
      const count = getEffectiveTaskCount(identifier);
      const item = itemsById[identifier];
      if (!item) continue;
      if (identifier.startsWith("task_")) {
        let slotCount = count;
        if (useSubtopicCounts && subtopicsByTask.length) {
          const block = subtopicsByTask.find((b) => b.task_list_id === item.id);
          if (block?.subtopics) {
            slotCount = block.subtopics
              .filter((st) => selectedSubtopicIds.includes(st.id))
              .reduce((sum, st) => sum + getCappedSubtopicCount(st), 0);
          }
        }
        if (slotCount <= 0) continue;
        content[String(item.id)] = slotCount;
        tasksList.push({ tasklist_id: item.id, task_number: item.task_number, count: slotCount });
      } else if (identifier.startsWith("linked_") && item.tasks?.length) {
        const nums = item.task_numbers || item.tasks.map((t) => t.task_number);
        const bySt = groupSubtopicCounts[identifier];
        const groupCount = bySt ? Object.values(bySt).reduce((sum, val) => sum + (val || 0), 0) : count;
        item.tasks.forEach((t) => {
          const tlId = t.tasklist_id ?? t.id;
          if (tlId != null) content[String(tlId)] = Math.max(content[String(tlId)] || 0, groupCount);
        });
        const entry = { task_numbers: nums, count: groupCount };
        if (bySt && Object.keys(bySt).length > 0) {
          entry.subtopic_ids = Object.keys(bySt)
            .filter((k) => k !== "all")
            .map(Number)
            .filter((n) => !Number.isNaN(n));
          entry.subtopic_counts = { ...bySt };
        }
        tasksList.push(entry);
      } else if (identifier.startsWith("group_") && item.tasks?.length) {
        const nums = item.task_numbers || item.tasks.map((t) => t.task_number);
        const bySt = groupSubtopicCounts[identifier];
        const groupCount = bySt ? Object.values(bySt).reduce((sum, val) => sum + (val || 0), 0) : count;
        item.tasks.forEach((t) => {
          const tlId = t.tasklist_id ?? t.id;
          if (tlId != null) content[String(tlId)] = Math.max(content[String(tlId)] || 0, groupCount);
        });
        const entry = { task_numbers: nums, count: groupCount };
        if (bySt && Object.keys(bySt).length > 0) {
          entry.subtopic_ids = Object.keys(bySt)
            .filter((k) => k !== "all")
            .map(Number)
            .filter((n) => !Number.isNaN(n));
          entry.subtopic_counts = { ...bySt };
        }
        tasksList.push(entry);
      }
    }
    const payload = {
      content,
      tasks: tasksList,
      ...(onlyFipiTrainer ? { only_fipi: true } : {}),
    };
    if (useSubtopicCounts) {
      payload.subtopic_ids = selectedSubtopicIds;
      const counts = {};
      selectedSubtopicIds.forEach((id) => {
        const st = subtopicsByTask.flatMap((b) => b.subtopics || []).find((s) => s.id === id);
        const n = st ? getCappedSubtopicCount(st) : (subtopicCounts[id] ?? 0);
        if (n > 0) counts[id] = n;
      });
      if (Object.keys(counts).length) payload.subtopic_counts = counts;
    }
    return appendVprOptions(payload);
  };

  const toggleSubtopic = (subtopicId) => {
    setSelectedSubtopicIds((prev) =>
      prev.includes(subtopicId)
        ? prev.filter((id) => id !== subtopicId)
        : [...prev, subtopicId]
    );
  };

  const changeSubtopicCount = (subtopicId, delta, maxCount) => {
    setSubtopicCounts((prev) => {
      const cur = prev[subtopicId] ?? 0;
      const next = Math.max(0, Math.min(maxCount, cur + delta));
      const nextState = { ...prev };
      if (next > 0) nextState[subtopicId] = next;
      else delete nextState[subtopicId];

      setSelectedSubtopicIds((selPrev) => {
        const currentSelected = selPrev.includes(subtopicId);
        if (next > 0 && !currentSelected) return [...selPrev, subtopicId];
        if (next === 0 && currentSelected) return selPrev.filter((id) => id !== subtopicId);
        return selPrev;
      });

      return nextState;
    });
  };

  const changeGroupSubtopicCount = (identifier, subtopicId, delta, maxCount) => {
    setGroupSubtopicCounts((prev) => {
      const byId = prev[identifier] ?? {};
      const cur = byId[subtopicId] ?? 0;
      const next = Math.max(0, Math.min(maxCount, cur + delta));
      const nextById = { ...byId };
      if (next > 0) nextById[subtopicId] = next;
      else delete nextById[subtopicId];
      const nextState = { ...prev };
      if (Object.keys(nextById).length > 0) nextState[identifier] = nextById;
      else delete nextState[identifier];
      return nextState;
    });
  };

  /** Ввод количества в поле: пусто → 0; нечисло — игнор; clamp 0..max; 0000002 → 2 */
  const parseTrainerCountInput = (raw, maxCount) => {
    const max = Math.max(0, Math.floor(Number(maxCount)) || 0);
    const t = String(raw ?? "").trim();
    if (t === "") return 0;
    if (/^\d+$/.test(t)) {
      if (/^0+$/.test(t)) return 0;
      const normalized = t.replace(/^0+/, "") || "0";
      const n = parseInt(normalized, 10);
      if (Number.isNaN(n)) return null;
      return Math.max(0, Math.min(max, n));
    }
    const n = parseInt(t, 10);
    if (Number.isNaN(n)) return null;
    return Math.max(0, Math.min(max, n));
  };

  const applyGroupSubtopicCountInput = (identifier, subtopicId, raw, maxCount) => {
    const next = parseTrainerCountInput(raw, maxCount);
    if (next === null) return;
    setGroupSubtopicCounts((prev) => {
      const byId = { ...(prev[identifier] ?? {}) };
      if (next <= 0) delete byId[subtopicId];
      else byId[subtopicId] = next;
      const nextState = { ...prev };
      if (Object.keys(byId).length > 0) nextState[identifier] = byId;
      else delete nextState[identifier];
      return nextState;
    });
  };

  const applySubtopicCountInput = (subtopicId, raw, maxCount) => {
    const next = parseTrainerCountInput(raw, maxCount);
    if (next === null) return;
    setSubtopicCounts((prev) => {
      const nextState = { ...prev };
      if (next <= 0) delete nextState[subtopicId];
      else nextState[subtopicId] = next;
      return nextState;
    });
    setSelectedSubtopicIds((selPrev) => {
      const has = selPrev.includes(subtopicId);
      if (next > 0 && !has) return [...selPrev, subtopicId];
      if (next === 0 && has) return selPrev.filter((id) => id !== subtopicId);
      return selPrev;
    });
  };

  const applyGroupedSubtopicTotalInput = (ids, raw, maxCount) => {
    const nextTotal = parseTrainerCountInput(raw, maxCount);
    if (nextTotal === null || !ids.length) return;
    const perId = Math.floor(nextTotal / ids.length);
    const remainder = nextTotal % ids.length;
    setSubtopicCounts((prev) => {
      const next = { ...prev };
      ids.forEach((id, i) => {
        const v = perId + (i < remainder ? 1 : 0);
        if (v > 0) next[id] = v;
        else delete next[id];
      });
      return next;
    });
    setSelectedSubtopicIds((prev) => {
      if (nextTotal > 0) return [...new Set([...prev, ...ids])];
      return prev.filter((id) => !ids.includes(id));
    });
  };

  const onStartTest = () => {
    const payload = buildPayloadFromTestCounts();
    if (!payload.tasks?.length) {
      setPrepActionError("Выберите хотя бы один номер задания в сетке.");
      return;
    }
    setPrepActionError(null);
    setSubmitBlock2(true);
    const testTaskLabels = testSelectedIdsSorted.map((id) => identifierToLabel[id] ?? id);
    postVariant(payload, "test", { testTaskLabels })
      .catch(handleVariantGenerationError)
      .finally(() => setSubmitBlock2(false));
  };

  const getIdentifier = (item) => {
    if (item.type === "linked_group") return `linked_${item.linked_key}`;
    if (item.type === "group") return `group_${item.group_id}`;
    return `task_${item.id}`;
  };

  const getTestCount = (identifier) => testCounts[identifier] ?? 0;

  const getMaxCount = (item) => {
    if (item.type === "linked_group") {
      const avail = Number(item.count_available) || 0;
      if (avail > 0) return avail;
      const submax = Math.max(0, ...(item.subtopics || []).map((s) => s.display_count ?? s.group_count ?? 0));
      return submax;
    }
    if (item.type === "group") {
      if (!item.tasks?.length) return 0;
      const counts = item.tasks.map((t) => Number(t.count_task) || 0);
      return Math.min(...counts, Infinity);
    }
    return Number(item.count_task) || 0;
  };

  const changeTestCount = (item, delta) => {
    const identifier = getIdentifier(item);
    const max = getMaxCount(item);
    const hasGroupSubtopics =
      (item.type === "linked_group" || item.type === "group") &&
      Array.isArray(item.subtopics) &&
      item.subtopics.length > 1;
    if (hasGroupSubtopics) {
      setGroupSubtopicCounts((prev) => {
        const byId = prev[identifier] ?? {};
        const curTotal = Object.values(byId).reduce((s, n) => s + (n || 0), 0);
        const nextTotal = Math.max(0, Math.min(max, curTotal + delta));
        if (nextTotal === 0) {
          const nextState = { ...prev };
          delete nextState[identifier];
          return nextState;
        }
        if (delta > 0) {
          const nextById = { ...byId };
          nextById.all = Math.min(max, (nextById.all ?? 0) + delta);
          return { ...prev, [identifier]: nextById };
        }
        const nextById = { ...byId };
        let toRemove = curTotal - nextTotal;
        const keys = Object.keys(nextById).sort((a, b) => (nextById[b] ?? 0) - (nextById[a] ?? 0));
        for (const k of keys) {
          if (toRemove <= 0) break;
          const v = nextById[k] ?? 0;
          const dec = Math.min(v, toRemove);
          if (dec > 0) {
            nextById[k] = v - dec;
            toRemove -= dec;
            if (nextById[k] === 0) delete nextById[k];
          }
        }
        return Object.keys(nextById).length > 0 ? { ...prev, [identifier]: nextById } : (() => { const s = { ...prev }; delete s[identifier]; return s; })();
      });
    } else {
      setTestCounts((prev) => {
        const cur = prev[identifier] ?? 0;
        const next = Math.max(0, Math.min(max, cur + delta));
        const nextState = { ...prev };
        if (next > 0) nextState[identifier] = next;
        else delete nextState[identifier];
        return nextState;
      });
    }
  };

  /** При «Только ФИПИ» — не больше fipi_task_count по подтеме */
  const getCappedSubtopicCount = (st) => {
    const raw = subtopicCounts[st.id] ?? 0;
    if (!onlyFipiTrainer || typeof st.fipi_task_count !== "number") return raw;
    return Math.min(raw, st.fipi_task_count);
  };

  /** Эффективное кол-во задач для идентификатора */
  const getEffectiveTaskCount = (identifier) => {
    const item = tasks.find((t) => getIdentifier(t) === identifier);
    if (!item) return 0;
    const useSubtopicBreakdown =
      selectedSubtopicIds.length > 0 && subtopicsByTask.length > 0;
    if (identifier.startsWith("task_") && useSubtopicBreakdown) {
      const block = subtopicsByTask.find((b) => b.task_list_id === item.id);
      if (block?.subtopics) {
        return block.subtopics
          .filter((st) => selectedSubtopicIds.includes(st.id))
          .reduce((sum, st) => sum + getCappedSubtopicCount(st), 0);
      }
    }
    if ((identifier.startsWith("linked_") || identifier.startsWith("group_")) && groupSubtopicCounts[identifier]) {
      return Object.values(groupSubtopicCounts[identifier]).reduce((s, n) => s + (n || 0), 0);
    }
    return testCounts[identifier] ?? 0;
  };

  const testSelectedIds = tasks.map(getIdentifier).filter((id) => getEffectiveTaskCount(id) > 0);
  const testTotal = testSelectedIds.reduce((sum, id) => sum + getEffectiveTaskCount(id), 0);

  const getLabel = (item) => {
    if ((item.type === "group" || item.type === "linked_group") && item.tasks?.length) {
      const nums = item.task_numbers || item.tasks.map((t) => t.task_number);
      return `${Math.min(...nums)}–${Math.max(...nums)}`;
    }
    return String(item.task_number ?? item.id);
  };

  const identifierToLabel = Object.fromEntries(
    tasks.map((item) => [getIdentifier(item), getLabel(item)])
  );
  const identifierToSortKey = Object.fromEntries(
    tasks.map((item) => [
      getIdentifier(item),
      (item.type === "group" || item.type === "linked_group") && item.tasks?.length
        ? Math.min(...(item.task_numbers || item.tasks.map((t) => t.task_number)))
        : (item.task_number ?? 0),
    ])
  );
  const testSelectedIdsSorted = [...testSelectedIds].sort(
    (a, b) => (identifierToSortKey[a] ?? 0) - (identifierToSortKey[b] ?? 0)
  );

  const getTaskCountForIdentifier = (identifier) => getEffectiveTaskCount(identifier);

  const prepShell = (main) => (
    <div
      className={`tasks-prep-shell${showPrepIntro ? " tasks-prep-shell--intro-open" : ""}`}
    >
      <aside
        id="prep-intro-panel"
        className="tasks-prep-intro"
        aria-label="Подготовка к экзамену"
        aria-hidden={!showPrepIntro}
      >
        <div className="tasks-prep-intro-content">
          <div className="tasks-prep-intro-eyebrow">Подготовка к экзамену</div>
          <h2 className="tasks-prep-intro-title">Соберите нужный формат за пару кликов</h2>
          <p className="tasks-prep-intro-lead">
            Экран разделён на два сценария: полноценный вариант и точечная тренировка по номерам.
            Выберите структуру или номера задач и запускайте генерацию или тест.
          </p>
          <div className="tasks-prep-intro-list">
            <div className="tasks-prep-intro-item">
              <span className="tasks-prep-intro-dot">1</span>
              <span>Нажмите «Экзаменационный вариант» или «Тренировка по номерам» — откроется нужный блок.</span>
            </div>
            <div className="tasks-prep-intro-item">
              <span className="tasks-prep-intro-dot">2</span>
              <span>В варианте выберите часть или полный вариант; в тренажёре нажмите номер и при необходимости настройте подтемы.</span>
            </div>
            <div className="tasks-prep-intro-item">
              <span className="tasks-prep-intro-dot">3</span>
              <span>Сгенерируйте вариант или начните тестирование.</span>
            </div>
          </div>
          <div className="tasks-prep-intro-actions">
            <button
              type="button"
              className="tasks-prep-how-btn tasks-prep-how-btn--inside"
              aria-expanded={showPrepIntro}
              aria-controls="prep-intro-panel"
              onClick={() => setShowPrepIntro(false)}
            >
              Скрыть инструкцию
            </button>
          </div>
        </div>
      </aside>
      <div className="tasks-prep-main">
          {!showPrepIntro ? (
            <div className="tasks-prep-intro-reveal">
              <button
                type="button"
                className="tasks-prep-how-btn"
                aria-expanded={showPrepIntro}
                aria-controls="prep-intro-panel"
                onClick={() => setShowPrepIntro(true)}
              >
                Показать инструкцию
              </button>
            </div>
          ) : null}
          {main}
      </div>
    </div>
  );

  const prepDigitalWrap = (content) => (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <div className="tasks-page tasks-page--prep-v2 tasks-prep-flow">{content}</div>
      </div>
    </div>
  );

  if (loading) {
    return prepDigitalWrap(
      prepShell(<p className="tasks-prep-state-text">Загрузка заданий…</p>),
    );
  }

  if (error) {
    return prepDigitalWrap(prepShell(<p className="error">{error}</p>));
  }

  const variantPartsAvailable = collectAvailableParts(tasksForVariant, getItemPart);
  const hasMultipleVariantParts = variantPartsAvailable.length > 1;
  const countTasksInPart = (partNum) =>
    tasksForVariant.filter((item) => getItemPart(item) === partNum && matchesSearch(item)).length;
  const labelForPartNum = (partNum) =>
    partTitleFromTasks(
      tasksForVariant,
      partNum,
      getItemPart,
      (item) =>
        item.type === "linked_group" || item.type === "group"
          ? item.tasks?.[0]?.part_title
          : item.part_title
    ) || `Часть ${partNum}`;
  const variantPartsLabel = variantPartsAvailable.map(labelForPartNum).join(" + ");
  const variantModeDescription = hasMultipleVariantParts
    ? `${variantPartsAvailable.map(labelForPartNum).join(", ")} или полный вариант в формате ${formatExamLevelRu(level)}.`
    : variantPartsAvailable.length === 1
      ? `Вариант «${labelForPartNum(variantPartsAvailable[0])}» в формате ${formatExamLevelRu(level)}.`
      : `Экзаменационный вариант в формате ${formatExamLevelRu(level)}.`;
  const selectedLevelLabel =
    String(level || "").toLowerCase() === "vpr"
      ? "Школьная программа"
      : formatExamLevelRu(level);
  const selectedVprGrade = searchParams.get("grade");

  return prepDigitalWrap(
    <>
      {tasks.length === 0 ? (
        <p className="tasks-page-empty-hint" role="status">
          Для этого предмета и уровня в базе пока нет ни одного задания в списке номеров. Добавьте записи TaskList и задачи в админке — после этого здесь появятся кнопки и генерация вариантов.
        </p>
      ) : null}
      {prepShell(
        <>
          <section className="tasks-prep-selection-meta" aria-label="Выбранные параметры">
            <span className="tasks-prep-selection-pill">
              <strong>Предмет:</strong> {subjectNameFromApi}
            </span>
            <span className="tasks-prep-selection-pill">
              <strong>Уровень:</strong> {selectedLevelLabel}
            </span>
            {String(level || "").toLowerCase() === "vpr" ? (
              <>
                <span className="tasks-prep-selection-pill">
                  <strong>Класс:</strong> {selectedVprGrade ? `${selectedVprGrade} класс` : "не выбран"}
                </span>
                <span className="tasks-prep-selection-pill">
                  <strong>Режим:</strong> {vprAdvanced ? "углублённый" : "базовый"}
                </span>
              </>
            ) : null}
          </section>

          <section className="tasks-prep-format-section" aria-label="Выбор формата работы">
            <div className="tasks-prep-mode-row" role="radiogroup" aria-label="Сценарий подготовки">
            <label
              className={`tasks-prep-mode-card tasks-prep-mode-card--variant${
                prepModeFocus === "variant" ? " tasks-prep-mode-card--active" : ""
              }`}
            >
              <input
                type="radio"
                name="prep-scenario-focus"
                className="tasks-prep-mode-radio-input"
                checked={prepModeFocus === "variant"}
                onChange={() => {
                  setPrepActionError(null);
                  setPrepModeFocus("variant");
                }}
              />
              {prepModeFocus === "variant" ? (
                <span className="tasks-prep-mode-selected-badge">Выбрано</span>
              ) : null}
              <span className="tasks-prep-mode-card-icon" aria-hidden>
                <FileText size={20} strokeWidth={2} />
              </span>
              <span className="tasks-prep-mode-card-title">Экзаменационный вариант</span>
              <p className="tasks-prep-mode-card-text">
                {variantModeDescription}
              </p>
            </label>
            <label
              className={`tasks-prep-mode-card tasks-prep-mode-card--trainer${
                prepModeFocus === "trainer" ? " tasks-prep-mode-card--active" : ""
              }`}
            >
              <input
                type="radio"
                name="prep-scenario-focus"
                className="tasks-prep-mode-radio-input"
                checked={prepModeFocus === "trainer"}
                onChange={() => {
                  setPrepActionError(null);
                  setPrepModeFocus("trainer");
                }}
              />
              {prepModeFocus === "trainer" ? (
                <span className="tasks-prep-mode-selected-badge">Выбрано</span>
              ) : null}
              <span className="tasks-prep-mode-card-icon" aria-hidden>
                <Target size={20} strokeWidth={2} />
              </span>
              <span className="tasks-prep-mode-card-title">Тренировка по номерам</span>
              <p className="tasks-prep-mode-card-text">
                Отработка конкретных заданий, тем и слабых мест ученика.
              </p>
            </label>
            </div>
          </section>

          <section className="tasks-prep-workspace">
            {(prepActionError || submitBlock1 || submitBlock2) ? (
              <div
                className={`tasks-prep-status-banner${
                  prepActionError ? " tasks-prep-status-banner--error" : " tasks-prep-status-banner--info"
                }`}
                role={prepActionError ? "alert" : "status"}
                aria-live="polite"
              >
                {prepActionError
                  ? prepActionError
                  : submitBlock1
                    ? "Формируем вариант…"
                    : "Запускаем тестирование…"}
              </div>
            ) : null}
            <div className={`tasks-prep-workspace-head${prepModeFocus === "trainer" ? " tasks-prep-workspace-head--trainer" : ""}`}>
              <div className="tasks-prep-workspace-head-text">
                <h2 id="prep-work-heading" className="tasks-prep-workspace-title">
                  {prepModeFocus === "variant" ? "Соберите вариант" : "Тренажёр по номерам"}
                </h2>
                <p className="tasks-prep-workspace-lead">
                  {prepModeFocus === "variant"
                    ? hasMultipleVariantParts
                      ? "Выберите часть работы и источник заданий."
                      : "Выберите источник заданий и сгенерируйте вариант."
                    : "Выберите номера заданий в сетке, затем настройте количество и подтемы справа."}
                </p>
              </div>
              <div className="tasks-prep-source-block">
                <div className="tasks-prep-source-label-row">
                  <span className="tasks-prep-source-label">Источник заданий</span>
                  <span className="tasks-prep-fipi-help">
                    <span
                      className="tasks-prep-tooltip-trigger"
                      tabIndex={0}
                      role="button"
                      aria-label="Справка: только ФИПИ"
                    >
                      <CircleHelp size={16} strokeWidth={2} aria-hidden />
                    </span>
                    <span className="tasks-prep-tooltip-bubble" role="tooltip">
                      Показывать только задания из официального банка ФИПИ
                    </span>
                  </span>
                </div>
                <label className="tasks-prep-checkbox">
                  <input
                    type="checkbox"
                    className="tasks-page-subtopic-checkbox-input"
                    checked={
                      prepModeFocus === "variant" ? onlyFipiVariant : onlyFipiTrainer
                    }
                    onChange={(e) => {
                      const on = e.target.checked;
                      if (prepModeFocus === "variant") {
                        setOnlyFipiVariant(on);
                      } else {
                        setOnlyFipiTrainer(on);
                      }
                    }}
                  />
                  <span
                    className={`tasks-page-subtopic-checkbox-visual ${
                      (prepModeFocus === "variant" ? onlyFipiVariant : onlyFipiTrainer)
                        ? "selected"
                        : ""
                    }`}
                    aria-hidden
                  />
                  <span className="tasks-prep-checkbox-text">Только ФИПИ</span>
                </label>
              </div>
            </div>

            <div className="tasks-prep-workspace-body">
              {prepModeFocus === "variant" ? (
              <div ref={variantSectionRef} className="tasks-prep-variant-shell">
                <div
                  className={`tasks-prep-variant-compose${
                    showOgeInf13VariantAside ? "" : " tasks-prep-variant-compose--no-side"
                  }`}
                >
                <div className="tasks-prep-format-stack">
                  {variantPartsAvailable.map((partNum) => {
                    const choice = `part${partNum}`;
                    const partBlocked = submitBlock1 || (partNum === 1 && subject === "inf" && level === "ege");
                    const partTitle = partTitleFromTasks(
                      tasksForVariant,
                      partNum,
                      getItemPart,
                      (item) =>
                        item.type === "linked_group" || item.type === "group"
                          ? item.tasks?.[0]?.part_title
                          : item.part_title
                    );
                    const partLabel = partTitle || `Часть ${partNum}`;
                    const isSpeaking = /говорен|устн|speaking|oral/i.test(partLabel);
                    const hint =
                      PART_VARIANT_HINTS[partNum] ||
                      (isSpeaking
                        ? "Устная часть: учитель выбирает критерии и ставит баллы."
                        : `Задания «${partLabel}».`);
                    return (
                      <button
                        key={choice}
                        type="button"
                        className={`tasks-prep-format-option${prepVariantChoice === choice ? " is-active" : ""}`}
                        disabled={partBlocked}
                        onClick={() => {
                          setPrepActionError(null);
                          setPrepVariantChoice(choice);
                        }}
                        aria-pressed={prepVariantChoice === choice}
                      >
                        <div className={`tasks-prep-format-mark tasks-prep-format-mark--p${Math.min(partNum, 2)}`}>
                          {isSpeaking ? "У" : partNum}
                        </div>
                        <div>
                          <span className="tasks-prep-format-title">{partLabel}</span>
                          <p className="tasks-prep-format-text">{hint}</p>
                        </div>
                        <span className="tasks-prep-format-meta">
                          {countTasksInPart(partNum)}
                          {" "}
                          в списке
                        </span>
                      </button>
                    );
                  })}
                  {hasMultipleVariantParts ? (
                  <button
                    type="button"
                    className={`tasks-prep-format-option${prepVariantChoice === "full" ? " is-active" : ""}`}
                    disabled={submitBlock1}
                    onClick={() => {
                      setPrepActionError(null);
                      setPrepVariantChoice("full");
                    }}
                    aria-pressed={prepVariantChoice === "full"}
                  >
                    <div className="tasks-prep-format-mark tasks-prep-format-mark--full">+</div>
                    <div>
                      <span className="tasks-prep-format-title">Полный вариант</span>
                      <p className="tasks-prep-format-text">
                        Полная структура варианта: {variantPartsLabel}.
                      </p>
                    </div>
                    <span className="tasks-prep-format-meta">{variantPartsLabel}</span>
                  </button>
                  ) : null}
                </div>
                {showOgeInf13VariantAside ? (
                  <aside className="tasks-prep-side-box tasks-prep-side-box--white">
                    <div
                      className="tasks-page-oge-inf13-radios"
                      role="radiogroup"
                      aria-label="Задание 13: один вариант — текст или презентация"
                    >
                      <span className="tasks-page-oge-inf13-radios-title">Задание 13</span>
                      <div className="tasks-page-oge-inf13-radios-row">
                        {ogeInf13Block.subtopics.map((st) => {
                          const selected = ogeInf13SubtopicId === st.id;
                          return (
                            <label
                              key={st.id}
                              className="tasks-page-oge-inf13-row-item tasks-page-subtopic-label"
                            >
                              <input
                                type="radio"
                                name="oge-inf13-subtopic"
                                className="tasks-page-subtopic-checkbox-input"
                                checked={selected}
                                onChange={() => setOgeInf13SubtopicId(st.id)}
                              />
                              <span
                                className={`tasks-page-subtopic-checkbox-visual ${selected ? "selected" : ""}`}
                                aria-hidden
                              />
                              <span className="tasks-page-oge-inf13-option-text">{st.title}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </aside>
                ) : null}
                </div>
                <div className="subject-pick__actions tasks-prep-variant-generate">
                  <button
                    type="button"
                    className="subject-pick__cta"
                    disabled={submitBlock1}
                    onClick={runPrepVariantGeneration}
                  >
                    {submitBlock1 ? "Формируем…" : "Сгенерировать вариант"}
                  </button>
                </div>
              </div>
              ) : (
              <div ref={trainerSectionRef} className="tasks-prep-trainer-panel">
                <div className="tasks-prep-trainer-compose">
                  <div className="tasks-prep-numbers-board">
                    <div className="tasks-prep-numbers-head">
                      <p className="tasks-prep-selected-line">
                        Выбранные номера:
                        {" "}
                        <span>
                          {testSelectedIdsSorted.length
                            ? testSelectedIdsSorted
                                .map((id) => {
                                  const label = identifierToLabel[id] ?? id;
                                  const n = getTaskCountForIdentifier(id);
                                  return n > 0 ? `${label} (${n})` : label;
                                })
                                .join(", ")
                            : "—"}
                        </span>
                      </p>
                      <div className="tasks-prep-counter-pill" title="Всего задач">
                        {testTotal}
                      </div>
                    </div>
                    <div className="tasks-page-numbers-grid">
          {tasksForTrainer.map((item) => {
            const identifier = getIdentifier(item);
            const count = getEffectiveTaskCount(identifier);
            const max = getMaxCount(item);
            const label = getLabel(item);
            const isActive = activeForSubtopics === identifier;

            // Для linked_group: всегда открываем панель (подтемы или «Все типы задач»)
            // Для task_: только если есть подтемы
            // Для group_: всегда открываем панель
            const hasSubtopics =
              (identifier.startsWith("task_") && subtopicsByTask.some((b) => b.task_list_id === item.id)) ||
              identifier.startsWith("linked_") ||
              identifier.startsWith("group_");

            return (
              <div key={identifier} className="tasks-page-number-cell">
                <button
                  type="button"
                  className={`tasks-page-number-btn${count > 0 || (isActive && hasSubtopics) ? " selected" : ""}${isActive && hasSubtopics ? " tasks-page-number-btn--panel-open" : ""}`}
                  onClick={() => {
                    if (hasSubtopics) {
                      if (count === 0 && !isActive) {
                        setActiveForSubtopics(identifier);
                        setSubtopicsPanelOpen(true);
                      } else if (count > 0 && !isActive) {
                        // Уже есть задачи по этому номеру, но панель на другом — только переключить подтемы, не снимать выбор
                        setActiveForSubtopics(identifier);
                        setSubtopicsPanelOpen(true);
                      } else if (count > 0 || isActive) {
                        setActiveForSubtopics((prev) => (prev === identifier ? testSelectedIds.find((id) => id !== identifier) ?? null : prev));
                        if (count > 0) changeTestCount(item, -1);
                      }
                    } else {
                      setSubtopicsPanelOpen(true);
                      if (count === 0 && max > 0) {
                        setActiveForSubtopics(identifier);
                        changeTestCount(item, 1);
                      } else if (count > 0) {
                        setActiveForSubtopics((prev) => (prev === identifier ? testSelectedIds.find((id) => id !== identifier) ?? null : prev));
                        changeTestCount(item, -1);
                      }
                    }
                  }}
                  disabled={getMaxCount(item) <= 0}
                  title={
                    !hasSubtopics
                      ? undefined
                      : count > 0 && !isActive
                        ? "Показать подтемы этого номера"
                        : count > 0 || (isActive && hasSubtopics)
                          ? "Убрать из выбора"
                          : "Показать панель"
                  }
                >
                  {label}
                </button>
              </div>
            );
          })}
                    </div>
                  </div>
                  <aside className="tasks-prep-trainer-aside">
                    <h3 className="tasks-prep-amount-title">
                      {subtopicsPanelOpen && activeForSubtopics
                        ? `Настройка задания №${
                            identifierToLabel[activeForSubtopics] ?? activeForSubtopics
                          }`
                        : "Настройка задания"}
                    </h3>
                    {subtopicsPanelOpen && activeForSubtopics ? (
                      <div ref={subtopicsBlockRef} className="tasks-page-subtopics tasks-prep-subtopics-clip">
                        <div className="tasks-page-subtopics-list tasks-page-subtopics-column">
              {(function () {
                const it = tasks.find((t) => getIdentifier(t) === activeForSubtopics);
                if (!it) return null;

                // --- Linked-группа и обычная group: только подтемы, счёт — подгруппы ---
                if ((it.type === "linked_group" || it.type === "group") && it.tasks?.length) {
                  const subtopics = it.subtopics || [];
                  const bySt = groupSubtopicCounts[activeForSubtopics] ?? {};

                  if (subtopics.length === 0) {
                    return (
                      <div className="tasks-page-subtopic-row">
                        <span className="tasks-page-subtopic-title">Нет подтем у групп</span>
                      </div>
                    );
                  }

                  return (
                    <>
                      {subtopics.map((st) => {
                        const stId = st.id;
                        const stCount = bySt[stId] ?? 0;
                        const stMax = st.display_count ?? st.group_count ?? 0;
                        const isChecked = stCount > 0;
                        return (
                          <div key={stId ?? `null_${st.title}`} className="tasks-page-subtopic-row">
                            <label className="tasks-page-subtopic-label">
                              <input
                                type="checkbox"
                                className="tasks-page-subtopic-checkbox-input"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    changeGroupSubtopicCount(activeForSubtopics, stId, -stCount, stMax);
                                  } else {
                                    changeGroupSubtopicCount(activeForSubtopics, stId, 1, stMax);
                                  }
                                }}
                              />
                              <span
                                className={`tasks-page-subtopic-checkbox-visual ${isChecked ? "selected" : ""}`}
                                aria-hidden
                              />
                              <span className="tasks-page-subtopic-title">{st.title}</span>
                            </label>
                            <div className="tasks-page-subtopic-counter-wrap">
                              <input
                                type="number"
                                inputMode="numeric"
                                step={1}
                                min={0}
                                max={stMax}
                                className="tasks-page-subtopic-num tasks-page-subtopic-num-input"
                                title={`Сколько задач (не больше ${stMax} в базе)`}
                                aria-label={`Количество для ${st.title}`}
                                value={stCount}
                                disabled={stMax <= 0}
                                onChange={(e) =>
                                  applyGroupSubtopicCountInput(
                                    activeForSubtopics,
                                    stId,
                                    e.target.value,
                                    stMax
                                  )
                                }
                              />
                              <span className="tasks-page-subtopic-of">{`задач из ${stMax}`}</span>
                              <div className="tasks-page-subtopic-stepper">
                                <button
                                  type="button"
                                  className="tasks-page-subtopic-step-btn"
                                  onClick={() =>
                                    changeGroupSubtopicCount(activeForSubtopics, stId, -1, stMax)
                                  }
                                  disabled={stCount <= 0}
                                  aria-label="Уменьшить"
                                >
                                  −
                                </button>
                                <button
                                  type="button"
                                  className="tasks-page-subtopic-step-btn"
                                  onClick={() =>
                                    changeGroupSubtopicCount(activeForSubtopics, stId, 1, stMax)
                                  }
                                  disabled={stMax <= 0 || stCount >= stMax}
                                  aria-label="Увеличить"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                }

                // --- Одиночное задание с подтемами ---
                let allSubtopics = [];
                if (activeForSubtopics.startsWith("task_")) {
                  const block = subtopicsByTask.find((b) => b.task_list_id === it.id);
                  if (block) {
                    allSubtopics = (block.subtopics || []).map((st) => ({
                      title: st.title || `Подтема ${st.id}`,
                      ids: [st.id],
                      stById: { [st.id]: st },
                      taskCount: st.task_count ?? 0,
                      fipiCount: st.fipi_task_count ?? 0,
                    }));
                  }
                }
                const toggleGroup = (ids) => {
                  const allSelected = ids.every((id) => selectedSubtopicIds.includes(id));
                  if (allSelected) {
                    setSelectedSubtopicIds((prev) => prev.filter((id) => !ids.includes(id)));
                    setSubtopicCounts((prev) => {
                      const next = { ...prev };
                      ids.forEach((id) => delete next[id]);
                      return next;
                    });
                  } else {
                    setSelectedSubtopicIds((prev) => [...new Set([...prev, ...ids])]);
                    setSubtopicCounts((prev) => {
                      const next = { ...prev };
                      ids.forEach((id) => {
                        if ((next[id] ?? 0) < 1) next[id] = 1;
                      });
                      return next;
                    });
                  }
                };
                const changeGroupCount = (ids, delta, maxCount) => {
                  const curTotal = ids.reduce((s, id) => s + (subtopicCounts[id] ?? 0), 0);
                  const nextTotal = Math.max(0, Math.min(maxCount, curTotal + delta));
                  const perId = Math.floor(nextTotal / ids.length);
                  const remainder = nextTotal % ids.length;
                  setSubtopicCounts((prev) => {
                    const next = { ...prev };
                    ids.forEach((id, i) => {
                      const v = perId + (i < remainder ? 1 : 0);
                      if (v > 0) next[id] = v;
                      else delete next[id];
                    });
                    return next;
                  });
                  // При изменении количества задач синхронизируем чекбоксы подтем:
                  // >0 — подтема отмечена, 0 — снимаем отметку.
                  setSelectedSubtopicIds((prev) => {
                    if (nextTotal > 0) {
                      return [...new Set([...prev, ...ids])];
                    }
                    return prev.filter((id) => !ids.includes(id));
                  });
                };
                return allSubtopics.map(({ title, ids, stById, taskCount, fipiCount }) => {
                  const maxCount = onlyFipiTrainer && typeof fipiCount === "number" ? fipiCount : taskCount;
                  const rawCount = ids.reduce((s, id) => s + (subtopicCounts[id] ?? 0), 0);
                  const isChecked = ids.every((id) => selectedSubtopicIds.includes(id));
                  return (
                    <div key={ids.join("-")} className="tasks-page-subtopic-row">
                      <label className="tasks-page-subtopic-label">
                        <input
                          type="checkbox"
                          className="tasks-page-subtopic-checkbox-input"
                          checked={isChecked}
                          onChange={() => toggleGroup(ids)}
                        />
                        <span
                          className={`tasks-page-subtopic-checkbox-visual ${isChecked ? "selected" : ""}`}
                          aria-hidden
                        />
                        <span className="tasks-page-subtopic-title">{title}</span>
                      </label>
                      <div className="tasks-page-subtopic-counter-wrap">
                        <input
                          type="number"
                          inputMode="numeric"
                          step={1}
                          min={0}
                          max={maxCount}
                          className="tasks-page-subtopic-num tasks-page-subtopic-num-input"
                          title={`Сколько задач (не больше ${maxCount} в базе)`}
                          aria-label={`Количество для ${title}`}
                          value={rawCount}
                          disabled={maxCount <= 0}
                          onChange={(e) =>
                            applyGroupedSubtopicTotalInput(ids, e.target.value, maxCount)
                          }
                        />
                        <span className="tasks-page-subtopic-of">
                          {`задач из ${maxCount}`}
                        </span>
                        <div className="tasks-page-subtopic-stepper">
                          <button
                            type="button"
                            className="tasks-page-subtopic-step-btn"
                            onClick={() => changeGroupCount(ids, -1, maxCount)}
                            disabled={rawCount <= 0}
                            aria-label="Уменьшить"
                          >
                            −
                          </button>
                          <button
                            type="button"
                            className="tasks-page-subtopic-step-btn"
                            onClick={() => changeGroupCount(ids, 1, maxCount)}
                            disabled={maxCount <= 0 || rawCount >= maxCount}
                            aria-label="Увеличить"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
                        </div>
                      </div>
                    ) : (
                      <p className="tasks-prep-trainer-hint">
                        Выберите номер в сетке, чтобы настроить подтемы и количество задач для теста.
                      </p>
                    )}
                    <div className="tasks-prep-aside-total-row" aria-live="polite">
                      <span>Итого задач:</span>
                      <strong>{testTotal}</strong>
                    </div>
                  </aside>
                </div>
                <div className="tasks-page-test-actions tasks-prep-trainer-actions tasks-prep-trainer-actions--row">
                  <button
                    type="button"
                    className="tasks-prep-btn-clear"
                    onClick={() => {
                      setTestCounts({});
                      setGroupSubtopicCounts({});
                      setActiveForSubtopics(null);
                      setSelectedSubtopicIds([]);
                      setSubtopicCounts({});
                    }}
                  >
                    Очистить выбор
                  </button>
                  <button
                    type="button"
                    className="add-button primary tasks-prep-btn-start-test"
                    disabled={testTotal === 0 || submitBlock2}
                    onClick={onStartTest}
                  >
                    {submitBlock2 ? "Запуск…" : "Начать тестирование"}
                  </button>
                </div>
              </div>
              )}
            </div>
          </section>
        </>
      )}
    </>,
  );
}

export default TasksPage;