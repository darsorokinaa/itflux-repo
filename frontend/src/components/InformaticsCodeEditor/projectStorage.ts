/** Сохранение мультифайлового проекта в localStorage (per storageId / задание). */

import { DEFAULT_SNIPPETS } from "./types";
import { VirtualFs } from "./virtualFs";

export const MAIN_FILE = "main.py";

export type SaveStatus = "saved" | "saving" | "error" | "idle";

export type StoredProject = {
  files: Record<string, string>;
  mainFile: string;
  stdinPrefill: string;
  version: 1;
};

function projectKey(storageId: string) {
  return `inf-code-project:${storageId}`;
}

function defaultProject(): StoredProject {
  return {
    files: { [MAIN_FILE]: DEFAULT_SNIPPETS.python },
    mainFile: MAIN_FILE,
    stdinPrefill: "",
    version: 1,
  };
}

export function loadProject(storageId: string): StoredProject {
  try {
    const raw = localStorage.getItem(projectKey(storageId));
    if (!raw) return defaultProject();
    const parsed = JSON.parse(raw) as Partial<StoredProject>;
    if (!parsed.files || typeof parsed.files !== "object") return defaultProject();
    const files = { ...parsed.files };
    const mainFile =
      parsed.mainFile && files[parsed.mainFile] !== undefined
        ? parsed.mainFile
        : MAIN_FILE;
    if (!files[mainFile]) {
      files[mainFile] = DEFAULT_SNIPPETS.python;
    }
    return {
      files,
      mainFile,
      stdinPrefill: parsed.stdinPrefill ?? "",
      version: 1,
    };
  } catch {
    return defaultProject();
  }
}

export function saveProject(storageId: string, project: StoredProject): boolean {
  try {
    localStorage.setItem(projectKey(storageId), JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function applyProjectToVfs(vfs: VirtualFs, project: StoredProject) {
  for (const name of vfs.list()) {
    vfs.delete(name);
  }
  for (const [name, content] of Object.entries(project.files)) {
    if (name !== project.mainFile) {
      try {
        vfs.set(name, content);
      } catch {
        /* skip oversized */
      }
    }
  }
}

export function vfsToProjectFiles(
  vfs: VirtualFs,
  mainFile: string,
  mainContent: string
): Record<string, string> {
  const files: Record<string, string> = { ...vfs.toRecord() };
  files[mainFile] = mainContent;
  return files;
}

/** Миграция со старого ключа inf-code:sidebar:python */
export function migrateLegacyCode(storageId: string): string | null {
  try {
    return localStorage.getItem(`inf-code:${storageId}:python`);
  } catch {
    return null;
  }
}
