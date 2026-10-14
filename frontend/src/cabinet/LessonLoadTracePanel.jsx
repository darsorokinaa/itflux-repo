import { useEffect, useState } from "react";

import { readScriptTrace } from "./lessonLoadTrace";

function measure(node, view = window) {
  if (!node || typeof node.getBoundingClientRect !== "function") return null;
  const rect = node.getBoundingClientRect();
  const style = view.getComputedStyle(node);
  return {
    w: Math.round(rect.width),
    h: Math.round(rect.height),
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
    overflow: style.overflow,
    position: style.position,
    width: style.width,
    height: style.height,
    maxWidth: style.maxWidth,
    maxHeight: style.maxHeight,
  };
}

function readBoardProbe() {
  const frame = document.querySelector("iframe.video-lesson-workspace__frame--board");
  const probe = {
    at: new Date().toISOString(),
    iframe: frame ? "yes" : "no",
    iframeBox: measure(frame),
    module: "нет отметки",
    mounted: "нет отметки",
    tldrawModule: "нет отметки",
    tldrawMounted: "нет отметки",
    provider: "",
    renderError: "",
    container: "нет",
    containerBox: null,
    canvasCount: 0,
    jsErrors: [],
    access: "",
  };
  if (!frame) return probe;
  let doc = null;
  let boardWindow = null;
  try {
    doc = frame.contentDocument;
    boardWindow = frame.contentWindow;
  } catch (err) {
    probe.access = String(err?.name || "blocked");
    return probe;
  }
  if (!doc) {
    probe.access = "document-null";
    return probe;
  }
  const trace = boardWindow?.__ITFLUX_BOARD_TRACE;
  if (trace) {
    probe.module = trace.gateModuleAt || "модуль шлюза не отметился";
    probe.mounted = trace.gateMountedAt || "компонент шлюза не смонтирован";
    probe.tldrawModule = trace.tldrawModuleAt || "модуль tldraw не отметился";
    probe.tldrawMounted = trace.tldrawMountedAt || "компонент tldraw не смонтирован";
    probe.provider = trace.provider || "";
    probe.renderError = trace.renderError || "";
    probe.jsErrors = Array.isArray(trace.jsErrors) ? trace.jsErrors.slice(-4) : [];
    if (trace.gateUnmountAt) probe.mounted = `размонтирован ${trace.gateUnmountAt}`;
  }
  const container = doc.querySelector("[data-testid='tldraw-board'], .cb-board-excalidraw-host, .cb-board-editor");
  probe.container = container ? (container.getAttribute("data-testid") || container.className || "yes") : "нет";
  probe.containerBox = container ? measure(container, boardWindow || window) : null;
  probe.canvasCount = doc.querySelectorAll("canvas").length;
  return probe;
}

function line(label, value) {
  return `${label}: ${value || "—"}`;
}

