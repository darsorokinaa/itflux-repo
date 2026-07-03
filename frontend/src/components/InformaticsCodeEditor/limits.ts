import { findBlockedImports } from "./pythonSecurity";
import type { CodeLanguage } from "./types";

/** Ограничения среды выполнения (показываются пользователю) */
export const RUN_LIMITS = {
  maxCodeChars: 20_000,
  maxCodeLines: 400,
  maxOutputChars: 32_000,
  pythonTimeoutSec: 20,
  turtleTimeoutSec: 15,
  turtleExecLimit: 80_000,
  maxVirtualFiles: 20,
  maxFileBytes: 256 * 1024,
  maxTotalVfsBytes: 1024 * 1024,
  maxUploadBytes: 512 * 1024,
  autosaveDebounceMs: 1500,
} as const;

export type ProgramValidation = {
  ok: boolean;
  error?: string;
  warnings: string[];
};

function countLines(code: string) {
  if (!code) return 0;
  return code.split(/\r?\n/).length;
}

function utf8Bytes(text: string) {
  return new TextEncoder().encode(text).byteLength;
}

/** Обрезает вывод с пометкой */
export function truncateOutput(text: string, max = RUN_LIMITS.maxOutputChars) {
  if (text.length <= max) return { text, truncated: false };
  return {
    text: `${text.slice(0, max)}\n\n… вывод обрезан (лимит ${max.toLocaleString("ru-RU")} символов)`,
    truncated: true,
  };
}

export function validateProgram(
  code: string,
  _language: CodeLanguage = "python",
  allFiles: Record<string, string> = {}
): ProgramValidation {
  const warnings: string[] = [];

  if (!code.trim()) {
    return { ok: false, error: "Введите код программы.", warnings };
  }

  const chars = code.length;
  const lines = countLines(code);

  if (chars > RUN_LIMITS.maxCodeChars) {
    return {
      ok: false,
      error: `Слишком длинный код: ${chars.toLocaleString("ru-RU")} символов (максимум ${RUN_LIMITS.maxCodeChars.toLocaleString("ru-RU")}).`,
      warnings,
    };
  }

  if (lines > RUN_LIMITS.maxCodeLines) {
    return {
      ok: false,
      error: `Слишком много строк: ${lines} (максимум ${RUN_LIMITS.maxCodeLines}).`,
      warnings,
    };
  }

  const allCode = [code, ...Object.values(allFiles)].join("\n");
  const blocked = findBlockedImports(allCode);
  if (blocked.length) {
    return {
      ok: false,
      error: `Модуль «${blocked[0]}» недоступен в учебном редакторе из соображений безопасности.`,
      warnings,
    };
  }

  if (/while\s+(True|1)\s*:/i.test(code)) {
    warnings.push(
      "Обнаружен бесконечный цикл while True — программа будет остановлена по таймауту."
    );
  }

  const hugeRange = code.match(/range\s*\(\s*(\d{6,})/g);
  if (hugeRange?.length) {
    warnings.push(
      "Большой range() может надолго занять браузер — уменьшите число итераций."
    );
  }

  const forCount = (code.match(/^\s*for\s+/gm) ?? []).length;
  if (forCount >= 3) {
    warnings.push(
      "Несколько вложенных циклов могут выполняться долго — следите за лимитом времени."
    );
  }

  if (/\bopen\s*\(/.test(code)) {
    warnings.push(
      "open() читает файлы из панели «Файлы»; не загружайте слишком большие файлы."
    );
  }

  if (/\binput\s*\(/.test(code)) {
    warnings.push(
      "Для input() заполните «Входные данные» — по одной строке на каждый вызов."
    );
  }

  return { ok: true, warnings };
}

export function validateFileContent(name: string, content: string): ProgramValidation {
  const warnings: string[] = [];
  const bytes = utf8Bytes(content);

  if (bytes > RUN_LIMITS.maxFileBytes) {
    return {
      ok: false,
      error: `Файл «${name}» слишком большой: ${formatBytes(bytes)} (максимум ${formatBytes(RUN_LIMITS.maxFileBytes)}).`,
      warnings,
    };
  }

  return { ok: true, warnings };
}

export function validateVfsQuota(
  files: Map<string, string>,
  nextName?: string,
  nextContent?: string
): ProgramValidation {
  const warnings: string[] = [];
  const projected = new Map(files);

  if (nextName != null && nextContent != null) {
    projected.set(nextName, nextContent);
  }

  if (projected.size > RUN_LIMITS.maxVirtualFiles) {
    return {
      ok: false,
      error: `Слишком много файлов: ${projected.size} (максимум ${RUN_LIMITS.maxVirtualFiles}).`,
      warnings,
    };
  }

  let total = 0;
  for (const content of projected.values()) {
    total += utf8Bytes(content);
  }

  if (total > RUN_LIMITS.maxTotalVfsBytes) {
    return {
      ok: false,
      error: `Суммарный размер файлов ${formatBytes(total)} превышает лимит ${formatBytes(RUN_LIMITS.maxTotalVfsBytes)}.`,
      warnings,
    };
  }

  return { ok: true, warnings };
}

export function validateUploadSize(bytes: number): ProgramValidation {
  if (bytes > RUN_LIMITS.maxUploadBytes) {
    return {
      ok: false,
      error: `Файл слишком большой: ${formatBytes(bytes)} (максимум ${formatBytes(RUN_LIMITS.maxUploadBytes)}).`,
      warnings: [],
    };
  }
  return { ok: true, warnings: [] };
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function limitsSummary() {
  return `До ${RUN_LIMITS.maxCodeLines} строк · ${RUN_LIMITS.pythonTimeoutSec} с на запуск · вывод до ${(RUN_LIMITS.maxOutputChars / 1000).toFixed(0)} тыс. символов`;
}

export function withExecutionTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Отменено"));
      return;
    }

    const timer = window.setTimeout(() => {
      reject(new Error(`Превышено время выполнения (${Math.round(ms / 1000)} с).`));
    }, ms);

    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new Error("Выполнение остановлено."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}
