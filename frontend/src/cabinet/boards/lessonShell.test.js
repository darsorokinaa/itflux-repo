import { describe, expect, it } from "vitest";

import { lessonInkChoices } from "./lessonBoardActions";

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
      "Лазер",
      "Текст",
      "Стикер",
      "Фигуры",
      "Стрелка",
      "Область",
      "Линия",
      "Вставить",
      "Файлы",
      "Вставка",
    ]);
    expect(lessonToolActive("draw", "draw")).toBe(true);
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

  it("keeps the extra tools on the rail", () => {
    const full = lessonAdaptiveRail(900, 40);
    expect(full.overflow).toEqual([]);
    const short = lessonAdaptiveRail(420, 40);
    expect(short.overflow).toEqual([]);
    ["laser", "note", "insert", "frame", "line", "embed"].forEach((id) => {
      expect(short.items.map((item) => item.id)).toContain(id);
    });
    expect(short.items.map((item) => item.id)).not.toContain("highlight");
    const phone = lessonPhoneRail();
    expect(phone.overflow).toEqual([]);
    expect(phone.items.map((item) => item.id)).not.toContain("highlight");
    expect(phone.items.map((item) => item.id)).toContain("embed");
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
    expect(LESSON_ZOOM_STEPS[0]).toBe(0.25);
    expect(LESSON_ZOOM_STEPS[3] - LESSON_ZOOM_STEPS[2]).toBeCloseTo(0.25);
    expect(LESSON_ZOOM_STEPS.at(-1)).toBe(8);
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
