import { lazy, memo, Suspense, useCallback, useEffect, useState, type ChangeEvent } from "react";
import { validateUploadSize } from "./limits";
import { VirtualFs, importTaskFiles } from "./virtualFs";
import type { TaskFileSource } from "./types";

const CodeMirrorEditor = lazy(() => import("./CodeMirrorEditor"));

const MAX_TASK_FILE_OPTIONS = 80;

type Props = {
  vfs: VirtualFs;
  activeFileUrl: string | null;
  visible: boolean;
  taskSources?: TaskFileSource[];
  getTaskSources?: () => TaskFileSource[];
  activeTaskId: number | string | null;
  onActiveTaskChange?: (id: number | string | null) => void;
};

function FilesTabInner({
  vfs,
  activeFileUrl,
  visible,
  taskSources = [],
  getTaskSources,
  activeTaskId,
  onActiveTaskChange,
}: Props) {
  const [fileList, setFileList] = useState<string[]>(() => vfs.list());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileEditor, setFileEditor] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [resolvedTasks, setResolvedTasks] = useState<TaskFileSource[]>([]);
  const [taskOverflow, setTaskOverflow] = useState(0);

  useEffect(() => {
    if (!visible || resolvedTasks.length > 0) return;
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
  }, [visible, taskSources, getTaskSources, resolvedTasks.length]);

  useEffect(() => {
    if (activeTaskId != null || resolvedTasks.length === 0) return;
    const first = resolvedTasks[0];
    if (first) onActiveTaskChange?.(first.id);
  }, [resolvedTasks, activeTaskId, onActiveTaskChange]);

  const refreshFileList = useCallback(() => {
    setFileList(vfs.list());
  }, [vfs]);

  useEffect(() => {
    if (visible) refreshFileList();
  }, [visible, refreshFileList]);

  const handleImportTaskFiles = async () => {
    if (!activeFileUrl) return;
    setImportError(null);
    setImportMsg(null);
    try {
      const names = await importTaskFiles(activeFileUrl, vfs);
      refreshFileList();
      setImportMsg(`Загружено: ${names.join(", ")}`);
      if (names[0]) {
        setSelectedFile(names[0]);
        setFileEditor(vfs.get(names[0]) ?? "");
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const sizeCheck = validateUploadSize(file.size);
    if (!sizeCheck.ok) {
      setImportError(sizeCheck.error ?? "Файл слишком большой");
      return;
    }

    const text = await file.text();
    try {
      vfs.set(file.name, text);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
      return;
    }
    refreshFileList();
    setSelectedFile(file.name);
    setFileEditor(text);
    setImportMsg(`Добавлен файл ${file.name}`);
    setImportError(null);
  };

  const handleSelectFile = (name: string) => {
    setSelectedFile(name);
    setFileEditor(vfs.get(name) ?? "");
  };

  const handleSaveFile = () => {
    if (!selectedFile) return;
    try {
      vfs.set(selectedFile, fileEditor);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
      return;
    }
    refreshFileList();
    setImportMsg(`Сохранён ${selectedFile}`);
    setImportError(null);
  };

  const handleNewFile = () => {
    let name = "input.txt";
    let i = 1;
    while (vfs.get(name)) {
      name = `input${i}.txt`;
      i += 1;
    }
    vfs.set(name, "");
    refreshFileList();
    setSelectedFile(name);
    setFileEditor("");
  };

  const handleDeleteFile = () => {
    if (!selectedFile) return;
    vfs.delete(selectedFile);
    refreshFileList();
    setSelectedFile(null);
    setFileEditor("");
  };

  if (!visible) return null;

  const taskOptions = resolvedTasks;

  return (
    <>
      {taskOptions.length > 0 ? (
        <label className="inf-code-task-pick">
          <span>Файлы из задания</span>
          <select
            value={activeTaskId ?? ""}
            onChange={(e) =>
              onActiveTaskChange?.(e.target.value ? e.target.value : null)
            }
          >
            <option value="">— выберите задание —</option>
            {taskOptions.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.label}
              </option>
            ))}
          </select>
          {taskOverflow > 0 ? (
            <span className="inf-code-task-pick__hint">
              Показаны первые {MAX_TASK_FILE_OPTIONS} заданий с файлами
            </span>
          ) : null}
        </label>
      ) : null}
      <div className="inf-code-files-toolbar">
        <button type="button" onClick={handleNewFile}>
          Новый
        </button>
        <label className="inf-code-files-upload">
          Загрузить
          <input
            type="file"
            accept=".txt,.csv,.py,.dat,.in,.json,.xml,.html,.md"
            onChange={handleUploadFile}
            hidden
          />
        </label>
        {activeFileUrl ? (
          <button type="button" onClick={() => void handleImportTaskFiles()}>
            Из задания
          </button>
        ) : null}
        {selectedFile ? (
          <>
            <button type="button" onClick={handleSaveFile}>
              Сохранить
            </button>
            <button type="button" className="is-danger" onClick={handleDeleteFile}>
              Удалить
            </button>
          </>
        ) : null}
      </div>
      {importMsg ? <p className="inf-code-files-msg">{importMsg}</p> : null}
      {importError ? <p className="inf-code-files-error">{importError}</p> : null}
      <div className="inf-code-files-layout">
        <ul className="inf-code-files-list">
          {fileList.length === 0 ? (
            <li className="inf-code-files-empty">Нет файлов</li>
          ) : (
            fileList.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className={selectedFile === name ? "is-active" : ""}
                  onClick={() => handleSelectFile(name)}
                >
                  {name}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="inf-code-files-editor">
          {selectedFile ? (
            <Suspense fallback={<div className="inf-code-editor__cm inf-code-editor__cm--loading">…</div>}>
              <CodeMirrorEditor
                value={fileEditor}
                onChange={setFileEditor}
                readOnly={false}
              />
            </Suspense>
          ) : (
            <div className="inf-code-files-editor-placeholder">
              Создайте или выберите файл
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default memo(FilesTabInner);
