import { RUN_LIMITS } from "./limits";

export type StdinOptions = {
  /** Строки для последовательных вызовов input() — по одной на строку */
  lines?: string[];
};

export function createSkulptInputfun(options: StdinOptions = {}) {
  const queue = [...(options.lines ?? [])];
  let index = 0;

  return (promptText: string) => {
    if (index < queue.length) {
      return queue[index++];
    }
    throw new Error(
      "Недостаточно входных данных: программа запросила ввод, но строки во «Входных данных» закончились."
    );
  };
}

/** Подсчёт input() во всех файлах проекта */
export function countInputCalls(code: string, extraFiles: Record<string, string> = {}) {
  let total = (code.match(/\binput\s*\(/g) ?? []).length;
  for (const c of Object.values(extraFiles)) {
    total += (c.match(/\binput\s*\(/g) ?? []).length;
  }
  return total;
}

export function validateStdinLines(
  inputCallCount: number,
  lines: string[]
): { ok: boolean; error?: string } {
  if (inputCallCount === 0) return { ok: true };
  const nonEmpty = lines.filter((l) => l !== "");
  if (nonEmpty.length === 0) {
    return {
      ok: false,
      error: `В коде ${inputCallCount} вызов(ов) input() — заполните «Входные данные» (одна строка на каждый вызов).`,
    };
  }
  if (lines.length < inputCallCount) {
    return {
      ok: false,
      error: `Недостаточно входных данных: нужно ${inputCallCount} строк(и), указано ${lines.length}.`,
    };
  }
  return { ok: true };
}

export { RUN_LIMITS };
