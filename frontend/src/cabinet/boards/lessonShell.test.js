import { describe, expect, it, vi } from "vitest";

import { lessonInkChoices } from "./lessonBoardActions";
import { installLessonViewportMemory } from "./lessonViewportMemory";

import {
  LESSON_RAIL,
  clampLessonThickness,
  getLessonThickness,
  lessonCellValue,
  lessonAdaptiveRail,
  lessonContextBar,
  lessonContextPosition,
  lessonGraphPoints,
  lessonPhoneRail,
  lessonSelectionKind,
  lessonStrokeScale,
  lessonTextSizeLabel,
  lessonTextSizePt,
  lessonStickerResize,
  lessonToolActive,
  lessonThicknessLabel,
  lessonThicknessPx,
  lessonBoardChromeAction,
  lessonBoardPageTitle,
  lessonRoomChromeMessage,
  lessonZoomLabel,
  lessonClockText,
  LESSON_ZOOM_STEPS,
  LESSON_ZOOM_MAX,
  LESSON_ZOOM_MIN,
  LESSON_VIEWPORT_MAX_PAGES,
  clampLessonZoom,
  lessonViewportStorageKey,
  normalizeLessonViewport,
  readLessonViewport,
  writeLessonViewport,
  readLessonBoardTitleParam,
  scaledLessonThickness,
  setLessonThickness,
  withLessonBoardTitle,
} from "./lessonShell";

