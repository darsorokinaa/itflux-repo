import { formatEducationalError } from "../errorFormatter";
import { RUN_LIMITS } from "../limits";
import type { StdinOptions } from "../stdinProvider";
import type { RunResult } from "../types";

export type RunOptions = StdinOptions & {
  onReady?: () => void;
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
  stdinRequired?: number;
  allFiles?: Record<string, string>;
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

function killWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function resultFromError(
  stdout: string,
  stderr: string,
  rawError: string,
  extras: Partial<RunResult> = {}
): RunResult {
  const edu = formatEducationalError(rawError);
  return {
    stdout,
    stderr,
    error: `${edu.type}: ${edu.message}${edu.line != null ? `\nСтрока ${edu.line}` : ""}${edu.hint ? `\n${edu.hint}` : ""}`,
    educationalError: {
      type: edu.type,
      message: edu.message,
      line: edu.line,
      hint: edu.hint,
    },
    errorLine: edu.line,
    ...extras,
  };
}

export async function runPythonPyodide(
  code: string,
  files: Record<string, string>,
  signal?: AbortSignal,
  options: RunOptions = {}
): Promise<RunResult> {
  if (signal?.aborted) {
    return resultFromError("", "", "Выполнение остановлено.");
  }

  const activeWorker = getWorker();
  let stdout = "";
  let stderr = "";
  let truncated = false;

  const mergedFiles = { ...files };
  if (options.allFiles) {
    Object.assign(mergedFiles, options.allFiles);
  }

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
            finish(
              resultFromError(stdout, stderr, `Превышено время выполнения (${RUN_LIMITS.pythonTimeoutSec} с).`, {
                timedOut: true,
              })
            );
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
              ? { error: TRUNCATED_MESSAGE, truncated: true }
              : {}),
          });
          break;
        case "run-error":
          finish(
            resultFromError(stdout, stderr, message.message, {
              ...(truncated || message.truncated
                ? { truncated: true }
                : {}),
            })
          );
          break;
        case "error":
          killWorker();
          finish(resultFromError(stdout, stderr, message.message));
          break;
      }
    };

    const onError = (event: ErrorEvent) => {
      killWorker();
      finish(
        resultFromError(stdout, stderr, event.message || "Ошибка среды выполнения.")
      );
    };

    const onAbort = () => {
      killWorker();
      finish(resultFromError(stdout, stderr, "Выполнение остановлено."));
    };

    activeWorker.addEventListener("message", onMessage);
    activeWorker.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });

    loadTimer = setTimeout(() => {
      killWorker();
      finish(
        resultFromError(stdout, stderr, "Среда выполнения не загрузилась за отведённое время.")
      );
    }, 90_000);

    activeWorker.postMessage({
      type: "run",
      code,
      files: mergedFiles,
      stdinLines: options.lines ?? [],
      stdinRequired: options.stdinRequired ?? 0,
    });
  });
}

export function preloadPyodide() {
  /* Pyodide грузится по кнопке «Запустить» */
}
