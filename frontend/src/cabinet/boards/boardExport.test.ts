import { describe, expect, it } from "vitest";
import { boardFileSlug } from "./boardExport";

describe("boardExport", () => {
  it("формирует безопасное имя файла из названия доски", () => {
    expect(boardFileSlug("Новая доска")).toBe("Новая_доска");
    expect(boardFileSlug('Схема: "граф"/v1')).toBe("Схема-_-граф-v1");
    expect(boardFileSlug("")).toBe("board");
  });
});
