import { RUN_LIMITS } from "./limits";

export type StdinOptions = {
  /** Строки для последовательных вызовов input() — по одной на строку */
  lines?: string[];
};

/** Захват stdout через единственный write-обработчик Pyodide */
export function createPyodideStdoutCapture(
  onChunk: (text: string) => void,
  maxChars = RUN_LIMITS.maxOutputChars
) {
  let total = 0;
  let stopped = false;
  const decoder = new TextDecoder();

  const write = (buffer: Uint8Array) => {
    if (stopped) return buffer.byteLength;
    const text = decoder.decode(buffer);
    const room = maxChars - total;
    if (room <= 0) {
      stopped = true;
      return buffer.byteLength;
    }
    const slice = text.length > room ? text.slice(0, room) : text;
    total += slice.length;
    onChunk(slice);
    if (text.length > room) stopped = true;
    return buffer.byteLength;
  };

  return {
    write,
    isTruncated: () => stopped,
  };
}

export function createPyodideStdinHandler(options: StdinOptions = {}) {
  const queue = [...(options.lines ?? [])];
  let index = 0;
  let pendingPrompt = "";

  return {
    noteStdout(chunk: string) {
      pendingPrompt += chunk;
    },
    handler: () => {
      if (index < queue.length) {
        pendingPrompt = "";
        return queue[index++];
      }
      const msg = pendingPrompt.trimEnd() || "Ввод";
      pendingPrompt = "";
      return window.prompt(msg) ?? "";
    },
  };
}

export function createSkulptInputfun(options: StdinOptions = {}) {
  const queue = [...(options.lines ?? [])];
  let index = 0;

  return (promptText: string) => {
    if (index < queue.length) {
      return queue[index++];
    }
    const msg = String(promptText || "").trim() || "Ввод";
    return window.prompt(msg) ?? "";
  };
}

export function countInputCalls(code: string) {
  return (code.match(/\binput\s*\(/g) ?? []).length;
}
