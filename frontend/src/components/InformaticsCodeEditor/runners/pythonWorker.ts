/// <reference lib="webworker" />

/**
 * Web Worker: безопасное выполнение Python (Pyodide) вне главного потока.
 */

import { PYODIDE_SECURITY_PREAMBLE } from "../pythonSecurity";

const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const MAX_OUTPUT_CHARS = 32_000;

type RunMessage = {
  type: "run";
  code: string;
  files: Record<string, string>;
  stdinLines: string[];
  stdinRequired: number;
};

type PyodideInstance = {
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (opts: { write?: (buffer: Uint8Array) => number }) => void;
  setStderr: (opts: { write?: (buffer: Uint8Array) => number }) => void;
  setStdin: (opts: {
    stdin?: () => string | null;
    autoEOF?: boolean;
  }) => void;
  FS: {
    writeFile: (path: string, data: string) => void;
    mkdir: (path: string) => void;
  };
};

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let pyodidePromise: Promise<PyodideInstance> | null = null;

async function getPyodide(): Promise<PyodideInstance> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const mod = (await import(
        /* @vite-ignore */ `${PYODIDE_BASE}pyodide.mjs`
      )) as {
        loadPyodide: (opts: { indexURL: string }) => Promise<PyodideInstance>;
      };
      const pyodide = await mod.loadPyodide({ indexURL: PYODIDE_BASE });
      try {
        pyodide.FS.mkdir("/home");
      } catch {
        /* exists */
      }
      try {
        pyodide.FS.mkdir("/home/user");
      } catch {
        /* exists */
      }
      return pyodide;
    })();
  }
  return pyodidePromise;
}

function post(message: unknown) {
  ctx.postMessage(message);
}

ctx.onmessage = async (event: MessageEvent<RunMessage>) => {
  const data = event.data;
  if (!data || data.type !== "run") return;

  const { code, files, stdinLines, stdinRequired } = data;

  let pyodide: PyodideInstance;
  try {
    pyodide = await getPyodide();
  } catch {
    post({
      type: "error",
      message: "Не удалось загрузить среду выполнения (Pyodide).",
    });
    return;
  }

  post({ type: "ready" });

  for (const [name, content] of Object.entries(files)) {
    try {
      pyodide.FS.writeFile(`/home/user/${name}`, content);
    } catch {
      /* skip */
    }
  }

  let outputTotal = 0;
  let truncated = false;
  const decoder = new TextDecoder();

  const makeWrite =
    (stream: "stdout" | "stderr") => (buffer: Uint8Array) => {
      const byteLength = buffer.byteLength;
      if (truncated) return byteLength;
      const text = decoder.decode(buffer);
      const room = MAX_OUTPUT_CHARS - outputTotal;
      if (room <= 0) {
        truncated = true;
        post({ type: "truncated" });
        return byteLength;
      }
      const slice = text.length > room ? text.slice(0, room) : text;
      outputTotal += slice.length;
      post({ type: stream, text: slice });
      if (text.length > room) {
        truncated = true;
        post({ type: "truncated" });
      }
      return byteLength;
    };

  pyodide.setStdout({ write: makeWrite("stdout") });
  pyodide.setStderr({ write: makeWrite("stderr") });

  let stdinIndex = 0;
  pyodide.setStdin({
    stdin: () => {
      if (stdinIndex < stdinLines.length) {
        return `${stdinLines[stdinIndex++]}\n`;
      }
      if (stdinRequired > stdinIndex) {
        throw new Error(
          "EOFError: Недостаточно входных данных — добавьте строки во «Входные данные»."
        );
      }
      return null;
    },
    autoEOF: false,
  });

  const wrapped = `
import os as _os, sys as _sys
${PYODIDE_SECURITY_PREAMBLE}
_os.chdir("/home/user")
if "/home/user" not in _sys.path:
    _sys.path.insert(0, "/home/user")
try:
    _sys.stdout.reconfigure(line_buffering=True)
    _sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass
${code}
`;

  try {
    await pyodide.runPythonAsync(wrapped);
    post({ type: "done", truncated });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err ?? "Ошибка выполнения");
    post({ type: "run-error", message, truncated });
  }
};
