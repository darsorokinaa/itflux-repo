import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { MAIN_FILE } from "./projectStorage";
import { VirtualFs, importTaskFiles } from "./virtualFs";
import { validateUploadSize } from "./limits";
import type { TaskFileSource } from "./types";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));

const MAX_TASK_FILE_OPTIONS = 80;

type Props = {
  vfs: VirtualFs;
  mainFile: string;
  mainContent: string;
  activeFile: string;
  onSelectFile: (name: string) => void;
  onMainContentChange: (code: string) => void;
  onAuxContentChange: (name: string, code: string) => void;
  onCreateFile: (name: string) => void;
  onRenameFile: (oldName: string, newName: string) => void;
  onDeleteFile: (name: string) => void;
  running: boolean;
  errorLine?: number;
  activeFileUrl: string | null;
  taskSources?: TaskFileSource[];
  getTaskSources?: () => TaskFileSource[];
  activeTaskId: number | string | null;
  onActiveTaskChange?: (id: number | string | null) => void;
  vfsVersion?: number;
};

function FileIcon() {
  return (
    <svg
      className="inf-code-file-panel__icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 2.5h6.5L13 6v7.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M9.5 2.5V6H13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function FilePanelInner({
  vfs,
  mainFile,
  mainContent,
  activeFile,
  onSelectFile,
  onMainContentChange,
  onAuxContentChange,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
  running,
  errorLine,
  activeFileUrl,
  taskSources = [],
  getTaskSources,
  activeTaskId,
  onActiveTaskChange,
  vfsVersion = 0,
}: Props) {
  const [fileList, setFileList] = useState<string[]>(() => vfs.list());
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [resolvedTasks, setResolvedTasks] = useState<TaskFileSource[]>([]);
  const [taskOverflow, setTaskOverflow] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const refreshFileList = useCallback(() => {
    setFileList(vfs.list());
  }, [vfs]);

  useEffect(() => {
    refreshFileList();
  }, [refreshFileList, mainContent, vfsVersion]);

  useEffect(() => {
    const fromProp = taskSources.filter((t) => t.fileUrl);
    if (fromProp.length > 0) {
      setResolvedTasks(fromProp.slice(0, MAX_TASK_FILE_OPTIONS));
      setTaskOverflow(Math.max(0, fromProp.length - MAX_TASK_FILE_OPTIONS));
      return;
    }
    if (getTaskSources) {
      const all = getTaskSources().filter((t) => t.fileUrl);
      if (all.length > 0) {
        setResolvedTasks(all.slice(0, MAX_TASK_FILE_OPTIONS));
        setTaskOverflow(Math.max(0, all.length - MAX_TASK_FILE_OPTIONS));
      }
    }
  }, [taskSources, getTaskSources]);

  useEffect(() => {
    if (renaming) renameInputRef.current?.select();
  }, [renaming]);

  const allFiles = [mainFile, ...fileList.filter((f) => f !== mainFile)];

  const editorValue =
    activeFile === mainFile ? mainContent : (vfs.get(activeFile) ?? "");

  const handleEditorChange = (next: string) => {
    if (activeFile === mainFile) {
      onMainContentChange(next);
    } else {
      onAuxContentChange(activeFile, next);
    }
  };

  const handleNewFile = () => {
    let name = "utils.py";
    let i = 1;
    while (vfs.get(name) || name === mainFile) {
      name = `file${i}.py`;
      i += 1;
    }
    onCreateFile(name);
    refreshFileList();
    onSelectFile(name);
    setImportMsg(`Создан ${name}`);
    setImportError(null);
  };

  const handleDelete = (name: string) => {
    if (name === mainFile || running) return;
    onDeleteFile(name);
    refreshFileList();
    if (activeFile === name) onSelectFile(mainFile);
    setImportMsg(`Удалён ${name}`);
  };

  const startRename = (name: string) => {
    if (name === mainFile || running) return;
    setRenaming(name);
    setRenameValue(name);
    onSelectFile(name);
  };

  const cancelRename = () => {
    setRenaming(null);
    setRenameValue("");
  };

  const commitRename = () => {
    if (!renaming) return;
    const next = renameValue.trim();
    if (!next || next === renaming) {
      cancelRename();
      return;
    }
    try {
      onRenameFile(renaming, next);
      refreshFileList();
      onSelectFile(next);
      setImportMsg(`Переименован в ${next}`);
      setImportError(null);
      cancelRename();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImportTask = async () => {
    if (!activeFileUrl) return;
    setImportError(null);
    setImportMsg(null);
    try {
      const names = await importTaskFiles(activeFileUrl, vfs);
      refreshFileList();
      const first = names.find((n) => n !== mainFile) ?? names[0];
      if (first && first !== mainFile) onSelectFile(first);
      setImportMsg(`Загружено: ${names.join(", ")}`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUpload = async (file: File) => {
    const sizeCheck = validateUploadSize(file.size);
    if (!sizeCheck.ok) {
      setImportError(sizeCheck.error ?? "Файл слишком большой");
      return;
    }
    const text = await file.text();
    try {
      if (file.name === mainFile) {
        onMainContentChange(text);
      } else {
        onCreateFile(file.name);
        onAuxContentChange(file.name, text);
        refreshFileList();
        onSelectFile(file.name);
      }
      setImportMsg(`Добавлен ${file.name}`);
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="inf-code-workspace">
      <aside className="inf-code-file-panel">
        <div className="inf-code-file-panel__header" title="Двойной щелчок по файлу — переименовать">
          <span>Файлы</span>
          <span className="inf-code-file-panel__hint-inline">2× клик — имя</span>
        </div>
        <ul className="inf-code-file-panel__list">
          {allFiles.map((name) => (
            <li key={name} className="inf-code-file-panel__row">
              {renaming === name ? (
                <input
                  ref={renameInputRef}
                  className="inf-code-file-panel__rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") cancelRename();
                  }}
                  aria-label="Новое имя файла"
                />
              ) : (
                <div
                  className={`inf-code-file-panel__item-wrap${activeFile === name ? " is-active" : ""}`}
                >
                  <button
                    type="button"
                    className={`inf-code-file-panel__item${name === mainFile ? " is-main" : ""}`}
                    onClick={() => onSelectFile(name)}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      startRename(name);
                    }}
                    title={
                      name === mainFile
                        ? "Главный файл — запускается по кнопке «Запустить»"
                        : `${name} — двойной щелчок для переименования`
                    }
                  >
                    <FileIcon />
                    <span className="inf-code-file-panel__name">{name}</span>
                    {name === mainFile ? (
                      <span className="inf-code-file-panel__main-dot" title="Точка входа" />
                    ) : null}
                  </button>
                  {name !== mainFile ? (
                    <button
                      type="button"
                      className="inf-code-file-panel__delete"
                      onClick={() => handleDelete(name)}
                      disabled={running}
                      title={`Удалить ${name}`}
                      aria-label={`Удалить ${name}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                        <path
                          d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="inf-code-file-panel__actions">
          <button type="button" className="inf-code-file-panel__action" onClick={handleNewFile} disabled={running}>
            + Файл
          </button>
          <label className="inf-code-file-panel__action inf-code-file-panel__upload" title="Загрузить файл">
            Импорт
            <input
              type="file"
              accept=".txt,.csv,.py,.dat,.in,.json,.xml,.html,.md"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleUpload(f);
              }}
            />
          </label>
          {activeFileUrl ? (
            <button type="button" className="inf-code-file-panel__action" onClick={() => void handleImportTask()} disabled={running}>
              Из задания
            </button>
          ) : null}
        </div>
        {resolvedTasks.length > 0 ? (
          <label className="inf-code-file-panel__task-pick">
            <select
              value={activeTaskId ?? ""}
              onChange={(e) =>
                onActiveTaskChange?.(e.target.value ? e.target.value : null)
              }
            >
              <option value="">Файлы задания</option>
              {resolvedTasks.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.label}
                </option>
              ))}
            </select>
            {taskOverflow > 0 ? (
              <span className="inf-code-file-panel__hint">
                +{taskOverflow} ещё
              </span>
            ) : null}
          </label>
        ) : null}
        {importMsg ? <p className="inf-code-file-panel__msg">{importMsg}</p> : null}
        {importError ? <p className="inf-code-file-panel__error">{importError}</p> : null}
      </aside>

      <div className="inf-code-editor-area">
        <div className="inf-code-editor-area__tabbar">
          <span className="inf-code-editor-area__filename">{activeFile}</span>
          {activeFile === mainFile ? (
            <span className="inf-code-editor-area__badge">точка входа</span>
          ) : null}
        </div>
        <Suspense
          fallback={
            <div className="inf-code-editor__cm inf-code-editor__cm--loading">
              Загрузка редактора…
            </div>
          }
        >
          <CodeMirrorEditor
            value={editorValue}
            onChange={handleEditorChange}
            readOnly={running}
            errorLine={activeFile === mainFile ? errorLine : undefined}
          />
        </Suspense>
      </div>
    </div>
  );
}

export default memo(FilePanelInner);
export { MAIN_FILE };
