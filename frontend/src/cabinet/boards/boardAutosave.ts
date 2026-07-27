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
