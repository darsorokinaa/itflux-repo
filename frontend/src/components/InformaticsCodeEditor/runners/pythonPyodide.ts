import { RUN_LIMITS } from "../limits";
import type { StdinOptions } from "../stdinProvider";
import type { RunResult } from "../types";
import type { VirtualFs } from "../virtualFs";

export type RunOptions = StdinOptions & {
  /** Вызывается, когда среда выполнения загрузилась и программа стартовала */
  onReady?: () => void;
  /** Вызывается на каждый кусок вывода — для печати «вживую» */
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
};

const TRUNCATED_MESSAGE =
  "Вывод программы обрезан — уменьшите количество print() или объём данных.";

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./pythonWorker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

/** Принудительно убивает воркер: единственный способ прервать синхронный код */
function killWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

export async function runPythonPyodide(
  code: string,
  vfs: VirtualFs,
  signal?: AbortSignal,
  options: RunOptions = {}
): Promise<RunResult> {
  if (signal?.aborted) {
    return { stdout: "", stderr: "", error: "Отменено" };
  }

  const activeWorker = getWorker();
  let stdout = "";
  let stderr = "";
  let truncated = false;

  return new Promise<RunResult>((resolve) => {
    let settled = false;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    let execTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      activeWorker.removeEventListener("message", onMessage);
      activeWorker.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      if (loadTimer !== undefined) clearTimeout(loadTimer);
      if (execTimer !== undefined) clearTimeout(execTimer);
    };

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      const message = event.data as
        | { type: "ready" }
        | { type: "stdout"; text: string }
        | { type: "stderr"; text: string }
        | { type: "truncated" }
        | { type: "done"; truncated?: boolean }
        | { type: "run-error"; message: string; truncated?: boolean }
        | { type: "error"; message: string };

      switch (message.type) {
        case "ready":
          if (loadTimer !== undefined) {
            clearTimeout(loadTimer);
            loadTimer = undefined;
          }
          options.onReady?.();
          execTimer = setTimeout(() => {
            killWorker();
            finish({
              stdout,
              stderr,
              timedOut: true,
              error: `Превышено время выполнения (${RUN_LIMITS.pythonTimeoutSec} с).`,
            });
          }, RUN_LIMITS.pythonTimeoutSec * 1000);
          break;
        case "stdout":
          stdout += message.text;
          options.onOutput?.(message.text, "stdout");
          break;
        case "stderr":
          stderr += message.text;
          options.onOutput?.(message.text, "stderr");
          break;
        case "truncated":
          truncated = true;
          break;
        case "done":
          finish({
            stdout,
            stderr,
            ...(truncated || message.truncated
              ? { error: TRUNCATED_MESSAGE }
              : {}),
          });
          break;
        case "run-error":
          finish({
            stdout,
            stderr,
            error: message.message,
            ...(truncated || message.truncated
              ? { error: `${message.message}\n\n${TRUNCATED_MESSAGE}` }
              : {}),
          });
          break;
        case "error":
          killWorker();
          finish({ stdout, stderr, error: message.message });
          break;
      }
    };

    const onError = (event: ErrorEvent) => {
      killWorker();
      finish({
        stdout,
        stderr,
        error: event.message || "Ошибка среды выполнения.",
      });
    };

    const onAbort = () => {
      killWorker();
      finish({ stdout, stderr, error: "Выполнение остановлено." });
    };

    activeWorker.addEventListener("message", onMessage);
    activeWorker.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });

    // Загрузка Pyodide (~15 МБ) при первом запуске может занять до ~90 с
    loadTimer = setTimeout(() => {
      killWorker();
      finish({
        stdout,
        stderr,
        error: "Среда выполнения не загрузилась за отведённое время.",
      });
    }, 90_000);

    activeWorker.postMessage({
      type: "run",
      code,
      files: vfs.toRecord(),
      stdinLines: options.lines ?? [],
    });
  });
}

export function preloadPyodide() {
  /* Pyodide (~15 МБ) грузится только по кнопке «Запустить» */
}
