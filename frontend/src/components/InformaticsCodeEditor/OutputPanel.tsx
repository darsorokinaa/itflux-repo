import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { OutputTabId, RunResult, RunStatus } from "./types";
import { RUN_STATUS_LABELS } from "./types";

const OUTPUT_HEIGHT_KEY = "inf-code-output-height";
const DEFAULT_HEIGHT = 200;
const MIN_HEIGHT = 120;
const MAX_HEIGHT_RATIO = 0.7;

function loadOutputHeight(): number {
  try {
    const raw = localStorage.getItem(OUTPUT_HEIGHT_KEY);
    if (!raw) return DEFAULT_HEIGHT;
    const n = Number(raw);
    return Number.isFinite(n) && n >= MIN_HEIGHT ? n : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

function saveOutputHeight(height: number) {
  try {
    localStorage.setItem(OUTPUT_HEIGHT_KEY, String(Math.round(height)));
  } catch {
    /* ignore */
  }
}

type Props = {
  activeTab: OutputTabId;
  onTabChange: (tab: OutputTabId) => void;
  result: RunResult | null;
  runStatus: RunStatus;
  runtimeLoading: boolean;
  running: boolean;
  stdinPrefill: string;
  onStdinChange: (value: string) => void;
  inputCallCount: number;
  runWarnings: string[];
  turtleHostId: string;
  showTurtleTab: boolean;
};

function OutputPanelInner({
  activeTab,
  onTabChange,
  result,
  runStatus,
  runtimeLoading,
  running,
  stdinPrefill,
  onStdinChange,
  inputCallCount,
  runWarnings,
  turtleHostId,
  showTurtleTab,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(loadOutputHeight);
  const dragRef = useRef({ active: false, startY: 0, startH: 0 });

  const clampHeight = useCallback((value: number) => {
    const parent = panelRef.current?.parentElement;
    const maxH = parent
      ? Math.max(MIN_HEIGHT, parent.clientHeight * MAX_HEIGHT_RATIO)
      : 480;
    return Math.min(maxH, Math.max(MIN_HEIGHT, value));
  }, []);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { active: true, startY: e.clientY, startH: height };
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [height]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const delta = dragRef.current.startY - e.clientY;
      setHeight(clampHeight(dragRef.current.startH + delta));
    };

    const onUp = () => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setHeight((h) => {
        saveOutputHeight(h);
        return h;
      });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [clampHeight]);

  const hasError = Boolean(result?.error || result?.educationalError);
  const hasStdout = Boolean(result?.stdout?.trim());
  const statusClass =
    runStatus === "error" || runStatus === "timeout"
      ? "is-error"
      : runStatus === "running" || runStatus === "loading"
        ? "is-running"
        : runStatus === "stopped"
          ? "is-stopped"
          : "";

  const tabs: { id: OutputTabId; label: string; show?: boolean }[] = [
    { id: "stdout", label: "Вывод" },
    { id: "errors", label: "Ошибки", show: hasError || runWarnings.length > 0 },
    { id: "turtle", label: "Turtle", show: showTurtleTab },
    { id: "stdin", label: "Входные данные", show: inputCallCount > 0 },
  ];

  return (
    <div
      ref={panelRef}
      className="inf-code-output-panel"
      style={{ height }}
    >
      <div
        className="inf-code-output-panel__resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Потяните, чтобы изменить высоту панели вывода"
        title="Потяните для изменения высоты"
      />

      <div className="inf-code-output-panel__bar">
        <div className="inf-code-output-panel__tabs" role="tablist">
          {tabs
            .filter((t) => t.show !== false)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={`inf-code-output-panel__tab${activeTab === t.id ? " is-active" : ""}${t.id === "errors" && hasError ? " has-error" : ""}`}
                onClick={() => onTabChange(t.id)}
              >
                {t.label}
              </button>
            ))}
        </div>
        <span
          className={`inf-code-output-panel__status inf-code-output-panel__status--badge ${statusClass}`}
          role="status"
          aria-live="polite"
        >
          {RUN_STATUS_LABELS[runStatus]}
          {runtimeLoading ? " · загрузка" : ""}
        </span>
      </div>

      <div className="inf-code-output-panel__body">
        {activeTab === "stdout" ? (
          <pre
            className={`inf-code-output inf-code-output--stdout${!result?.stdout && !running && !runtimeLoading ? " is-placeholder" : ""}`}
          >
            {runtimeLoading
              ? "Загрузка среды выполнения… Первый запуск может занять до минуты."
              : ""}
            {running && !runtimeLoading && !hasStdout ? "Выполнение…" : ""}
            {result?.stdout || (!result && !running && !runtimeLoading ? "Нажмите «Запустить» или Ctrl+Enter, чтобы увидеть результат" : "")}
            {result?.stderr ? `\n${result.stderr}` : ""}
            {result?.timedOut ? "\n\nПрограмма остановлена по лимиту времени." : ""}
          </pre>
        ) : null}

        {activeTab === "errors" ? (
          <div className="inf-code-output inf-code-output--errors">
            {runWarnings.length > 0 ? (
              <ul className="inf-code-output-warnings">
                {runWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            {result?.educationalError ? (
              <div className="inf-code-error-card">
                <div className="inf-code-error-card__type">
                  {result.educationalError.type}
                </div>
                <div className="inf-code-error-card__message">
                  {result.educationalError.message}
                </div>
                {result.educationalError.line != null ? (
                  <div className="inf-code-error-card__line">
                    Строка {result.educationalError.line}
                  </div>
                ) : null}
                {result.educationalError.hint ? (
                  <div className="inf-code-error-card__hint">
                    {result.educationalError.hint}
                  </div>
                ) : null}
              </div>
            ) : result?.error ? (
              <pre className="inf-code-error-card__raw">{result.error}</pre>
            ) : (
              <p className="inf-code-output--empty">Ошибок нет</p>
            )}
          </div>
        ) : null}

        {activeTab === "turtle" ? (
          <div className="inf-code-turtle-pane">
            <div
              id={turtleHostId}
              className="inf-code-turtle-host"
              aria-label="Холст Turtle"
            />
          </div>
        ) : null}

        {activeTab === "stdin" ? (
          <label className="inf-code-stdin">
            <span className="inf-code-stdin__label">
              Одна строка на каждый вызов input() ({inputCallCount}{" "}
              {inputCallCount === 1 ? "вызов" : "вызова"})
            </span>
            <textarea
              className="inf-code-stdin__field"
              value={stdinPrefill}
              onChange={(e) => onStdinChange(e.target.value)}
              placeholder={"Иван\n42\n"}
              rows={Math.min(8, Math.max(3, inputCallCount))}
              spellCheck={false}
              disabled={running}
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

export default memo(OutputPanelInner);
