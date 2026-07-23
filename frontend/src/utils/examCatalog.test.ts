import { describe, expect, it } from "vitest";
import { parseCatalogPayload } from "./examCatalog";

describe("parseCatalogPayload", () => {
  it("собирает уровни и предметы из ответа API", () => {
    const rows = parseCatalogPayload({
      catalog: [
        {
          level: "oge",
          level_rus: "ОГЭ",
          subjects: [
            { subject_short: "math", subject_name: "Математика" },
            { subject_short: "inf", subject_name: "Информатика" },
          ],
        },
        { level: "ege", level_rus: "ЕГЭ", subjects: [] },
      ],
    });
    expect(rows).toEqual([
      {
        id: "oge",
        label: "ОГЭ",
        subjects: [
          { id: "math", title: "Математика" },
          { id: "inf", title: "Информатика" },
        ],
      },
      { id: "ege", label: "ЕГЭ", subjects: [] },
    ]);
  });

  it("игнорирует пустые level", () => {
    expect(parseCatalogPayload({ catalog: [{ level: "", subjects: [] }] })).toEqual([]);
  });
});
