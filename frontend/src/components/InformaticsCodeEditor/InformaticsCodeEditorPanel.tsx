import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import CodeTab from "./CodeTab";
import FilesTab from "./FilesTab";
import {
  CODE_LANGUAGES,
  SIDEBAR_CODE_STORAGE_ID,
  codeStorageKey,
  type CodeLanguage,
  type RunResult,
  type TaskFileSource,
} from "./types";
import { VirtualFs } from "./virtualFs";
import {
  limitsSummary,
  RUN_LIMITS,
  validateProgram,
} from "./limits";
import { countInputCalls } from "./stdinProvider";

type TabId = "editor" | "files" | "output";

type Props = {
  storageId?: string;
  taskSources?: TaskFileSource[];
  getTaskSources?: () => TaskFileSource[];
  activeTaskId?: number | string | null;
  onActiveTaskChange?: (id: number | string | null) => void;
  active?: boolean;
  hostRef?: RefObject<HTMLElement | null>;
};

function saveStoredCode(storageId: string, lang: CodeLanguage, code: string) {
  try {
    localStorage.setItem(codeStorageKey(storageId, lang), code);
  } catch {
    /* ignore quota */
  }
}

function InformaticsCodeEditorPanelInner({
  storageId = SIDEBAR_CODE_STORAGE_ID,
  taskSources = [],
  getTaskSources,
  activeTaskId = null,
  onActiveTaskChange,
  active = true,
  hostRef,
}: Props) {
  const [language, setLanguage] = useState<CodeLanguage>("python");
  const [tab, setTab] = useState<TabId>("editor");
  const [running, setRunning] = useState(false);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [vfs] = useState(() => new VirtualFs());
  const [runWarnings, setRunWarnings] = useState<string[]>([]);
  const [stdinPrefill, setStdinPrefill] = useState("");

  const getCodeRef = useRef(() => "");
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const handleRunRef = useRef<() => void>(() => {});
  const liveOutputRef = useRef({ stdout: "", stderr: "" });
  const flushFrameRef = useRef<number | null>(null);

  const flushLiveOutput = useCallback(() => {
    flushFrameRef.current = null;
    setResult((prev) => ({
      stdout: liveOutputRef.current.stdout,
      stderr: liveOutputRef.current.stderr,
      timedOut: prev?.timedOut,
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

  const turtleHostId = useMemo(
    () => `inf-turtle-host-${storageId}`,
    [storageId]
  );

  const inputCallCount = useMemo(
    () => countInputCalls(getCodeRef.current()),
    [tab, language, result, runtimeLoading]
  );
  const stdinLines = useMemo(
    () => stdinPrefill.split(/\r?\n/).map((line) => line.replace(/\r$/, "")),
    [stdinPrefill]
  );

  const activeFileUrl = useMemo(() => {
    const sources =
      taskSources.length > 0
        ? taskSources
        : tab === "files" && getTaskSources
          ? getTaskSources()
          : [];
    const task = sources.find(
      (t) => String(t.id) === String(activeTaskId ?? "")
    );
    return task?.fileUrl ?? null;
  }, [taskSources, getTaskSources, activeTaskId, tab]);

  const handleRun = useCallback(async () => {
    if (runningRef.current) return;

    const code = getCodeRef.current();
    const validation = validateProgram(code, language);
    if (!validation.ok) {
      setResult({
        stdout: "",
        stderr: "",
        error: validation.error,
      });
      setRunWarnings([]);
      setTab("output");
      return;
    }

    if (
      inputCallCount > 0 &&
      stdinLines.every((line) => line === "") &&
      language !== "python-turtle"
    ) {
      setTab("output");
      setRunWarnings([
        ...validation.warnings,
        `В коде ${inputCallCount} вызов(ов) input() — заполните «Входные данные» во вкладке «Вывод» (одна строка на каждый input()).`,
      ]);
      return;
    }

    if (validation.warnings.length) {
      const proceed = window.confirm(
        [
          "Перед запуском:",
          ...validation.warnings.map((w) => `• ${w}`),
          "",
          `Лимит: ${limitsSummary(language)}.`,
          "",
          "Запустить программу?",
        ].join("\n")
      );
      if (!proceed) return;
    }

    const stdinOptions =
      inputCallCount > 0 && stdinLines.some((line) => line !== "")
        ? { lines: stdinLines }
        : {};

    runningRef.current = true;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setRunning(true);
    setRuntimeLoading(true);
    setResult(null);
    setRunWarnings(validation.warnings);
    setTab("output");
    liveOutputRef.current = { stdout: "", stderr: "" };
    cancelFlush();

    let runRes: RunResult;
    try {
      if (language === "python") {
        const { runPythonPyodide } = await import("./runners/pythonPyodide");
        runRes = await runPythonPyodide(code, vfs, ac.signal, {
          ...stdinOptions,
          onReady: () => setRuntimeLoading(false),
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
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r))
        );
        if (!document.getElementById(turtleHostId)) {
          throw new Error("Холст Turtle не найден");
        }
        const { runPythonSkulpt } = await import("./runners/pythonSkulpt");
        runRes = await runPythonSkulpt(
          code,
          vfs,
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
      };
    } finally {
      runningRef.current = false;
      setRunning(false);
      setRuntimeLoading(false);
      cancelFlush();
    }

    if (!ac.signal.aborted) setResult(runRes);
  }, [
    language,
    vfs,
    turtleHostId,
    inputCallCount,
    stdinLines,
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

  const code = getCodeRef.current();
  const codeLines = code ? code.split(/\r?\n/).length : 0;
  const codeNearLimit =
    code.length > RUN_LIMITS.maxCodeChars * 0.85 ||
    codeLines > RUN_LIMITS.maxCodeLines * 0.85;

  const langMeta = CODE_LANGUAGES.find((l) => l.id === language);

  return (
    <div className="inf-code-editor-panel">
      <header className="inf-code-editor-header">
        <div className="inf-code-editor-header__main">
          <span className="inf-code-editor-eyebrow">Редактор кода</span>
          <h2 className="inf-code-editor-title">Python · Turtle</h2>
          {langMeta ? (
            <p className="inf-code-editor-subtitle">{langMeta.hint}</p>
          ) : null}
          <p className="inf-code-editor-limits" title="Ограничения среды выполнения">
            {limitsSummary(language)} · файлы до {(RUN_LIMITS.maxFileBytes / 1024).toFixed(0)} КБ
          </p>
        </div>
        <div className="inf-code-editor-header__controls">
          <div
            className="inf-code-editor-lang-pills"
            role="group"
            aria-label="Режим"
          >
            {CODE_LANGUAGES.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`inf-code-editor-lang-pill${language === l.id ? " is-active" : ""}`}
                aria-pressed={language === l.id}
                disabled={running}
                onClick={() => {
                  if (l.id === language) return;
                  saveStoredCode(storageId, language, getCodeRef.current());
                  setLanguage(l.id);
                  setResult(null);
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
          {running ? (
            <button
              type="button"
              className="inf-code-editor-stop"
              onClick={() => {
                abortRef.current?.abort();
                runningRef.current = false;
                setRunning(false);
                setRuntimeLoading(false);
                setResult((prev) => ({
                  stdout: prev?.stdout ?? "",
                  stderr: prev?.stderr ?? "",
                  error: "Выполнение остановлено.",
                }));
              }}
              title="Остановить выполнение"
            >
              ■
            </button>
          ) : null}
          <button
            type="button"
            className="inf-code-editor-run"
            onClick={() => void handleRun()}
            disabled={running}
            title="Запустить (Ctrl+Enter)"
          >
            {running ? "…" : "▶"}
          </button>
        </div>
      </header>

      {codeNearLimit && tab === "editor" ? (
        <p className="inf-code-editor-warn" role="status">
          Код близок к лимиту: {codeLines} / {RUN_LIMITS.maxCodeLines} строк,{" "}
          {code.length.toLocaleString("ru-RU")} /{" "}
          {RUN_LIMITS.maxCodeChars.toLocaleString("ru-RU")} символов.
        </p>
      ) : null}

      <div className="inf-code-editor-tabs" role="tablist">
        {(
          [
            ["editor", "Код"],
            ["files", "Файлы"],
            ["output", "Вывод"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`inf-code-editor-tab${tab === id ? " is-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className={`inf-code-editor-body${language === "python-turtle" ? " inf-code-editor-body--turtle" : ""}`}
      >
        {language === "python-turtle" ? (
          <div
            id={turtleHostId}
            className="inf-code-turtle-host"
            aria-label="Холст Turtle"
          />
        ) : null}

        <div className="inf-code-editor-panes">
          <div
            className={`inf-code-editor-pane inf-code-editor-pane--editor${tab !== "editor" ? " is-hidden" : ""}`}
          >
            <CodeTab
              storageId={storageId}
              language={language}
              running={running}
              visible={tab === "editor"}
              getCodeRef={getCodeRef}
            />
          </div>

          <div
            className={`inf-code-editor-pane inf-code-editor-pane--files${tab !== "files" ? " is-hidden" : ""}`}
          >
            <FilesTab
              vfs={vfs}
              activeFileUrl={activeFileUrl}
              visible={tab === "files"}
              taskSources={taskSources}
              getTaskSources={getTaskSources}
              activeTaskId={activeTaskId}
              onActiveTaskChange={onActiveTaskChange}
            />
          </div>

          <div
            className={`inf-code-editor-pane inf-code-editor-pane--output${tab !== "output" ? " is-hidden" : ""}`}
          >
            {runtimeLoading ? (
              <p className="inf-code-output-loading">
                Загрузка среды выполнения… Первый запуск может занять до минуты.
                Не закрывайте вкладку. Лимит выполнения —{" "}
                {language === "python"
                  ? RUN_LIMITS.pythonTimeoutSec
                  : RUN_LIMITS.turtleTimeoutSec}{" "}
                с.
              </p>
            ) : null}
            {runWarnings.length > 0 && !runtimeLoading ? (
              <ul className="inf-code-output-warnings">
                {runWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            {inputCallCount > 0 ? (
              <label className="inf-code-stdin">
                <span className="inf-code-stdin__label">
                  Входные данные для input() ({inputCallCount}{" "}
                  {inputCallCount === 1 ? "строка" : "строки"}, по одной на
                  вызов)
                </span>
                <textarea
                  className="inf-code-stdin__field"
                  value={stdinPrefill}
                  onChange={(e) => setStdinPrefill(e.target.value)}
                  placeholder={"42\nhello\n"}
                  rows={Math.min(6, Math.max(2, inputCallCount))}
                  spellCheck={false}
                  disabled={running}
                />
              </label>
            ) : null}
            <pre className="inf-code-output">
              {result?.stdout || ""}
              {result?.stderr ? `\n${result.stderr}` : ""}
              {result?.timedOut ? "\n\n⏱ Программа остановлена по лимиту времени." : ""}
              {result?.error ? `\n\n${result.error.startsWith("Ошибка") ? "" : "Ошибка:\n"}${result.error}` : ""}
              {running && !runtimeLoading && !result?.stdout && !result?.stderr
                ? "Выполнение…"
                : ""}
              {!result && !runtimeLoading && !running
                ? `Ctrl+Enter — запуск\n\n${limitsSummary(language)}`
                : ""}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(InformaticsCodeEditorPanelInner);
