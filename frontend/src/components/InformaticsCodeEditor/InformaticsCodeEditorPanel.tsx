import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import EditorToolbar from "./EditorToolbar";
import FilePanel from "./FilePanel";
import OutputPanel from "./OutputPanel";
import { pickRunner } from "./detectRunner";
import {
  limitsSummary,
  RUN_LIMITS,
  validateProgram,
} from "./limits";
import {
  applyProjectToVfs,
  loadProject,
  MAIN_FILE,
  migrateLegacyCode,
  saveProject,
  vfsToProjectFiles,
  type SaveStatus,
} from "./projectStorage";
import {
  countInputCalls,
  validateStdinLines,
} from "./stdinProvider";
import {
  SIDEBAR_CODE_STORAGE_ID,
  type OutputTabId,
  type RunResult,
  type RunStatus,
  type TaskFileSource,
} from "./types";
import { VirtualFs } from "./virtualFs";

type Props = {
  storageId?: string;
  taskSources?: TaskFileSource[];
  getTaskSources?: () => TaskFileSource[];
  activeTaskId?: number | string | null;
  onActiveTaskChange?: (id: number | string | null) => void;
  active?: boolean;
  hostRef?: RefObject<HTMLElement | null>;
};

function InformaticsCodeEditorPanelInner({
  storageId = SIDEBAR_CODE_STORAGE_ID,
  taskSources = [],
  getTaskSources,
  activeTaskId = null,
  onActiveTaskChange,
  active = true,
  hostRef,
}: Props) {
  const [vfs] = useState(() => new VirtualFs());
  const [mainFile, setMainFile] = useState(MAIN_FILE);
  const [mainContent, setMainContent] = useState("");
  const [activeFile, setActiveFile] = useState(MAIN_FILE);
  const [stdinPrefill, setStdinPrefill] = useState("");
  const [running, setRunning] = useState(false);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const [runWarnings, setRunWarnings] = useState<string[]>([]);
  const [outputTab, setOutputTab] = useState<OutputTabId>("stdout");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastUsedTurtle, setLastUsedTurtle] = useState(false);
  const [projectReady, setProjectReady] = useState(false);
  const [vfsVersion, setVfsVersion] = useState(0);

  const bumpVfs = useCallback(() => setVfsVersion((v) => v + 1), []);

  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const handleRunRef = useRef<() => void>(() => {});
  const saveTimerRef = useRef<number | undefined>(undefined);
  const liveOutputRef = useRef({ stdout: "", stderr: "" });
  const flushFrameRef = useRef<number | null>(null);
  const storageIdRef = useRef(storageId);

  const turtleHostId = useMemo(
    () => `inf-turtle-host-${storageId}`,
    [storageId]
  );

  const auxFiles = useMemo(() => vfs.toRecord(), [vfs, vfsVersion]);

  const allProjectFiles = useMemo(
    () => vfsToProjectFiles(vfs, mainFile, mainContent),
    [vfs, mainFile, mainContent]
  );

  const inputCallCount = useMemo(
    () => countInputCalls(mainContent, auxFiles),
    [mainContent, auxFiles]
  );

  const stdinLines = useMemo(
    () => stdinPrefill.split(/\r?\n/).map((line) => line.replace(/\r$/, "")),
    [stdinPrefill]
  );

  const activeFileUrl = useMemo(() => {
    const sources = taskSources.length > 0 ? taskSources : getTaskSources?.() ?? [];
    const task = sources.find((t) => String(t.id) === String(activeTaskId ?? ""));
    return task?.fileUrl ?? null;
  }, [taskSources, getTaskSources, activeTaskId]);

  const persistProject = useCallback(
    (main: string, stdin: string, status: SaveStatus = "saving") => {
      setSaveStatus(status);
      const project = {
        files: vfsToProjectFiles(vfs, mainFile, main),
        mainFile,
        stdinPrefill: stdin,
        version: 1 as const,
      };
      const ok = saveProject(storageIdRef.current, project);
      setSaveStatus(ok ? "saved" : "error");
    },
    [vfs, mainFile]
  );

  const scheduleAutosave = useCallback(
    (main: string, stdin: string) => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
      setSaveStatus("saving");
      saveTimerRef.current = window.setTimeout(() => {
        persistProject(main, stdin, "saving");
      }, RUN_LIMITS.autosaveDebounceMs);
    },
    [persistProject]
  );

  useEffect(() => {
    storageIdRef.current = storageId;
    const legacy = migrateLegacyCode(storageId);
    const project = loadProject(storageId);
    if (legacy) {
      project.files[project.mainFile] = legacy;
    }
    setMainFile(project.mainFile);
    setMainContent(project.files[project.mainFile] ?? "");
    setStdinPrefill(project.stdinPrefill);
    setActiveFile(project.mainFile);
    applyProjectToVfs(vfs, project);
    bumpVfs();
    setProjectReady(true);
    setSaveStatus("saved");
    setResult(null);
    setRunStatus("idle");
  }, [storageId, vfs, bumpVfs]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
    },
    []
  );

  const handleMainContentChange = useCallback(
    (code: string) => {
      setMainContent(code);
      scheduleAutosave(code, stdinPrefill);
    },
    [scheduleAutosave, stdinPrefill]
  );

  const handleAuxContentChange = useCallback(
    (name: string, code: string) => {
      try {
        vfs.set(name, code);
        bumpVfs();
        scheduleAutosave(mainContent, stdinPrefill);
      } catch (e) {
        setRunWarnings([
          e instanceof Error ? e.message : String(e),
        ]);
        setOutputTab("errors");
      }
    },
    [vfs, mainContent, stdinPrefill, scheduleAutosave, bumpVfs]
  );

  const handleCreateFile = useCallback(
    (name: string) => {
      vfs.set(name, "");
      bumpVfs();
    },
    [vfs, bumpVfs]
  );

  const handleRenameFile = useCallback(
    (oldName: string, newName: string) => {
      const content = vfs.get(oldName);
      if (content === undefined) return;
      vfs.delete(oldName);
      vfs.set(newName, content);
      bumpVfs();
      scheduleAutosave(mainContent, stdinPrefill);
    },
    [vfs, mainContent, stdinPrefill, scheduleAutosave, bumpVfs]
  );

  const handleDeleteFile = useCallback(
    (name: string) => {
      vfs.delete(name);
      bumpVfs();
      scheduleAutosave(mainContent, stdinPrefill);
    },
    [vfs, mainContent, stdinPrefill, scheduleAutosave, bumpVfs]
  );

  const handleStdinChange = useCallback(
    (value: string) => {
      setStdinPrefill(value);
      scheduleAutosave(mainContent, value);
    },
    [mainContent, scheduleAutosave]
  );

  const flushLiveOutput = useCallback(() => {
    flushFrameRef.current = null;
    setResult((prev) => ({
      stdout: liveOutputRef.current.stdout,
      stderr: liveOutputRef.current.stderr,
      timedOut: prev?.timedOut,
      educationalError: prev?.educationalError,
      errorLine: prev?.errorLine,
      usedTurtle: prev?.usedTurtle,
    }));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushFrameRef.current !== null) return;
    flushFrameRef.current = requestAnimationFrame(flushLiveOutput);
  }, [flushLiveOutput]);

  const cancelFlush = useCallback(() => {
    if (flushFrameRef.current !== null) {
      cancelAnimationFrame(flushFrameRef.current);
      flushFrameRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelFlush(), [cancelFlush]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    runningRef.current = false;
    setRunning(false);
    setRuntimeLoading(false);
    setRunStatus("stopped");
    setResult((prev) => ({
      stdout: prev?.stdout ?? "",
      stderr: prev?.stderr ?? "",
      error: "Выполнение остановлено.",
      educationalError: {
        type: "Остановлено",
        message: "Выполнение программы прервано пользователем.",
      },
      usedTurtle: prev?.usedTurtle,
    }));
    setOutputTab("errors");
  }, []);

  const handleClearOutput = useCallback(() => {
    setResult(null);
    setRunWarnings([]);
    setRunStatus("idle");
    setOutputTab("stdout");
    const host = document.getElementById(turtleHostId);
    if (host) host.innerHTML = "";
  }, [turtleHostId]);

  const handleSave = useCallback(() => {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
    }
    persistProject(mainContent, stdinPrefill, "saving");
  }, [persistProject, mainContent, stdinPrefill]);

  const handleRun = useCallback(async () => {
    if (runningRef.current) return;

    const code = mainContent;
    const validation = validateProgram(code, "python", auxFiles);
    if (!validation.ok) {
      setResult({
        stdout: "",
        stderr: "",
        error: validation.error,
        educationalError: validation.error
          ? { type: "Ошибка", message: validation.error }
          : undefined,
      });
      setRunWarnings([]);
      setRunStatus("error");
      setOutputTab("errors");
      return;
    }

    const stdinCheck = validateStdinLines(inputCallCount, stdinLines);
    if (!stdinCheck.ok) {
      setRunWarnings([...(stdinCheck.error ? [stdinCheck.error] : [])]);
      setOutputTab("stdin");
      return;
    }

    if (validation.warnings.length) {
      setRunWarnings(validation.warnings);
    } else {
      setRunWarnings([]);
    }

    const stdinOptions =
      inputCallCount > 0 ? { lines: stdinLines } : {};

    runningRef.current = true;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setRunning(true);
    setRuntimeLoading(true);
    setRunStatus("loading");
    setResult(null);
    setOutputTab("stdout");
    liveOutputRef.current = { stdout: "", stderr: "" };
    cancelFlush();

    const runner = pickRunner(code, allProjectFiles);
    const useTurtle = runner === "skulpt";
    setLastUsedTurtle(useTurtle);
    if (useTurtle) {
      setOutputTab("turtle");
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r))
      );
    }

    let runRes: RunResult;
    try {
      if (runner === "pyodide") {
        const { runPythonPyodide } = await import("./runners/pythonPyodide");
        runRes = await runPythonPyodide(code, auxFiles, ac.signal, {
          ...stdinOptions,
          stdinRequired: inputCallCount,
          allFiles: allProjectFiles,
          onReady: () => {
            setRuntimeLoading(false);
            setRunStatus("running");
          },
          onOutput: (chunk, stream) => {
            if (stream === "stdout") {
              liveOutputRef.current.stdout += chunk;
            } else {
              liveOutputRef.current.stderr += chunk;
            }
            scheduleFlush();
          },
        });
      } else {
        if (!document.getElementById(turtleHostId)) {
          throw new Error("Холст Turtle не найден");
        }
        setRuntimeLoading(false);
        setRunStatus("running");
        const { runPythonSkulpt } = await import("./runners/pythonSkulpt");
        runRes = await runPythonSkulpt(
          code,
          allProjectFiles,
          turtleHostId,
          ac.signal,
          stdinOptions
        );
      }
    } catch (e) {
      runRes = {
        stdout: "",
        stderr: "",
        error: e instanceof Error ? e.message : String(e),
        educationalError: {
          type: "Ошибка",
          message: e instanceof Error ? e.message : String(e),
        },
      };
    } finally {
      runningRef.current = false;
      setRunning(false);
      setRuntimeLoading(false);
      cancelFlush();
    }

    if (!ac.signal.aborted) {
      setResult(runRes);
      if (runRes.timedOut) {
        setRunStatus("timeout");
        setOutputTab("errors");
      } else if (runRes.error || runRes.educationalError) {
        setRunStatus("error");
        setOutputTab(useTurtle && runRes.stdout ? "turtle" : "errors");
      } else {
        setRunStatus("done");
        if (useTurtle) setOutputTab("turtle");
      }
    }
  }, [
    mainContent,
    auxFiles,
    allProjectFiles,
    inputCallCount,
    stdinLines,
    turtleHostId,
    cancelFlush,
    scheduleFlush,
  ]);

  handleRunRef.current = () => {
    void handleRun();
  };

  useEffect(() => {
    if (!active) return;
    const root = hostRef?.current;
    const handleKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      if (root && e.target instanceof Node && !root.contains(e.target)) return;
      e.preventDefault();
      handleRunRef.current();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [active, hostRef]);

  const codeNearLimit =
    mainContent.length > RUN_LIMITS.maxCodeChars * 0.85 ||
    mainContent.split(/\r?\n/).length > RUN_LIMITS.maxCodeLines * 0.85;

  if (!projectReady) {
    return (
      <div className="inf-code-editor-panel inf-code-editor-panel--loading">
        Загрузка проекта…
      </div>
    );
  }

  return (
    <div className="inf-code-editor-panel">
      <header className="inf-code-editor-header">
        <div className="inf-code-editor-header__brand">
          <h2 className="inf-code-editor-header__title">Python</h2>
          <p className="inf-code-editor-header__hint" title="Ограничения среды">
            {limitsSummary()} · Ctrl+Enter
          </p>
        </div>
        <EditorToolbar
          running={running}
          runtimeLoading={runtimeLoading}
          saveStatus={saveStatus}
          onRun={() => void handleRun()}
          onStop={handleStop}
          onSave={handleSave}
          onClearOutput={handleClearOutput}
        />
      </header>

      {codeNearLimit ? (
        <p className="inf-code-editor-warn" role="status">
          Код близок к лимиту ({mainContent.length.toLocaleString("ru-RU")}{" "}
          символов).
        </p>
      ) : null}

      <div className="inf-code-editor-body">
        <FilePanel
          vfs={vfs}
          mainFile={mainFile}
          mainContent={mainContent}
          activeFile={activeFile}
          onSelectFile={setActiveFile}
          onMainContentChange={handleMainContentChange}
          onAuxContentChange={handleAuxContentChange}
          onCreateFile={handleCreateFile}
          onRenameFile={handleRenameFile}
          onDeleteFile={handleDeleteFile}
          running={running}
          errorLine={result?.errorLine}
          activeFileUrl={activeFileUrl}
          taskSources={taskSources}
          getTaskSources={getTaskSources}
          activeTaskId={activeTaskId}
          onActiveTaskChange={onActiveTaskChange}
          vfsVersion={vfsVersion}
        />

        <OutputPanel
          activeTab={outputTab}
          onTabChange={setOutputTab}
          result={result}
          runStatus={runStatus}
          runtimeLoading={runtimeLoading}
          running={running}
          stdinPrefill={stdinPrefill}
          onStdinChange={handleStdinChange}
          inputCallCount={inputCallCount}
          runWarnings={runWarnings}
          turtleHostId={turtleHostId}
          showTurtleTab={lastUsedTurtle || pickRunner(mainContent, allProjectFiles) === "skulpt"}
        />
      </div>
    </div>
  );
}

export default memo(InformaticsCodeEditorPanelInner);
