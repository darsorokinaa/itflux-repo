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
  const next: Record<string, unknown> = { ...el, isDeleted: true };
  if (Array.isArray(next.points) && next.points.length > 1) {
    next.points = [[0, 0]];
  }
  if (Array.isArray(next.pressures) && next.pressures.length > 1) {
    next.pressures = Array.isArray(next.points) ? next.points.map(() => 0.5) : [];
  }
  for (const key of ["text", "originalText", "rawText"] as const) {
    if (typeof next[key] === "string" && (next[key] as string).length > 0) {
      next[key] = "";
    }
  }
  return next;
}

export function summarizeBoardScene(
  scene: BoardSceneLike | null | undefined,
  opts: { bytes?: boolean } = {},
): BoardSceneStats {
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
  const withBytes = Boolean(opts.bytes);
  return {
    elementCount: elements.length,
    deletedCount,
    liveCount: elements.length - deletedCount,
    fileCount: Object.keys(files).length,
    unusedFileCount,
    elementsBytes: withBytes ? utf8Bytes(elements) : 0,
    filesBytes: withBytes ? utf8Bytes(files) : 0,
    sceneBytes: withBytes
      ? utf8Bytes({
          elements,
          appState: scene?.appState || {},
          files,
        })
      : 0,
  };
}

/**
 * Идемпотентное сжатие: живые элементы не трогаем.
 * Удалённые freedraw/text теряют геометрию/текст (для collab остаются tombstones).
 * Files без ссылки из элементов (включая deleted image.fileId) удаляются из JSON.
 * Не сериализует всю сцену — это блокировало бы открытие большой доски.
 */
export function compactBoardScene(scene: BoardSceneLike | null | undefined): CompactBoardSceneResult {
  const elementsIn = Array.isArray(scene?.elements) ? scene!.elements! : [];
  const appState = scene?.appState && typeof scene.appState === "object" ? scene.appState : {};
  const filesIn = scene?.files && typeof scene.files === "object" ? scene.files : {};

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
    statsBefore: summarizeBoardScene({ elements: elementsIn, appState, files: filesIn }),
    statsAfter: summarizeBoardScene(nextScene),
  };
}
