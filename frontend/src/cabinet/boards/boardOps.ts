/** Компактные операции сцены вместо полной пересылки elements[]. */

import { filesForLivePublish } from "./boardFiles";
import type { CollabScene } from "./boardSceneMerge";
import { mergeSceneFiles, preferBoardElement } from "./boardSceneMerge";

export type BoardElementOp =
  | { op: "upsert"; element: Record<string, unknown> }
  | { op: "delete"; id: string; version?: number; versionNonce?: number; updated?: number };

export type BoardSceneOpsPayload = {
  baseVersion?: number;
  ops: BoardElementOp[];
  files?: Record<string, unknown>;
  appStatePatch?: Record<string, unknown>;
};

const FULL_SCENE_ELEMENT_THRESHOLD = 80;
const FULL_SCENE_OPS_THRESHOLD = 40;

type El = {
  id?: string;
  version?: number;
  versionNonce?: number;
  updated?: number;
  isDeleted?: boolean;
  [key: string]: unknown;
};

function asEl(raw: unknown): El | null {
  if (!raw || typeof raw !== "object") return null;
  const el = raw as El;
  if (!el.id || typeof el.id !== "string") return null;
  return el;
}

function elKey(el: El): string {
  return `${el.id}:${Number(el.version) || 0}:${Number(el.versionNonce) || 0}:${Number(el.updated) || 0}:${el.isDeleted ? 1 : 0}`;
}

/** Diff previous → next: только изменившиеся/новые/удалённые элементы. */
export function diffBoardElements(
  prev: unknown[] | null | undefined,
  next: unknown[] | null | undefined,
): BoardElementOp[] {
  const prevMap = new Map<string, El>();
  for (const raw of prev || []) {
    const el = asEl(raw);
    if (el) prevMap.set(el.id!, el);
  }
  const nextMap = new Map<string, El>();
  for (const raw of next || []) {
    const el = asEl(raw);
    if (el) nextMap.set(el.id!, el);
  }

  const ops: BoardElementOp[] = [];
  for (const [id, el] of nextMap) {
    const was = prevMap.get(id);
    if (!was) {
      ops.push({ op: "upsert", element: { ...el } });
      continue;
    }
    if (elKey(was) !== elKey(el)) {
      ops.push({ op: "upsert", element: { ...el } });
    }
  }
  for (const [id, was] of prevMap) {
    if (nextMap.has(id)) continue;
    // Soft-delete предпочтительнее hard-remove.
    ops.push({
      op: "delete",
      id,
      version: Number(was.version) || 0,
      versionNonce: Number(was.versionNonce) || 0,
      updated: Number(was.updated) || Date.now(),
    });
  }
  return ops;
}

export function shouldPublishFullScene(
  elementCount: number,
  opsCount: number,
): boolean {
  if (opsCount <= 0) return false;
  if (elementCount <= FULL_SCENE_ELEMENT_THRESHOLD && opsCount <= FULL_SCENE_OPS_THRESHOLD) {
    return false;
  }
  // Много мелких правок — ops выгоднее; полная сцена только если ops почти = вся сцена.
  return opsCount >= Math.max(FULL_SCENE_OPS_THRESHOLD, Math.floor(elementCount * 0.45));
}

export function applyBoardOps(
  local: CollabScene,
  payload: BoardSceneOpsPayload,
): CollabScene {
  const map = new Map<string, El>();
  for (const raw of local.elements || []) {
    const el = asEl(raw);
    if (el) map.set(el.id!, el);
  }
  for (const op of payload.ops || []) {
    if (op.op === "upsert" && op.element && typeof op.element === "object") {
      const next = asEl(op.element);
      if (!next) continue;
      const cur = map.get(next.id!);
      map.set(next.id!, cur ? (preferBoardElement(cur, next) as El) : next);
    } else if (op.op === "delete" && op.id) {
      const cur = map.get(op.id);
      const tomb: El = {
        ...(cur || { id: op.id }),
        id: op.id,
        isDeleted: true,
        version: Math.max(Number(cur?.version) || 0, Number(op.version) || 0),
        versionNonce: Math.max(Number(cur?.versionNonce) || 0, Number(op.versionNonce) || 0),
        updated: Math.max(Number(cur?.updated) || 0, Number(op.updated) || Date.now()),
      };
      if (!cur || preferBoardElement(tomb, cur) === tomb) {
        map.set(op.id, tomb);
      }
    }
  }

  const elements = Array.from(map.values());
  const hasIndex = elements.some((el) => typeof el.index === "string" && el.index);
  if (hasIndex) {
    elements.sort((a, b) => {
      const ia = typeof a.index === "string" ? a.index : "";
      const ib = typeof b.index === "string" ? b.index : "";
      if (ia === ib) return 0;
      return ia < ib ? -1 : 1;
    });
  }

  const appState = {
    ...(local.appState || {}),
    ...(payload.appStatePatch || {}),
  };
  return {
    elements,
    appState,
    files: mergeSceneFiles(local.files, payload.files),
  };
}

/** Подготовить payload для WS: ops или full scene. */
export function buildLivePublishPayload(
  prevElements: unknown[] | null | undefined,
  scene: CollabScene,
  version?: number,
): { kind: "ops"; payload: BoardSceneOpsPayload; version?: number }
  | { kind: "full"; scene: CollabScene; version?: number } {
  const ops = diffBoardElements(prevElements, scene.elements);
  const files = filesForLivePublish(scene.files as Record<string, Record<string, unknown>>);
  if (!ops.length && !Object.keys(files).length) {
    return { kind: "ops", payload: { ops: [], files }, version };
  }
  if (shouldPublishFullScene(scene.elements?.length || 0, ops.length)) {
    return {
      kind: "full",
      scene: {
        elements: scene.elements,
        appState: scene.appState,
        files,
      },
      version,
    };
  }
  return {
    kind: "ops",
    payload: {
      baseVersion: version,
      ops,
      files,
    },
    version,
  };
}

export { FULL_SCENE_ELEMENT_THRESHOLD, FULL_SCENE_OPS_THRESHOLD };
