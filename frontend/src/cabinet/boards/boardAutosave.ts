/** Чистая логика автосохранения доски — удобно тестировать без DOM. */

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

/** Пауза после последнего изменения перед автосохранением (500–1000 мс). */
export const AUTOSAVE_DEBOUNCE_MS = 800;

export type BoardScenePayload = {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

const TRANSIENT_APP_STATE_KEYS = new Set([
  "collaborators",
  "cursorButton",
  "editingGroupId",
  "editingLinearElement",
  "activeTool",
  "multiElement",
  "selectedElementIds",
  "previousSelectedElementIds",
  "selectedGroupIds",
  "editingTextElement",
  "suggestedBindings",
  "isRotating",
  "isResizing",
  "openMenu",
  "openPopup",
  "openSidebar",
  "openDialog",
  "contextMenu",
  "showHyperlinkPopup",
  "toast",
  "pendingImageElementId",
  "newElement",
  "resizingElement",
  "selectionElement",
  "scrollX",
  "scrollY",
  "zoom",
  "offsetLeft",
  "offsetTop",
  "width",
  "height",
  "userToFollow",
  "followedBy",
  // Локальный режим стилуса — не персистить и не раздавать пирам.
  "penMode",
  "penDetected",
]);

export function sanitizeAppState(appState: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!appState || typeof appState !== "object") return {};
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(appState)) {
    if (TRANSIENT_APP_STATE_KEYS.has(key)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export function buildScenePayload(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown> | null | undefined,
): BoardScenePayload {
  return {
    elements: Array.isArray(elements) ? [...elements] : [],
    appState: sanitizeAppState(appState),
    files: files && typeof files === "object" ? { ...files } : {},
  };
}

/**
 * Excalidraw при рисовании мутирует элемент и тот же массив in-place (version++).
 * Сравнение по ссылке массива пропускает промежуточные точки штриха.
 */
export function boardElementsVersionSum(elements: readonly unknown[] | null | undefined): number {
  if (!elements?.length) return 0;
  let sum = 0;
  for (const raw of elements) {
    if (raw && typeof raw === "object") {
      sum += Number((raw as { version?: number }).version) || 0;
    }
  }
  return sum;
}

/**
 * Смена files для persist: новые/удалённые id, не новая обёртка-объект с теми же ключами.
 * Первый onChange (prev == null) не считается сменой.
 */
export function didExcalidrawFilesChange(prev: unknown, next: unknown): boolean {
  if (prev == null) return false;
  if (prev === next) return false;
  if (!prev || !next || typeof prev !== "object" || typeof next !== "object") return true;
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return true;
  for (const key of bKeys) {
    if (!Object.prototype.hasOwnProperty.call(a, key)) return true;
  }
  return false;
}

export type BoardPersistableChangeInput = {
  prevVersionSum: number;
  nextVersionSum: number;
  prevElementCount: number;
  nextElementCount: number;
  /** Сырой объект files из Excalidraw, не копия attachStableUrls. */
  prevRawFiles: unknown;
  nextRawFiles: unknown;
  prevBackground?: unknown;
  nextBackground?: unknown;
  prevGrid?: unknown;
  nextGrid?: unknown;
  prevTheme?: unknown;
  nextTheme?: unknown;
};

/**
 * Нужно ли сохранять/публиковать сцену.
 * Pan/zoom/scroll и прочий viewport не считаются изменением содержимого.
 *
 * Важно: не сравнивать files с копией attachStableUrls — она каждый кадр новая,
 * и pan ошибочно считался правкой доски.
 */
export function isBoardPersistableChange(input: BoardPersistableChangeInput): boolean {
  if (input.nextVersionSum !== input.prevVersionSum) return true;
  if (input.nextElementCount !== input.prevElementCount) return true;
  if (didExcalidrawFilesChange(input.prevRawFiles, input.nextRawFiles)) return true;
  if (input.prevBackground !== input.nextBackground) return true;
  if (input.prevGrid !== input.nextGrid) return true;
  if (input.prevTheme !== input.nextTheme) return true;
  return false;
}

export function saveStatusLabel(status: SaveStatus): string {
  switch (status) {
    case "saving":
      return "Сохранение…";
    case "saved":
      // Не показываем «Сохранено» постоянно — только процесс и ошибки.
      return "";
    case "error":
      return "Ошибка сохранения";
    case "conflict":
      return "Конфликт версий";
    case "dirty":
      return "";
    default:
      return "";
  }
}

export function shouldBlockUnload(status: SaveStatus, hasPending: boolean): boolean {
  return hasPending || status === "dirty" || status === "saving" || status === "error";
}

/**
 * После VERSION_CONFLICT 409: повторный PATCH только если пользователь
 * правил сцену после снимка, ушедшего в конфликтующий запрос.
 * Само применение remote merge не является локальной правкой.
 */
export function shouldRetryPersistAfterVersionConflict(
  localRevision: number,
  revisionAtSave: number,
): boolean {
  return localRevision > revisionAtSave;
}

export function isBoardSceneTooLargeError(error: {
  code?: string;
  status?: number;
  message?: string;
} | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "SCENE_TOO_LARGE") return true;
  if (error.status === 413) return true;
  const message = String(error.message || "");
  return /слишком больш|SCENE_TOO_LARGE|Request body exceeded|DATA_UPLOAD_MAX/i.test(message);
}

/** Простой debounce-хелпер для тестов и UI. */
export function createDebouncedSaver(
  saveFn: () => void | Promise<void>,
  delayMs: number = AUTOSAVE_DEBOUNCE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let queued = false;

  const run = async () => {
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    try {
      await saveFn();
    } finally {
      inFlight = false;
      if (queued) {
        queued = false;
        void run();
      }
    }
  };

  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return run();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    get isInFlight() {
      return inFlight;
    },
  };
}