describe("lesson shell", () => {
  it("keeps the left rail in the lesson order", () => {
    expect(LESSON_RAIL.filter((item) => item.label).map((item) => item.label)).toEqual([
      "Выбор",
      "Перемещение",
      "Рисование",
      "Ластик",
      "Текст",
      "Стикер",
      "Фигуры",
      "Ещё",
    ]);
    expect(lessonToolActive("draw", "draw")).toBe(true);
    expect(lessonToolActive("draw", "highlight")).toBe(true);
    expect(lessonToolActive("shapes", "geo")).toBe(true);
    expect(lessonToolActive("draw", "select")).toBe(false);
    expect(lessonContextBar("formula")).toEqual(["edit", "duplicate", "delete", "more"]);
    expect(lessonContextBar("graph")).toEqual(["edit", "duplicate", "delete", "more"]);
    expect(lessonContextBar("task")).toEqual(["edit", "duplicate", "lock", "delete", "more"]);
  });

  it("shows a short bar only for the selected object", () => {
    expect(lessonSelectionKind([])).toBeNull();
    expect(lessonSelectionKind(["geo"])).toBe("geo");
    expect(lessonSelectionKind(["text"])).toBe("text");
    expect(lessonSelectionKind(["image"])).toBe("image");
    expect(lessonSelectionKind(["geo", "text"])).toBe("multi");
    expect(lessonSelectionKind(["formula"])).toBe("formula");
    expect(lessonSelectionKind(["arrow"])).toBe("arrow");
    expect(lessonSelectionKind(["geo"], "file")).toBe("file");
    expect(lessonContextBar("file")).toEqual(["file"]);
    expect(lessonContextBar("geo")).toEqual(["color", "fill", "border", "size", "lock", "more"]);
    expect(lessonContextBar("text")).toEqual(["font", "size", "color", "opacity", "align", "lock", "more"]);
    expect(lessonContextBar("image")).toEqual(["crop", "replace", "opacity", "lock", "more"]);
    expect(lessonContextBar("arrow")).toEqual(["color", "size", "border", "arrowhead", "lock", "more"]);
    expect(lessonContextBar("multi")).toEqual(["alignShapes", "distribute", "group", "duplicate", "lock", "more"]);
    expect(lessonContextBar(null)).toEqual([]);
    expect(lessonTextSizePt("s")).toBe(14);
    expect(lessonTextSizePt("m")).toBe(18);
    expect(lessonTextSizePt("l")).toBe(27);
    expect(lessonTextSizePt("xl")).toBe(33);
    expect(lessonTextSizeLabel("m")).toBe("18 пт");
  });

  it("keeps the main colors and adds only the selected custom color", () => {
    localStorage.setItem("lesson-board-custom-colors", JSON.stringify(["#7c3aed", "#112233"]));
    const presets = [
      { id: "black", label: "Чёрный" },
      { id: "red", label: "Красный" },
      { id: "blue", label: "Синий" },
    ];
    expect(lessonInkChoices(presets, "black").map((item) => item.id)).toEqual(["black", "red", "blue"]);
    expect(lessonInkChoices(presets, "c7c3aed").map((item) => item.id)).toEqual(["black", "red", "blue", "c7c3aed"]);
    localStorage.removeItem("lesson-board-custom-colors");
  });

  it("stretches a sticker from the round handles instead of copying it", () => {
    const initial = { x: 10, y: 20, rotation: 0, props: { scale: 1 } };
    const size = { width: 200, height: 200 };
    expect(lessonStickerResize(initial, { id: "right", x: 400, y: 100 }, size)).toEqual({ x: 10, y: 20, scale: 2 });
    expect(lessonStickerResize(initial, { id: "left", x: -200, y: 100 }, size)).toEqual({ x: -190, y: 20, scale: 2 });
    expect(lessonStickerResize(initial, { id: "bottom", x: 100, y: 400 }, size)).toEqual({ x: 10, y: 20, scale: 2 });
    expect(lessonStickerResize(initial, { id: "top", x: 100, y: -200 }, size)).toEqual({ x: 10, y: -180, scale: 2 });
  });

  it("keeps the extra tools behind one more button", () => {
    const rail = lessonAdaptiveRail();
    const ids = rail.items.map((item) => item.id);
    expect(ids).toContain("more");
    expect(ids).not.toContain("laser");
    expect(ids).not.toContain("highlight");
    expect(rail.overflow.map((item) => item.id)).toEqual(["arrow", "line", "frame", "laser", "insert", "files", "embed"]);
    expect(lessonPhoneRail().items.map((item) => item.id)).toEqual(ids);
  });

  it("keeps the context bar inside the board", () => {
    const flipped = lessonContextPosition({ x: 20, y: 20, width: 80, height: 40 }, { width: 800, height: 600 });
    expect(flipped.top).toBeGreaterThan(20);
    expect(flipped.left).toBeGreaterThan(64);
    const clamped = lessonContextPosition({ x: 900, y: 200, width: 40, height: 40 }, { width: 800, height: 600 });
    expect(clamped.left).toBeLessThan(800);
  });

  it("follows the thickness slider instead of fixed sizes", () => {
    expect(clampLessonThickness(1)).toBe(1);
    expect(clampLessonThickness(9.4)).toBe(9);
    expect(clampLessonThickness(99)).toBe(99);
    expect(clampLessonThickness(150)).toBe(100);
    expect(clampLessonThickness(0)).toBe(1);
    expect(lessonThicknessLabel(16)).toBe("16");
    expect(lessonThicknessPx(16)).toBe(16);
    expect(lessonStrokeScale(1, 16)).toBeCloseTo(16 / 4.5);
    expect(lessonStrokeScale(0.5, 18)).toBeCloseTo(2);
    expect(scaledLessonThickness(2, 16, 32)).toBe(4);
    expect(setLessonThickness(24)).toBe(24);
    expect(getLessonThickness()).toBe(24);
    setLessonThickness(16);
  });

  it("plots a function from the slider expression", () => {
    const points = lessonGraphPoints("x^2", -1, 1, 2);
    expect(points).toHaveLength(3);
    expect(points[1].y).toBeCloseTo(0);
    expect(lessonCellValue("2+2")).toBe(4);
    expect(lessonGraphPoints("not a function", 0, 1)).toBeNull();
  });

  it("formats the camera zoom as a percent", () => {
    expect(lessonZoomLabel(1)).toBe("100%");
    expect(lessonZoomLabel(1.26)).toBe("126%");
    expect(lessonZoomLabel(0)).toBe("100%");
    expect(LESSON_ZOOM_STEPS[0]).toBe(0.02);
    expect(LESSON_ZOOM_STEPS[0]).toBeGreaterThan(0);
    expect(LESSON_ZOOM_STEPS.at(-1)).toBe(8);
    expect(LESSON_ZOOM_STEPS).toContain(1);
    for (let i = 1; i < LESSON_ZOOM_STEPS.length; i++) {
      const ratio = LESSON_ZOOM_STEPS[i] / LESSON_ZOOM_STEPS[i - 1];
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThanOrEqual(1.6);
    }
    expect(lessonZoomLabel(0.02)).toBe("2%");
    const start = "2026-10-03T10:00:00.000Z";
    const end = "2026-10-03T11:00:00.000Z";
    const now = Date.parse("2026-10-03T10:18:00.000Z");
    expect(lessonClockText(start, end, now, false)).toBe("осталось 42:00");
    expect(lessonClockText(start, end, now, true)).toBe("идёт 18:00");
    expect(lessonClockText(start, end, Date.parse(end) + 1000, false)).toBe("время вышло");
    expect(lessonClockText("", end, now, false)).toBe("");
  });

  it("uses the lesson name on the board when the room has one", () => {
    expect(lessonBoardPageTitle("Тео Тестовый")).toBe("Тео Тестовый");
    expect(lessonBoardPageTitle("  ")).toBe("Доска урока");
    expect(readLessonBoardTitleParam("?lesson=Дроби")).toBe("Дроби");
    expect(withLessonBoardTitle("/cabinet/boards/abc", "Дроби")).toBe("/cabinet/boards/abc?lesson=%D0%94%D1%80%D0%BE%D0%B1%D0%B8");
    expect(withLessonBoardTitle("/cabinet/boards/abc?access_token=1", "")).toBe("/cabinet/boards/abc?access_token=1");
    expect(lessonRoomChromeMessage({
      source: "itflux-lesson-room",
      type: "board-chrome",
      lessonTitle: " Дроби ",
      reserveRight: 320.4,
      live: true,
      whenLabel: "10:00–11:00",
      startsAt: " 2026-10-03T10:00:00.000Z ",
      endsAt: "2026-10-03T11:00:00.000Z",
      materialsCount: 1,
    })).toEqual({
      lessonTitle: "Дроби",
      reserveRight: 320,
      inRoom: true,
      live: true,
      whenLabel: "10:00–11:00",
      startsAt: "2026-10-03T10:00:00.000Z",
      endsAt: "2026-10-03T11:00:00.000Z",
      materialsCount: 1,
      materialsOpen: false,
      fullscreen: false,
      canFinish: false,
      finishing: false,
    });
    expect(lessonRoomChromeMessage({ type: "other" })).toBeNull();
    expect(lessonBoardChromeAction({
      source: "itflux-board",
      type: "board-chrome-action",
      action: "materials",
    })).toBe("materials");
    expect(lessonBoardChromeAction({ source: "itflux-board", type: "board-chrome-action", action: "nope" })).toBe("");
  });
});

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function fakeEditor({ pageId = "page:a", camera = { x: 0, y: 0, z: 1 }, followingUserId = null } = {}) {
  const listeners = new Set();
  const state = { pageId, camera: { ...camera }, followingUserId, options: { zoomSteps: [0.1, 1, 8] } };
  const editor = {
    state,
    getInstanceState: () => ({ followingUserId: state.followingUserId }),
    getCurrentPageId: () => state.pageId,
    getCamera: () => ({ ...state.camera }),
    getCameraOptions: () => ({ ...state.options }),
    setCameraOptions: vi.fn((next) => { state.options = next; }),
    setCamera: vi.fn((next) => {
      // tldraw: setCamera прекращает слежение и зажимает масштаб в zoomSteps.
      state.followingUserId = null;
      const steps = state.options.zoomSteps;
      state.camera = { x: next.x, y: next.y, z: Math.min(steps[steps.length - 1], Math.max(steps[0], next.z)) };
    }),
    store: {
      listen: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    move(next) {
      Object.assign(state.camera, next);
      listeners.forEach((fn) => fn());
    },
    listenerCount: () => listeners.size,
  };
  return editor;
}

function fakeTarget() {
  const handlers = new Map();
  return {
    visibilityState: "visible",
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: (type) => handlers.delete(type),
    fire: (type) => handlers.get(type)?.(),
    has: (type) => handlers.has(type),
  };
}

describe("lesson board viewport memory (r114)", () => {
  it("keys the viewport by user and board", () => {
    expect(lessonViewportStorageKey(7, "b-1")).toBe("itflux.boardViewport.7.b-1");
    expect(lessonViewportStorageKey(8, "b-1")).not.toBe(lessonViewportStorageKey(7, "b-1"));
    expect(lessonViewportStorageKey("", "b-1")).toBe("");
    expect(lessonViewportStorageKey(7, null)).toBe("");
  });

  it("clamps zoom to 2%–800% and rejects garbage", () => {
    expect(LESSON_ZOOM_MIN).toBe(0.02);
    expect(LESSON_ZOOM_MAX).toBe(8);
    expect(clampLessonZoom(0.001)).toBe(0.02);
    expect(clampLessonZoom(50)).toBe(8);
    expect(clampLessonZoom(1.25)).toBe(1.25);
    for (const bad of [0, -1, Number.NaN, Infinity, "abc", null, undefined, "", true]) {
      expect(clampLessonZoom(bad)).toBeNull();
    }
    expect(normalizeLessonViewport({ x: "12", y: -4, z: 20 })).toEqual({ x: 12, y: -4, z: 8 });
    expect(normalizeLessonViewport({ x: Number.NaN, y: 0, z: 1 })).toBeNull();
    expect(normalizeLessonViewport({ x: 0, y: 1e12, z: 1 })).toBeNull();
    expect(normalizeLessonViewport({ x: 0, y: 0 })).toBeNull();
    expect(normalizeLessonViewport(null)).toBeNull();
  });

  it("stores the camera per page and survives broken storage", () => {
    const storage = memoryStorage();
    expect(writeLessonViewport(storage, 1, "b", "page:a", { x: 10, y: 20, z: 0.5 }, 1)).toBe(true);
    expect(writeLessonViewport(storage, 1, "b", "page:b", { x: -5, y: 3, z: 2 }, 2)).toBe(true);
    expect(readLessonViewport(storage, 1, "b", "page:a")).toEqual({ x: 10, y: 20, z: 0.5 });
    expect(readLessonViewport(storage, 1, "b", "page:b")).toEqual({ x: -5, y: 3, z: 2 });
    expect(readLessonViewport(storage, 2, "b", "page:a")).toBeNull();
    expect(readLessonViewport(storage, 1, "other", "page:a")).toBeNull();
    expect(writeLessonViewport(storage, 1, "b", "page:a", { x: 1, y: 1, z: 0 })).toBe(false);

    const broken = memoryStorage({ [lessonViewportStorageKey(1, "b")]: "{not json" });
    expect(readLessonViewport(broken, 1, "b", "page:a")).toBeNull();
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    expect(readLessonViewport(throwing, 1, "b", "page:a")).toBeNull();
    expect(writeLessonViewport(throwing, 1, "b", "page:a", { x: 1, y: 1, z: 1 })).toBe(false);

    for (let index = 0; index < LESSON_VIEWPORT_MAX_PAGES + 5; index += 1) {
      writeLessonViewport(storage, 1, "b", `page:${index}`, { x: index, y: 0, z: 1 }, 100 + index);
    }
    const saved = JSON.parse(storage.getItem(lessonViewportStorageKey(1, "b")));
    expect(Object.keys(saved.pages)).toHaveLength(LESSON_VIEWPORT_MAX_PAGES);
    expect(saved.pages[`page:${LESSON_VIEWPORT_MAX_PAGES + 4}`]).toBeTruthy();
  });

  it("restores the saved camera on open with the 2% floor, and skips the default framing", () => {
    const storage = memoryStorage();
    writeLessonViewport(storage, 1, "b", "page:a", { x: 300, y: -40, z: 0.02 });
    const editor = fakeEditor();
    const memory = installLessonViewportMemory(editor, { userId: 1, boardId: "b", storage, target: null, doc: null });
    expect(memory.restored).toBe(true);
    expect(editor.state.options.zoomSteps).toEqual(LESSON_ZOOM_STEPS);
    expect(editor.getCamera()).toEqual({ x: 300, y: -40, z: 0.02 });
    memory.dispose();
  });

  it("falls back to the default view when nothing valid is saved", () => {
    const storage = memoryStorage({
      [lessonViewportStorageKey(1, "b")]: JSON.stringify({ v: 1, pages: { "page:a": { x: "x", y: 0, z: 1 } } }),
    });
    const editor = fakeEditor();
    const memory = installLessonViewportMemory(editor, { userId: 1, boardId: "b", storage, target: null, doc: null });
    expect(memory.restored).toBe(false);
    expect(editor.setCamera).not.toHaveBeenCalled();
    memory.dispose();
  });

  it("does not override following the teacher and does not save the followed view", () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      writeLessonViewport(storage, 1, "b", "page:a", { x: 5, y: 5, z: 1 });
      const editor = fakeEditor({ followingUserId: "user:teacher" });
      const memory = installLessonViewportMemory(editor, { userId: 1, boardId: "b", storage, target: null, doc: null });
      expect(memory.restored).toBe(false);
      expect(editor.setCamera).not.toHaveBeenCalled();
      expect(editor.state.followingUserId).toBe("user:teacher");
      editor.move({ x: 999, y: 999, z: 3 });
      vi.runAllTimers();
      memory.dispose();
      expect(readLessonViewport(storage, 1, "b", "page:a")).toEqual({ x: 5, y: 5, z: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves camera changes debounced and flushes on hide and close", () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const target = fakeTarget();
      const doc = fakeTarget();
      const editor = fakeEditor();
      const memory = installLessonViewportMemory(editor, { userId: 1, boardId: "b", storage, target, doc, delay: 400 });
      expect(memory.restored).toBe(false);
      editor.move({ x: 10, y: 20, z: 1.5 });
      editor.move({ x: 11, y: 21, z: 1.5 });
      expect(readLessonViewport(storage, 1, "b", "page:a")).toBeNull();
      vi.advanceTimersByTime(400);
      expect(readLessonViewport(storage, 1, "b", "page:a")).toEqual({ x: 11, y: 21, z: 1.5 });

      editor.move({ x: 50, y: 60, z: 0.25 });
      doc.visibilityState = "hidden";
      doc.fire("visibilitychange");
      expect(readLessonViewport(storage, 1, "b", "page:a")).toEqual({ x: 50, y: 60, z: 0.25 });

      editor.move({ x: 70, y: 80, z: 4 });
      target.fire("pagehide");
      expect(readLessonViewport(storage, 1, "b", "page:a")).toEqual({ x: 70, y: 80, z: 4 });

      editor.state.camera = { x: -1, y: -2, z: 0.5 };
      memory.dispose();
      expect(readLessonViewport(storage, 1, "b", "page:a")).toEqual({ x: -1, y: -2, z: 0.5 });
      expect(editor.listenerCount()).toBe(0);
      expect(target.has("pagehide")).toBe(false);
      expect(doc.has("visibilitychange")).toBe(false);

      const reopened = fakeEditor();
      const again = installLessonViewportMemory(reopened, { userId: 1, boardId: "b", storage, target: null, doc: null });
      expect(again.restored).toBe(true);
      expect(reopened.getCamera()).toEqual({ x: -1, y: -2, z: 0.5 });
      again.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
