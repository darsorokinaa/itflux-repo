import { describe, expect, it } from "vitest";
import { boardFileSlug, buildThumbnailExportAppState } from "./boardExport";
import { BG_COLOR_KEY, GRID_STYLE_KEY } from "./boardGrid";

describe("boardExport", () => {
  it("формирует безопасное имя файла из названия доски", () => {
    expect(boardFileSlug("Новая доска")).toBe("Новая_доска");
    expect(boardFileSlug('Схема: "граф"/v1')).toBe("Схема-_-граф-v1");
    expect(boardFileSlug("")).toBe("board");
  });

  it("превью берёт цвет бумаги и светлую тему, а не transparent/dark", () => {
    const out = buildThumbnailExportAppState({
      theme: "dark",
      viewBackgroundColor: "transparent",
      exportWithDarkMode: true,
      [BG_COLOR_KEY]: "#f7f4ea",
      [GRID_STYLE_KEY]: "dots",
    });
    expect(out.viewBackgroundColor).toBe("#f7f4ea");
    expect(out.exportBackground).toBe(true);
    expect(out.exportWithDarkMode).toBe(false);
    expect(out.theme).toBe("light");
  });

  it("превью без сохранённого цвета бумаги — белый", () => {
    const out = buildThumbnailExportAppState({ viewBackgroundColor: "transparent" });
    expect(out.viewBackgroundColor).toBe("#ffffff");
  });
});
