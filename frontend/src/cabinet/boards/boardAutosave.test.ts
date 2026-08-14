import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_DEBOUNCE_MS,
  buildScenePayload,
  createDebouncedSaver,
  isBoardSceneTooLargeError,
  sanitizeAppState,
  saveStatusLabel,
  shouldBlockUnload,
} from "./boardAutosave";

describe("boardAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("загружает и очищает исходную сцену без transient-полей", () => {
    const scene = buildScenePayload(
      [{ id: "1", type: "rectangle" }],
      {
        viewBackgroundColor: "#fff",
        selectedElementIds: { "1": true },
        scrollX: 10,
        zoom: { value: 1 },
      },
      { f1: { mimeType: "image/png" } },
    );
    expect(scene.elements).toHaveLength(1);
    expect(scene.appState.viewBackgroundColor).toBe("#fff");
    expect(scene.appState.selectedElementIds).toBeUndefined();
    expect(scene.appState.scrollX).toBeUndefined();
    expect(scene.files.f1).toEqual({ mimeType: "image/png" });
  });

  it("sanitizeAppState удаляет служебные ключи", () => {
    expect(sanitizeAppState({ collaborators: {}, viewBackgroundColor: "#eee" })).toEqual({
      viewBackgroundColor: "#eee",
    });
    expect(
      sanitizeAppState({
        viewBackgroundColor: "#fff",
        penMode: true,
        penDetected: true,
        activeTool: { type: "freedraw" },
      }),
    ).toEqual({ viewBackgroundColor: "#fff" });
  });

  it("saveStatusLabel возвращает русские статусы", () => {
    expect(saveStatusLabel("saving")).toBe("Сохранение…");
    expect(saveStatusLabel("saved")).toBe("");
    expect(saveStatusLabel("error")).toBe("Ошибка сохранения");
    expect(saveStatusLabel("conflict")).toBe("Конфликт версий");
    expect(saveStatusLabel("dirty")).toBe("");
  });

  it("debounce автосохранения не вызывает save на каждое изменение", async () => {
    const saveFn = vi.fn();
    const saver = createDebouncedSaver(saveFn, AUTOSAVE_DEBOUNCE_MS);
    saver.schedule();
    saver.schedule();
    saver.schedule();
    expect(saveFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it("debounce roughly 500–1000ms", () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
    expect(AUTOSAVE_DEBOUNCE_MS).toBeLessThanOrEqual(1000);
  });

  it("не запускает второй save пока первый in-flight", async () => {
    let resolveSave: (() => void) | undefined;
    const saveFn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const saver = createDebouncedSaver(saveFn, 10);
    saver.schedule();
    await vi.advanceTimersByTimeAsync(10);
    expect(saveFn).toHaveBeenCalledTimes(1);
    saver.schedule();
    await vi.advanceTimersByTimeAsync(10);
    expect(saveFn).toHaveBeenCalledTimes(1);
    resolveSave?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(saveFn).toHaveBeenCalledTimes(2);
  });

  it("shouldBlockUnload защищает от закрытия при несохранённых изменениях", () => {
    expect(shouldBlockUnload("dirty", false)).toBe(true);
    expect(shouldBlockUnload("saving", false)).toBe(true);
    expect(shouldBlockUnload("error", false)).toBe(true);
    expect(shouldBlockUnload("saved", false)).toBe(false);
    expect(shouldBlockUnload("idle", true)).toBe(true);
  });

  it("isBoardSceneTooLargeError ловит лимит сцены и слишком большое тело запроса", () => {
    expect(isBoardSceneTooLargeError({ code: "SCENE_TOO_LARGE" })).toBe(true);
    expect(isBoardSceneTooLargeError({ status: 413 })).toBe(true);
    expect(isBoardSceneTooLargeError({ message: "Request body exceeded settings.DATA_UPLOAD_MAX_MEMORY_SIZE." })).toBe(true);
    expect(isBoardSceneTooLargeError({ message: "Данные доски слишком большие" })).toBe(true);
    expect(isBoardSceneTooLargeError({ code: "VERSION_CONFLICT", status: 409 })).toBe(false);
  });

  it("режим просмотра: viewMode отражается через отсутствие can_edit на статусе", () => {
    // Контракт для UI: при view saveStatus остаётся idle и unload не блокируется без dirty
    expect(shouldBlockUnload("idle", false)).toBe(false);
    expect(saveStatusLabel("idle")).toBe("");
  });
});
