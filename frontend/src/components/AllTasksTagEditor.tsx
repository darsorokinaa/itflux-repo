import { useCallback, useEffect, useState, type FormEvent } from "react";
// @ts-ignore JS module without d.ts
import { ensureCsrfCookie, fetchCabinetSession } from "../utils/cabinetAuth";

export type TaskTag = {
  id: number;
  name: string;
};

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function taskTagsFetch(path: string, options: RequestInit = {}) {
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

export async function fetchTaskTagsCatalog(): Promise<TaskTag[]> {
  const data = await taskTagsFetch("/api/task-tags/");
  return Array.isArray(data?.tags) ? data.tags : [];
}

export async function createTaskTag(name: string): Promise<TaskTag> {
  return taskTagsFetch("/api/task-tags/", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function deleteTaskTag(tagId: number): Promise<void> {
  await taskTagsFetch(`/api/task-tags/${tagId}/`, { method: "DELETE" });
}

export async function setTaskTags(
  taskId: number,
  tagIds: number[]
): Promise<TaskTag[]> {
  const data = await taskTagsFetch(`/api/tasks/${taskId}/tags/`, {
    method: "PUT",
    body: JSON.stringify({ tag_ids: tagIds }),
  });
  return Array.isArray(data?.tags) ? data.tags : [];
}

type CatalogSidebarProps = {
  tags: TaskTag[];
  onTagsChange: (tags: TaskTag[]) => void;
};

export function AllTasksTagsCatalogSidebar({
  tags,
  onTagsChange,
}: CatalogSidebarProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createTaskTag(name);
      if (!tags.some((t) => t.id === created.id)) {
        onTagsChange(
          [...tags, created].sort((a, b) =>
            a.name.localeCompare(b.name, "ru")
          )
        );
      }
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать тег");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (tagId: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTaskTag(tagId);
      onTagsChange(tags.filter((t) => t.id !== tagId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить тег");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="all-tasks-tags-sidebar" aria-label="Справочник тегов">
      <h2 className="all-tasks-tags-sidebar__title">Теги</h2>
      <p className="all-tasks-tags-sidebar__hint">
        Создайте теги здесь, затем отмечайте их у заданий.
      </p>
      <form className="all-tasks-tags-sidebar__form" onSubmit={handleCreate}>
        <input
          type="text"
          className="all-tasks-tags-sidebar__input"
          value={draft}
          maxLength={120}
          placeholder="Новый тег"
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="submit"
          className="all-tasks-tags-sidebar__add"
          disabled={busy || !draft.trim()}
        >
          Добавить
        </button>
      </form>
      {error ? (
        <p className="all-tasks-tags-sidebar__error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="all-tasks-tags-sidebar__list">
        {tags.map((tag) => (
          <li key={tag.id} className="all-tasks-tags-sidebar__item">
            <span className="all-tasks-tag-chip">{tag.name}</span>
            <button
              type="button"
              className="all-tasks-tags-sidebar__remove"
              onClick={() => handleDelete(tag.id)}
              disabled={busy}
              aria-label={`Удалить тег ${tag.name}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {tags.length === 0 ? (
        <p className="all-tasks-tags-sidebar__empty">Пока нет тегов</p>
      ) : null}
    </aside>
  );
}

type TaskEditorProps = {
  taskId: number;
  selected: TaskTag[];
  catalog: TaskTag[];
  onChange: (taskId: number, tags: TaskTag[]) => void;
};

export function AllTasksTaskTagsEditor({
  taskId,
  selected,
  catalog,
  onChange,
}: TaskEditorProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedIds = new Set(selected.map((t) => t.id));

  const toggle = useCallback(
    async (tag: TaskTag) => {
      if (busy) return;
      const has = selected.some((t) => t.id === tag.id);
      const nextIds = has
        ? selected.filter((t) => t.id !== tag.id).map((t) => t.id)
        : [...selected.map((t) => t.id), tag.id];
      setBusy(true);
      setError(null);
      try {
        const tags = await setTaskTags(taskId, nextIds);
        onChange(taskId, tags);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось сохранить");
      } finally {
        setBusy(false);
      }
    },
    [busy, onChange, selected, taskId]
  );

  if (catalog.length === 0) {
    return (
      <div className="all-tasks-item__tags">
        <p className="all-tasks-item__tags-empty">
          Добавьте теги в панели справа
        </p>
      </div>
    );
  }

  return (
    <div className="all-tasks-item__tags">
      <div className="all-tasks-item__tags-list" role="group" aria-label="Теги задания">
        {catalog.map((tag) => {
          const active = selectedIds.has(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              className={`all-tasks-tag-chip all-tasks-tag-chip--toggle${
                active ? " is-active" : ""
              }`}
              aria-pressed={active}
              disabled={busy}
              onClick={() => toggle(tag)}
            >
              {tag.name}
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="all-tasks-item__tags-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function useCanEditTaskTags() {
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((data: { authenticated?: boolean; user?: { can_edit_task_tags?: boolean } }) => {
        if (cancelled) return;
        setCanEdit(Boolean(data?.authenticated && data?.user?.can_edit_task_tags));
      })
      .catch(() => {
        if (!cancelled) setCanEdit(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return canEdit;
}
