/** Слияние сцен Excalidraw для совместного рисования (element-level, не last-writer-wins). */

import { preferDisplayFile } from "./boardFiles";

export type CollabScene = {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export function mergeSceneFiles(
  local: Record<string, unknown> | null | undefined,
  remote: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(local || {}) };
  for (const [id, remoteFile] of Object.entries(remote || {})) {
    if (!remoteFile || typeof remoteFile !== "object") continue;
    const localFile = out[id];
    if (!localFile || typeof localFile !== "object") {
      out[id] = remoteFile;
      continue;
    }
    // Не затираем уже декодированный blob стабильным API URL — иначе картинка
    // пропадает до повторного открытия доски.
    out[id] = preferDisplayFile(
      localFile as Record<string, unknown>,
      remoteFile as Record<string, unknown>,
    );
  }
  return out;
}

type BoardElement = {
  id?: string;
  version?: number;
  versionNonce?: number;
  updated?: number;
  isDeleted?: boolean;
  index?: string;
  [key: string]: unknown;
};

function asElement(raw: unknown): BoardElement | null {
  if (!raw || typeof raw !== "object") return null;
  const el = raw as BoardElement;
  if (!el.id || typeof el.id !== "string") return null;
  return el;
}

/** True, если a новее b (version → versionNonce → updated). */
export function isNewerBoardElement(a: BoardElement, b: BoardElement): boolean {
  const av = Number(a.version) || 0;
  const bv = Number(b.version) || 0;
  if (av !== bv) return av > bv;
  const an = Number(a.versionNonce) || 0;
  const bn = Number(b.versionNonce) || 0;
  if (an !== bn) return an > bn;
  const au = Number(a.updated) || 0;
  const bu = Number(b.updated) || 0;
  return au > bu;
}

/**
 * Выбирает победившую версию элемента.
 * При равных маркерах версии предпочитаем isDeleted — иначе soft-delete может «воскреснуть».
 */
export function preferBoardElement(a: BoardElement, b: BoardElement): BoardElement {
  if (isNewerBoardElement(a, b)) return a;
  if (isNewerBoardElement(b, a)) return b;
  if (a.isDeleted && !b.isDeleted) return a;
  if (b.isDeleted && !a.isDeleted) return b;
  return a;
}

/**
 * Объединяет элементы локальной и удалённой сцены.
 * Оба участника могут рисовать одновременно: у каждого id побеждает более новая версия,
 * локальные ещё не ушедшие штрихи не затираются.
 * Важно: в local должны попадать soft-deleted (isDeleted) элементы.
 */
export function mergeBoardElements(local: unknown[], remote: unknown[]): unknown[] {
  const localMap = new Map<string, BoardElement>();
  const remoteMap = new Map<string, BoardElement>();

  for (const raw of local || []) {
    const el = asElement(raw);
    if (el) localMap.set(el.id!, el);
  }
  for (const raw of remote || []) {
    const el = asElement(raw);
    if (el) remoteMap.set(el.id!, el);
  }

  const merged = new Map<string, BoardElement>();
  for (const [id, el] of localMap) merged.set(id, el);
  for (const [id, el] of remoteMap) {
    const cur = merged.get(id);
    if (!cur) {
      merged.set(id, el);
      continue;
    }
    merged.set(id, preferBoardElement(cur, el));
  }

  const ordered: BoardElement[] = [];
  const seen = new Set<string>();

  // Базовый порядок — с remote (что видит партнёр), поверх — локальные только у нас.
  for (const raw of remote || []) {
    const el = asElement(raw);
    if (!el || seen.has(el.id!)) continue;
    const pick = merged.get(el.id!);
    if (pick) {
      ordered.push(pick);
      seen.add(el.id!);
    }
  }
  for (const raw of local || []) {
    const el = asElement(raw);
    if (!el || seen.has(el.id!)) continue;
    const pick = merged.get(el.id!);
    if (pick) {
      ordered.push(pick);
      seen.add(el.id!);
    }
  }

  // Если есть fractional index — стабилизируем порядок холста.
  const hasIndex = ordered.some((el) => typeof el.index === "string" && el.index);
  if (hasIndex) {
    ordered.sort((a, b) => {
      const ia = typeof a.index === "string" ? a.index : "";
      const ib = typeof b.index === "string" ? b.index : "";
      if (ia === ib) return 0;
      return ia < ib ? -1 : 1;
    });
  }

  return ordered;
}

const LOCAL_UI_KEYS = [
  "scrollX",
  "scrollY",
  "zoom",
  "theme",
  "collaborators",
  "selectedElementIds",
  "selectedGroupIds",
  "editingGroupId",
  "editingLinearElementId",
  "activeTool",
  "penMode",
  "penDetected",
  "viewModeEnabled",
  "openMenu",
  "openSidebar",
  "cursorButton",
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemStrokeWidth",
  "currentItemStrokeStyle",
  "currentItemRoughness",
  "currentItemOpacity",
  "currentItemFontFamily",
  "currentItemFontSize",
  "currentItemTextAlign",
  "currentItemStartArrowhead",
  "currentItemEndArrowhead",
] as const;

export function mergeCollabScenes(local: CollabScene, remote: CollabScene): CollabScene {
  const localApp = local.appState || {};
  const remoteApp = remote.appState || {};
  const appState: Record<string, unknown> = { ...remoteApp };
  for (const key of LOCAL_UI_KEYS) {
    if (key in localApp) appState[key] = localApp[key];
  }
  return {
    elements: mergeBoardElements(local.elements || [], remote.elements || []),
    appState,
    files: mergeSceneFiles(local.files, remote.files),
  };
}
