/** Сжатие сцены доски: tombstones удалённых элементов и неиспользуемые files. */

export type BoardSceneLike = {
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

export type BoardSceneStats = {
  elementCount: number;
  deletedCount: number;
  liveCount: number;
  fileCount: number;
  unusedFileCount: number;
  elementsBytes: number;
  filesBytes: number;
  sceneBytes: number;
};

export type CompactBoardSceneResult = {
  scene: {
    elements: unknown[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  };
  changed: boolean;
  statsBefore: BoardSceneStats;
  statsAfter: BoardSceneStats;
};

const TOMBSTONE_KEYS = [
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "angle",
  "isDeleted",
  "version",
  "versionNonce",
  "updated",
  "index",
  "customData",
  "fileId",
  "frameId",
  "groupIds",
  "locked",
  "seed",
  "name",
] as const;

function utf8Bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function referencedFileIds(elements: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const raw of elements) {
    const el = asRecord(raw);
    if (!el) continue;
    const fileId = el.fileId;
    if (typeof fileId === "string" && fileId) ids.add(fileId);
  }
  return ids;
}

function isBulkyDeleted(el: Record<string, unknown>): boolean {
  if (!el.isDeleted) return false;
  const points = el.points;
  if (Array.isArray(points) && points.length > 1) return true;
  const pressures = el.pressures;
  if (Array.isArray(pressures) && pressures.length > 1) return true;
  for (const key of ["text", "originalText", "rawText"] as const) {
    const value = el[key];
    if (typeof value === "string" && value.length > 0) return true;
  }
  return false;
}

function compactDeletedElement(el: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const key of TOMBSTONE_KEYS) {
    if (key in el) next[key] = el[key];
  }
  next.isDeleted = true;
  if (el.type === "freedraw") {
    next.points = [[0, 0]];
    if ("pressures" in el) next.pressures = [];
  }
  return next;
}

export function summarizeBoardScene(scene: BoardSceneLike | null | undefined): BoardSceneStats {
  const elements = Array.isArray(scene?.elements) ? scene!.elements! : [];
  const files = scene?.files && typeof scene.files === "object" ? scene.files : {};
  let deletedCount = 0;
  for (const raw of elements) {
    const el = asRecord(raw);
    if (el?.isDeleted) deletedCount += 1;
  }
  const used = referencedFileIds(elements);
  let unusedFileCount = 0;
  for (const id of Object.keys(files)) {
    if (!used.has(id)) unusedFileCount += 1;
  }
  const elementsBytes = utf8Bytes(elements);
  const filesBytes = utf8Bytes(files);
  return {
    elementCount: elements.length,
    deletedCount,
    liveCount: elements.length - deletedCount,
    fileCount: Object.keys(files).length,
    unusedFileCount,
    elementsBytes,
    filesBytes,
    sceneBytes: utf8Bytes({
      elements,
      appState: scene?.appState || {},
      files,
    }),
  };
}

/**
 * Идемпотентное сжатие: живые элементы не трогаем.
 * Удалённые freedraw/text теряют геометрию/текст (для collab остаются tombstones).
 * Files без ссылки из элементов (включая deleted image.fileId) удаляются из JSON.
 */
export function compactBoardScene(scene: BoardSceneLike | null | undefined): CompactBoardSceneResult {
  const elementsIn = Array.isArray(scene?.elements) ? scene!.elements! : [];
  const appState = scene?.appState && typeof scene.appState === "object" ? scene.appState : {};
  const filesIn = scene?.files && typeof scene.files === "object" ? scene.files : {};
  const statsBefore = summarizeBoardScene({
    elements: elementsIn,
    appState,
    files: filesIn,
  });

  let changed = false;
  const elements: unknown[] = new Array(elementsIn.length);
  for (let i = 0; i < elementsIn.length; i += 1) {
    const raw = elementsIn[i];
    const el = asRecord(raw);
    if (!el || !el.isDeleted || !isBulkyDeleted(el)) {
      elements[i] = raw;
      continue;
    }
    elements[i] = compactDeletedElement(el);
    changed = true;
  }

  const used = referencedFileIds(elements);
  const files: Record<string, unknown> = {};
  for (const [id, meta] of Object.entries(filesIn)) {
    if (used.has(id)) {
      files[id] = meta;
    } else {
      changed = true;
    }
  }

  const nextScene = { elements, appState, files };
  return {
    scene: nextScene,
    changed,
    statsBefore,
    statsAfter: summarizeBoardScene(nextScene),
  };
}