export function formatLessonLoadTrace(trace, board) {
  const attempt = trace.attempts?.[trace.attempts.length - 1];
  const rows = [
    "Диагностика урока. JWT не сохраняется.",
    line("попытка", trace.callSessionId || attempt?.callSessionId),
    line("загрузка", attempt ? String(attempt.n) : "скрипт ещё не создавался"),
    line("scriptUrl", attempt?.scriptUrl),
    line("тег создан", attempt?.createdAt),
    line("тег вставлен", attempt?.insertedAt),
    line("тег в документе на таймауте", attempt?.inDocumentAtTimeout == null ? "" : String(attempt.inDocumentAtTimeout)),
    line("load", attempt?.loadAt),
    line("error", attempt?.errorAt),
    line("JitsiMeetExternalAPI", attempt?.apiGlobalAt),
    line("тег удалён", attempt?.removedAt ? `${attempt.removedAt} ${attempt.removedReason}` : ""),
  ];
  const page = trace.pageEvents || [];
  page.slice(-6).forEach((event) => {
    const extra = event.scriptConnected == null ? "" : ` scriptConnected=${event.scriptConnected}`;
    rows.push(line(event.name, `${event.at}${extra}`));
  });
  const timing = attempt?.resourceTiming;
  rows.push(line("Resource Timing", timing?.available ? `${timing.entries.length} записей` : "API недоступен"));
  if (timing?.note) rows.push(timing.note);
  (timing?.entries || []).forEach((entry) => {
    rows.push(`${entry.name} status=${entry.responseStatus} duration=${entry.duration} transfer=${entry.transferSize}`);
  });
  const errors = trace.jsErrors || [];
  rows.push(line("ошибки JS страницы", errors.length ? "" : "нет"));
  errors.forEach((error) => rows.push(`${error.at} ${error.message} ${error.source}:${error.line}`));
  rows.push("--- доска, отдельно от звонка ---");
  if (!board) return rows.join("\n");
  rows.push(line("iframe доски", board.iframe));
  rows.push(line("размер iframe", board.iframeBox ? `${board.iframeBox.w}×${board.iframeBox.h} ${board.iframeBox.display} max-width=${board.iframeBox.maxWidth}` : ""));
  rows.push(line("модуль шлюза", board.module));
  rows.push(line("шлюз смонтирован", board.mounted));
  rows.push(line("модуль tldraw", board.tldrawModule));
  rows.push(line("tldraw смонтирован", board.tldrawMounted));
  rows.push(line("провайдер", board.provider));
  rows.push(line("контейнер", board.container));
  rows.push(line("размер контейнера", board.containerBox ? `${board.containerBox.w}×${board.containerBox.h} ${board.containerBox.display} h=${board.containerBox.height} max-width=${board.containerBox.maxWidth} overflow=${board.containerBox.overflow}` : ""));
  rows.push(line("canvas", String(board.canvasCount)));
  rows.push(line("ошибка рендера доски", board.renderError));
  rows.push(line("доступ к iframe", board.access));
  (board.jsErrors || []).forEach((error) => rows.push(`board-js ${error.at} ${error.message}`));
  return rows.join("\n");
}

export default function LessonLoadTracePanel() {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setText(formatLessonLoadTrace(readScriptTrace(), readBoardProbe()));
    };
    tick();
    timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div data-testid="lesson-load-trace" style={{ position: "fixed", left: 10, bottom: 10, zIndex: 40 }}>
      {open ? (
        <div
          id="lesson-load-trace-panel"
          style={{
            width: "min(420px, calc(100vw - 20px))",
            maxHeight: "42vh",
            overflow: "auto",
            marginBottom: 8,
            background: "#fff",
            color: "#111",
            border: "1px solid #94a3b8",
            borderRadius: 10,
            padding: "8px 10px",
            font: "12px/1.35 ui-monospace, monospace",
            boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          }}
        >
          <pre style={{ whiteSpace: "pre-wrap", margin: "0 0 8px" }}>{text}</pre>
          <button
            type="button"
            onClick={() => {
              const done = () => setCopied(true);
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(done);
              } else {
                done();
              }
            }}
          >
            {copied ? "Скопировано" : "Скопировать диагностику"}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Диагностика загрузки"
        aria-expanded={open}
        aria-controls="lesson-load-trace-panel"
        title="Диагностика загрузки"
        onClick={() => {
          setCopied(false);
          setOpen((value) => !value);
        }}
        style={{
          width: 28,
          height: 28,
          padding: 0,
          borderRadius: 999,
          border: "1px solid rgba(148, 163, 184, 0.7)",
          background: "rgba(255, 255, 255, 0.92)",
          color: "#334155",
          font: "700 13px/1 ui-sans-serif, system-ui, sans-serif",
          boxShadow: "0 2px 8px rgba(15, 23, 42, 0.16)",
          cursor: "pointer",
        }}
      >
        i
      </button>
    </div>
  );
}
