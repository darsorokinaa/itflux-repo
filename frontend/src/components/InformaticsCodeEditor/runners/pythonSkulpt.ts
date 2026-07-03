import { formatEducationalError } from "../errorFormatter";
import { loadScript } from "../loadScript";
import { RUN_LIMITS, truncateOutput, withExecutionTimeout } from "../limits";
import { createSkulptInputfun, type StdinOptions } from "../stdinProvider";
import type { RunResult } from "../types";

const SKULPT_BASE = "https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/";

declare global {
  interface Window {
    Sk?: SkulptGlobal;
  }
}

type SkulptGlobal = {
  configure: (opts: Record<string, unknown>) => void;
  misceval: {
    asyncToPromise: (fn: () => unknown) => Promise<unknown>;
  };
  importMainWithBody: (
    name: string,
    canSuspend: boolean,
    body: string,
    canSuspend2: boolean
  ) => unknown;
  builtinFiles: { files: Record<string, string> };
  python3?: unknown;
  TurtleGraphics?: { target: string; width?: number; height?: number };
  builtin?: {
    str?: (v: unknown) => { v: string };
  };
};

let skulptPromise: Promise<SkulptGlobal> | null = null;

function formatSkulptError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const sk = err as {
    args?: { v?: Array<{ v?: unknown }> };
    traceback?: Array<{ filename?: string; lineno?: number }>;
  };
  const parts: string[] = [];
  const msg = sk.args?.v?.[0]?.v;
  if (msg != null) parts.push(String(msg));
  const tb = sk.traceback?.[0];
  if (tb?.lineno != null) {
    parts.push(`  File "${tb.filename ?? "<stdin>"}", line ${tb.lineno}`);
  }
  if (!parts.length) parts.push(String(err));
  return parts.join("\n");
}

function skulptRead(
  Sk: SkulptGlobal,
  files: Record<string, string>,
  name: string
): string {
  const normalized = name.replace(/^\/+/, "");
  if (files[normalized] !== undefined) return files[normalized];
  if (files[name] !== undefined) return files[name];
  if (
    Sk.builtinFiles === undefined ||
    Sk.builtinFiles.files[name] === undefined
  ) {
    throw `File not found: '${name}'`;
  }
  return Sk.builtinFiles.files[name];
}

async function ensureSkulpt(signal?: AbortSignal): Promise<SkulptGlobal> {
  if (signal?.aborted) {
    throw new Error("Отменено");
  }
  if (!skulptPromise) {
    skulptPromise = (async () => {
      await loadScript(`${SKULPT_BASE}skulpt.min.js`);
      await loadScript(`${SKULPT_BASE}skulpt-stdlib.min.js`);
      if (!window.Sk) throw new Error("Skulpt не загрузился");
      return window.Sk;
    })();
  }
  return withExecutionTimeout(skulptPromise, 60_000, signal);
}

export function preloadSkulpt() {
  /* Skulpt грузится по кнопке «Запустить» */
}

export async function runPythonSkulpt(
  code: string,
  allFiles: Record<string, string>,
  turtleTargetId: string,
  signal?: AbortSignal,
  stdinOptions: StdinOptions = {}
): Promise<RunResult> {
  const Sk = await ensureSkulpt(signal);
  let stdout = "";
  let stdoutTruncated = false;

  const host = document.getElementById(turtleTargetId);
  if (host) {
    host.innerHTML = "";
  }

  Sk.TurtleGraphics = {
    target: turtleTargetId,
    width: 480,
    height: 360,
  };

  Sk.configure({
    output: (text: string) => {
      if (stdout.length >= RUN_LIMITS.maxOutputChars) {
        stdoutTruncated = true;
        return;
      }
      const room = RUN_LIMITS.maxOutputChars - stdout.length;
      stdout += text.length > room ? text.slice(0, room) : text;
      if (text.length > room) stdoutTruncated = true;
    },
    read: (file: string) => skulptRead(Sk, allFiles, file),
    inputfun: createSkulptInputfun(stdinOptions),
    inputfunTakesPrompt: true,
    execLimit: RUN_LIMITS.turtleExecLimit,
    __future__: Sk.python3,
    killableWhile: true,
  });

  try {
    await withExecutionTimeout(
      Sk.misceval.asyncToPromise(() =>
        Sk.importMainWithBody("<stdin>", false, code, true)
      ),
      RUN_LIMITS.turtleTimeoutSec * 1000,
      signal
    );

    const out = truncateOutput(stdout);
    return {
      stdout: out.text,
      stderr: "",
      usedTurtle: true,
      ...(stdoutTruncated || out.truncated
        ? {
            error:
              "Вывод программы обрезан — уменьшите количество print() или шагов черепахи.",
            truncated: true,
          }
        : {}),
    };
  } catch (e) {
    const raw =
      e instanceof Error ? formatSkulptError(e) || e.message : formatSkulptError(e);
    const timedOut =
      /время выполнения/i.test(raw) || /TimeLimitError|execLimit/i.test(raw);
    const edu = formatEducationalError(raw);
    const out = truncateOutput(stdout);
    return {
      stdout: out.text,
      stderr: "",
      usedTurtle: true,
      error: timedOut
        ? `Программа остановлена: слишком долгое выполнение (лимит ${RUN_LIMITS.turtleTimeoutSec} с или ${RUN_LIMITS.turtleExecLimit.toLocaleString("ru-RU")} шагов).`
        : `${edu.type}: ${edu.message}${edu.line != null ? `\nСтрока ${edu.line}` : ""}${edu.hint ? `\n${edu.hint}` : ""}`,
      educationalError: timedOut
        ? undefined
        : {
            type: edu.type,
            message: edu.message,
            line: edu.line,
            hint: edu.hint,
          },
      errorLine: edu.line,
      timedOut,
    };
  }
}
