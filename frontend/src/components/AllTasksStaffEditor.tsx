import { useCallback, useEffect, useState, type FormEvent } from "react";
// @ts-ignore JS module without d.ts
import { ensureCsrfCookie, fetchCabinetSession } from "../utils/cabinetAuth";

export type StaffTaskListOption = {
  task_list_id: number;
  task_number: number;
  task_title: string;
  task_count: number;
};

export type StaffGroupOption = {
  id: number;
  task_numbers: number[];
  member_count: number;
  subtopic: string | null;
};

export type StaffSubtopicOption = {
  id: number;
  title: string;
  task_list_id: number | null;
  task_number?: number | null;
  task_title?: string;
  task_count?: number;
};

export type StaffTaskPatch = {
  id: number;
  answer: string;
  task_list_id: number | null;
  task_number: number | null;
  task_title: string;
  group_id: number | null;
  subtopic_id: number | null;
  subtopic: string | null;
};

const GROUP_NONE = "";
const SUBTOPIC_NONE = "";
const SUBTOPIC_FROM_TASK = "__from_task__";

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function staffFetch(path: string, options: RequestInit = {}) {
  await ensureCsrfCookie();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;

  const res = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.detail === "string" && data.detail) ||
      "Ошибка запроса";
    const err = new Error(message) as Error & { status?: number; data?: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function saveStaffTask(
  taskId: number,
  payload: {
    answer?: string;
    task_list_id?: number;
    group_id?: number | null;
    create_group?: boolean;
    subtopic_id?: number | null;
    create_subtopic?: string;
    from_task?: boolean;
  }
): Promise<StaffTaskPatch> {
  return staffFetch(`/api/tasks/${taskId}/staff/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function fetchStaffGroups(
  level: string,
  subject: string,
  includeId?: number | null
): Promise<StaffGroupOption[]> {
  const params = new URLSearchParams();
  if (includeId != null) params.set("include_id", String(includeId));
  const qs = params.toString();
  const path = `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/staff-groups/${
    qs ? `?${qs}` : ""
  }`;
  const data = await staffFetch(path);
  return Array.isArray(data?.groups) ? data.groups : [];
}

export async function createStaffGroup(
  level: string,
  subject: string
): Promise<StaffGroupOption> {
  return staffFetch(
    `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/staff-groups/`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export async function fetchStaffSubtopics(
  level: string,
  subject: string,
  taskListId?: number | null
): Promise<StaffSubtopicOption[]> {
  const params = new URLSearchParams();
  if (taskListId != null) params.set("task_list_id", String(taskListId));
  const qs = params.toString();
  const path = `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/staff-subtopics/${
    qs ? `?${qs}` : ""
  }`;
  const data = await staffFetch(path);
  return Array.isArray(data?.subtopics) ? data.subtopics : [];
}

export async function createStaffSubtopic(
  level: string,
  subject: string,
  payload: { title?: string; task_list_id: number; from_task?: boolean }
): Promise<StaffSubtopicOption> {
  return staffFetch(
    `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/staff-subtopics/`,
    { method: "POST", body: JSON.stringify(payload) }
  );
}

export function useCanEditBankTasks() {
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then(
        (data: {
          authenticated?: boolean;
          user?: {
            is_staff?: boolean;
            is_superuser?: boolean;
            can_edit_bank_tasks?: boolean;
          };
        }) => {
          if (cancelled) return;
          const u = data?.user;
          setCanEdit(
            Boolean(
              data?.authenticated &&
                (u?.can_edit_bank_tasks || u?.is_staff || u?.is_superuser)
            )
          );
        }
      )
      .catch(() => {
        if (!cancelled) setCanEdit(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return canEdit;
}

type CatalogSidebarProps = {
  groups: StaffGroupOption[];
  subtopics: StaffSubtopicOption[];
  taskLists: StaffTaskListOption[];
  selectedTaskListId: string;
  selectedGroupId: string;
  selectedSubtopicId: string;
  onSelectTaskList: (taskListId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onSelectSubtopic: (subtopic: StaffSubtopicOption) => void;
  onCreateGroup: () => Promise<void> | void;
  onCreateSubtopic: (title: string, taskListId: number, fromTask?: boolean) => Promise<void> | void;
};

export function AllTasksStaffCatalogSidebar({
  groups,
  subtopics,
  taskLists,
  selectedTaskListId,
  selectedGroupId,
  selectedSubtopicId,
  onSelectTaskList,
  onSelectGroup,
  onSelectSubtopic,
  onCreateGroup,
  onCreateSubtopic,
}: CatalogSidebarProps) {
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [subTitle, setSubTitle] = useState("");
  const [subListId, setSubListId] = useState(selectedTaskListId || "");
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedTaskListId) setSubListId(selectedTaskListId);
  }, [selectedTaskListId]);

  const handleCreateGroup = async () => {
    if (groupBusy) return;
    setGroupBusy(true);
    setGroupError(null);
    try {
      await onCreateGroup();
    } catch (err) {
      setGroupError(err instanceof Error ? err.message : "Не удалось создать группу");
    } finally {
      setGroupBusy(false);
    }
  };

  const handleCreateSubtopic = async (e: FormEvent) => {
    e.preventDefault();
    if (subBusy) return;
    const title = subTitle.trim();
    const tlId = Number(subListId);
    if (!title) {
      setSubError("Введите название");
      return;
    }
    if (!Number.isFinite(tlId) || tlId <= 0) {
      setSubError("Выберите номер задания");
      return;
    }
    setSubBusy(true);
    setSubError(null);
    try {
      await onCreateSubtopic(title, tlId);
      setSubTitle("");
    } catch (err) {
      setSubError(err instanceof Error ? err.message : "Не удалось создать подтему");
    } finally {
      setSubBusy(false);
    }
  };

  const handleCreateFromTask = async () => {
    if (subBusy) return;
    const tlId = Number(subListId);
    if (!Number.isFinite(tlId) || tlId <= 0) {
      setSubError("Выберите номер задания");
      return;
    }
    setSubBusy(true);
    setSubError(null);
    try {
      await onCreateSubtopic("", tlId, true);
    } catch (err) {
      setSubError(err instanceof Error ? err.message : "Не удалось создать подтему");
    } finally {
      setSubBusy(false);
    }
  };

  return (
    <aside className="all-tasks-staff-sidebar" aria-label="Темы, подтемы и группы">
      <section className="all-tasks-staff-sidebar__section">
        <h2 className="all-tasks-staff-sidebar__title">Темы</h2>
        <p className="all-tasks-staff-sidebar__hint">
          Номера заданий (TaskList) этого предмета и уровня.
        </p>
        {taskLists.length === 0 ? (
          <p className="all-tasks-staff-sidebar__empty">Пока нет тем</p>
        ) : (
          <ul className="all-tasks-staff-sidebar__list">
            {taskLists.map((item) => {
              const id = String(item.task_list_id);
              const active = selectedTaskListId === id && !selectedSubtopicId && !selectedGroupId;
              return (
                <li key={item.task_list_id}>
                  <button
                    type="button"
                    className={`all-tasks-staff-sidebar__item${active ? " is-active" : ""}`}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelectTaskList(id)}
                  >
                    <span className="all-tasks-staff-sidebar__num">№{item.task_number}</span>
                    <span className="all-tasks-staff-sidebar__name">
                      {item.task_title || "без названия"}
                    </span>
                    <span className="all-tasks-staff-sidebar__count">
                      {item.task_count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="all-tasks-staff-sidebar__section">
        <h2 className="all-tasks-staff-sidebar__title">Подтемы</h2>
        <p className="all-tasks-staff-sidebar__hint">
          Подтемы из базы. Можно создать свою или добавить само задание как подтему.
        </p>
        <form className="all-tasks-staff-sidebar__form" onSubmit={handleCreateSubtopic}>
          <select
            className="all-tasks-staff-sidebar__control"
            value={subListId}
            disabled={subBusy}
            onChange={(e) => setSubListId(e.target.value)}
          >
            <option value="">Номер задания</option>
            {taskLists.map((item) => (
              <option key={item.task_list_id} value={String(item.task_list_id)}>
                №{item.task_number}
                {item.task_title ? ` — ${item.task_title}` : ""}
              </option>
            ))}
          </select>
          <input
            type="text"
            className="all-tasks-staff-sidebar__control"
            value={subTitle}
            maxLength={255}
            placeholder="Название подтемы"
            disabled={subBusy}
            onChange={(e) => setSubTitle(e.target.value)}
          />
          <button
            type="submit"
            className="all-tasks-staff-sidebar__add"
            disabled={subBusy || !subTitle.trim() || !subListId}
          >
            {subBusy ? "Создание…" : "Создать подтему"}
          </button>
          <button
            type="button"
            className="all-tasks-staff-sidebar__add all-tasks-staff-sidebar__add--secondary"
            disabled={subBusy || !subListId}
            onClick={handleCreateFromTask}
          >
            {subBusy ? "Создание…" : "Добавить задание как подтему"}
          </button>
        </form>
        {subError ? (
          <p className="all-tasks-staff-sidebar__error" role="alert">
            {subError}
          </p>
        ) : null}
        {subtopics.length === 0 ? (
          <p className="all-tasks-staff-sidebar__empty">Пока нет подтем</p>
        ) : (
          <ul className="all-tasks-staff-sidebar__list">
            {subtopics.map((item) => {
              const id = String(item.id);
              const active = selectedSubtopicId === id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`all-tasks-staff-sidebar__item${active ? " is-active" : ""}`}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelectSubtopic(item)}
                  >
                    <span className="all-tasks-staff-sidebar__num">
                      {item.task_number != null ? `№${item.task_number}` : "—"}
                    </span>
                    <span className="all-tasks-staff-sidebar__name">
                      {item.title}
                      {(item.task_count ?? 0) === 0 ? " · пустая" : ""}
                    </span>
                    <span className="all-tasks-staff-sidebar__count">
                      {item.task_count ?? 0}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="all-tasks-staff-sidebar__section">
        <h2 className="all-tasks-staff-sidebar__title">Группы</h2>
        <p className="all-tasks-staff-sidebar__hint">
          Группы этого предмета и уровня из базы. Можно создать пустую и потом добавить задания.
        </p>
        <button
          type="button"
          className="all-tasks-staff-sidebar__add"
          disabled={groupBusy}
          onClick={handleCreateGroup}
        >
          {groupBusy ? "Создание…" : "Создать пустую группу"}
        </button>
        {groupError ? (
          <p className="all-tasks-staff-sidebar__error" role="alert">
            {groupError}
          </p>
        ) : null}
        {groups.length === 0 ? (
          <p className="all-tasks-staff-sidebar__empty">Пока нет групп</p>
        ) : (
          <ul className="all-tasks-staff-sidebar__list">
            {groups.map((group) => {
              const id = String(group.id);
              const active = selectedGroupId === id;
              const nums = (group.task_numbers || []).join(", ");
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    className={`all-tasks-staff-sidebar__item${active ? " is-active" : ""}`}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelectGroup(id)}
                  >
                    <span className="all-tasks-staff-sidebar__num">#{group.id}</span>
                    <span className="all-tasks-staff-sidebar__name">
                      {nums ? `№${nums}` : "пустая"}
                    </span>
                    <span className="all-tasks-staff-sidebar__count">
                      {group.member_count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}

function formatStaffGroupLabel(group: StaffGroupOption): string {
  const nums = (group.task_numbers || []).join(", ");
  const parts = [`Группа ${group.id}`];
  if (nums) parts.push(`№${nums}`);
  if (group.subtopic) parts.push(group.subtopic);
  return parts.join(" · ");
}

type EditorProps = {
  taskId: number;
  taskListId: number | null;
  groupId: number | null;
  subtopicId: number | null;
  answer: string;
  taskLists: StaffTaskListOption[];
  groups: StaffGroupOption[];
  subtopics: StaffSubtopicOption[];
  showGroup?: boolean;
  onSaved: (patch: StaffTaskPatch) => void;
};

export function AllTasksStaffEditor({
  taskId,
  taskListId,
  groupId,
  subtopicId,
  answer,
  taskLists,
  groups,
  subtopics,
  showGroup = false,
  onSaved,
}: EditorProps) {
  const [draftListId, setDraftListId] = useState(
    taskListId != null ? String(taskListId) : ""
  );
  const [draftGroup, setDraftGroup] = useState(
    groupId != null ? String(groupId) : GROUP_NONE
  );
  const [draftSubtopic, setDraftSubtopic] = useState(
    subtopicId != null ? String(subtopicId) : SUBTOPIC_NONE
  );
  const [draftAnswer, setDraftAnswer] = useState(answer || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraftListId(taskListId != null ? String(taskListId) : "");
  }, [taskId, taskListId]);

  useEffect(() => {
    setDraftGroup(groupId != null ? String(groupId) : GROUP_NONE);
  }, [taskId, groupId]);

  useEffect(() => {
    setDraftSubtopic(subtopicId != null ? String(subtopicId) : SUBTOPIC_NONE);
  }, [taskId, subtopicId]);

  useEffect(() => {
    setDraftAnswer(answer || "");
  }, [taskId, answer]);

  const subtopicsForList = subtopics.filter(
    (s) => draftListId && String(s.task_list_id) === draftListId
  );

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (busy) return;
      const nextListId = Number(draftListId);
      if (!Number.isFinite(nextListId) || nextListId <= 0) {
        setError("Выберите TaskList");
        return;
      }
      setBusy(true);
      setError(null);
      setSaved(false);
      try {
        const payload: {
          answer: string;
          task_list_id: number;
          group_id?: number | null;
          subtopic_id?: number | null;
          from_task?: boolean;
        } = {
          answer: draftAnswer,
          task_list_id: nextListId,
        };
        if (showGroup || groupId != null || draftGroup) {
          if (!draftGroup) {
            payload.group_id = null;
          } else {
            const parsed = Number(draftGroup);
            if (!Number.isFinite(parsed) || parsed <= 0) {
              setError("Выберите группу");
              setBusy(false);
              return;
            }
            payload.group_id = parsed;
          }
        }
        if (draftSubtopic === SUBTOPIC_FROM_TASK) {
          payload.from_task = true;
        } else if (!draftSubtopic) {
          payload.subtopic_id = null;
        } else {
          const parsed = Number(draftSubtopic);
          if (!Number.isFinite(parsed) || parsed <= 0) {
            setError("Выберите подтему");
            setBusy(false);
            return;
          }
          payload.subtopic_id = parsed;
        }
        const result = await saveStaffTask(taskId, payload);
        if (result.group_id != null) {
          setDraftGroup(String(result.group_id));
        } else {
          setDraftGroup(GROUP_NONE);
        }
        if (result.subtopic_id != null) {
          setDraftSubtopic(String(result.subtopic_id));
        } else {
          setDraftSubtopic(SUBTOPIC_NONE);
        }
        onSaved(result);
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось сохранить");
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      draftAnswer,
      draftGroup,
      draftListId,
      draftSubtopic,
      groupId,
      onSaved,
      showGroup,
      taskId,
    ]
  );

  const selectedList = taskLists.find((item) => String(item.task_list_id) === draftListId);
  const fromTaskTitle = (
    (selectedList?.task_title || "").trim() ||
    (selectedList ? `Задание ${selectedList.task_number}` : "")
  );
  const hasFromTaskSubtopic = subtopicsForList.some(
    (s) => (s.title || "").toLocaleLowerCase("ru") === fromTaskTitle.toLocaleLowerCase("ru")
  );
  const groupInList = groups.some((g) => String(g.id) === draftGroup);
  const subtopicInList =
    draftSubtopic === SUBTOPIC_FROM_TASK ||
    subtopicsForList.some((s) => String(s.id) === draftSubtopic);

  return (
    <form className="all-tasks-staff-editor" onSubmit={handleSave}>
      <p className="all-tasks-staff-editor__title">Админ-панель</p>
      <label className="all-tasks-staff-editor__field">
        <span className="all-tasks-staff-editor__label">TaskList</span>
        <select
          className="all-tasks-staff-editor__control"
          value={draftListId}
          disabled={busy || taskLists.length === 0}
          onChange={(e) => {
            const next = e.target.value;
            setDraftListId(next);
            const stillValid =
              draftSubtopic === SUBTOPIC_FROM_TASK ||
              subtopics.some(
                (s) => String(s.task_list_id) === next && String(s.id) === draftSubtopic
              );
            if (!stillValid) {
              setDraftSubtopic(SUBTOPIC_NONE);
            }
            setSaved(false);
          }}
        >
          <option value="">Выберите номер</option>
          {taskLists.map((item) => (
            <option key={item.task_list_id} value={String(item.task_list_id)}>
              №{item.task_number}
              {item.task_title ? ` — ${item.task_title}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="all-tasks-staff-editor__field">
        <span className="all-tasks-staff-editor__label">Подтема</span>
        <select
          className="all-tasks-staff-editor__control"
          value={draftSubtopic}
          disabled={busy || !draftListId}
          onChange={(e) => {
            setDraftSubtopic(e.target.value);
            setSaved(false);
          }}
        >
          <option value={SUBTOPIC_NONE}>Нет подтемы</option>
          {fromTaskTitle && !hasFromTaskSubtopic ? (
            <option value={SUBTOPIC_FROM_TASK}>
              Само задание — {fromTaskTitle}
            </option>
          ) : null}
          {draftSubtopic && !subtopicInList && draftSubtopic !== SUBTOPIC_FROM_TASK ? (
            <option value={draftSubtopic}>Подтема {draftSubtopic}</option>
          ) : null}
          {subtopicsForList.map((item) => (
            <option key={item.id} value={String(item.id)}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      {showGroup || groupId != null || draftGroup ? (
        <label className="all-tasks-staff-editor__field">
          <span className="all-tasks-staff-editor__label">Группа</span>
          <select
            className="all-tasks-staff-editor__control"
            value={draftGroup}
            disabled={busy}
            onChange={(e) => {
              setDraftGroup(e.target.value);
              setSaved(false);
            }}
          >
            <option value={GROUP_NONE}>Нет группы</option>
            {draftGroup && !groupInList ? (
              <option value={draftGroup}>Группа {draftGroup}</option>
            ) : null}
            {groups.map((group) => (
              <option key={group.id} value={String(group.id)}>
                {formatStaffGroupLabel(group)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="all-tasks-staff-editor__field">
        <span className="all-tasks-staff-editor__label">Ответ</span>
        <textarea
          className="all-tasks-staff-editor__answer"
          rows={3}
          value={draftAnswer}
          disabled={busy}
          placeholder="Правильный ответ"
          onChange={(e) => {
            setDraftAnswer(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <div className="all-tasks-staff-editor__actions">
        <button
          type="submit"
          className="all-tasks-staff-editor__save"
          disabled={busy}
        >
          {busy ? "Сохранение…" : "Сохранить"}
        </button>
        {saved ? (
          <span className="all-tasks-staff-editor__ok">Сохранено</span>
        ) : null}
      </div>
      {error ? (
        <p className="all-tasks-staff-editor__error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

