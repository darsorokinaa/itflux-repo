/** Состояния инициализации доски и диагностические метрики. */

export type BoardLoadPhase =
  | "initializing"
  | "loading_scene"
  | "loading_files"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "error";

export type BoardLoadMetrics = {
  startedAt: number;
  sceneLoadedAt: number | null;
  filesLoadedAt: number | null;
  wsConnectedAt: number | null;
  readyAt: number | null;
  elementCount: number;
  fileCount: number;
  sceneBytesApprox: number;
  reconnectCount: number;
  lastError: string | null;
  lastErrorCode: string | null;
};

export function createBoardLoadMetrics(): BoardLoadMetrics {
  return {
    startedAt: performance.now(),
    sceneLoadedAt: null,
    filesLoadedAt: null,
    wsConnectedAt: null,
    readyAt: null,
    elementCount: 0,
    fileCount: 0,
    sceneBytesApprox: 0,
    reconnectCount: 0,
    lastError: null,
    lastErrorCode: null,
  };
}

/** Безопасный лог метрик — без содержимого сцены и URL. */
export function logBoardMetrics(phase: BoardLoadPhase, metrics: BoardLoadMetrics): void {
  if (typeof console === "undefined" || !console.info) return;
  const now = performance.now();
  const base = metrics.startedAt;
  console.info("[board]", {
    phase,
    initMs: Math.round(now - base),
    sceneMs: metrics.sceneLoadedAt != null ? Math.round(metrics.sceneLoadedAt - base) : null,
    filesMs: metrics.filesLoadedAt != null ? Math.round(metrics.filesLoadedAt - base) : null,
    wsMs: metrics.wsConnectedAt != null ? Math.round(metrics.wsConnectedAt - base) : null,
    readyMs: metrics.readyAt != null ? Math.round(metrics.readyAt - base) : null,
    elements: metrics.elementCount,
    files: metrics.fileCount,
    sceneKb: Math.round(metrics.sceneBytesApprox / 1024),
    reconnects: metrics.reconnectCount,
    error: metrics.lastErrorCode,
  });
}

export function estimateSceneBytes(scene: {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
} | null | undefined): number {
  if (!scene) return 0;
  try {
    return JSON.stringify({
      elements: scene.elements || [],
      appState: scene.appState || {},
      // Только ключи файлов и длины URL — не сами бинарники.
      files: Object.fromEntries(
        Object.entries(scene.files || {}).map(([id, meta]) => {
          const m = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
          const url = String(m.dataURL || m.url || "");
          return [id, { mime: m.mimeType, urlLen: url.length, stable: !url.startsWith("data:") && !url.startsWith("blob:") }];
        }),
      ),
    }).length;
  } catch {
    return 0;
  }
}

export function phaseLabel(phase: BoardLoadPhase): string {
  switch (phase) {
    case "initializing":
      return "Подготовка доски…";
    case "loading_scene":
      return "Загрузка сцены…";
    case "loading_files":
      return "Загрузка изображений…";
    case "connecting":
      return "Подключение к совместной работе…";
    case "ready":
      return "Готово";
    case "reconnecting":
      return "Восстанавливаем соединение…";
    case "error":
      return "Ошибка загрузки";
    default:
      return "Загрузка…";
  }
}
