import { describe, expect, it } from "vitest";
import {
  catalogFoundCount,
  catalogShowsCollections,
  collectCatalogFilterOptions,
  filterCollections,
} from "./lessonCatalogFilters";

const kits = [
  { title: "Вероятность", subject: "Математика", grade: 9, exam_type: "oge", level: "ОГЭ" },
  { title: "Производная", subject: "Математика", grade: 11, exam_type: "ege", level: "ЕГЭ" },
  { title: "Алгоритмы", subject: "Информатика", grade: 9, exam_type: "oge", level: "" },
];

describe("catalog collection visibility", () => {
  it("shows kits only on the Наборы tab", () => {
    expect(catalogShowsCollections("all")).toBe(false);
    expect(catalogShowsCollections("lessons")).toBe(false);
    expect(catalogShowsCollections("")).toBe(false);
    expect(catalogShowsCollections("collections")).toBe(true);
  });

  it("counts lessons on Все and kits on Наборы", () => {
    expect(catalogFoundCount("all", 4, 2)).toBe(4);
    expect(catalogFoundCount("lessons", 4, 2)).toBe(4);
    expect(catalogFoundCount("collections", 4, 2)).toBe(2);
  });
});

describe("filterCollections", () => {
  it("keeps exam and subject filters on the Наборы tab", () => {
    expect(filterCollections(kits, { subject: "Математика" }).map((item) => item.title)).toEqual([
      "Вероятность",
      "Производная",
    ]);
    expect(filterCollections(kits, { level: "ОГЭ" }).map((item) => item.title)).toEqual([
      "Вероятность",
      "Алгоритмы",
    ]);
    expect(filterCollections(kits, { subject: "Математика", level: "ЕГЭ" }).map((item) => item.title)).toEqual([
      "Производная",
    ]);
    expect(filterCollections(kits, { search: "алгор" }).map((item) => item.title)).toEqual(["Алгоритмы"]);
  });
});

describe("collectCatalogFilterOptions", () => {
  it("offers exam and subject values from kits as well as lessons", () => {
    const options = collectCatalogFilterOptions(
      [{ subject: "Физика", exam_type: "ege", grade: 11 }],
      kits,
    );
    expect(options.subjects).toEqual(["Информатика", "Математика", "Физика"]);
    expect(options.levels).toContain("ОГЭ");
    expect(options.levels).toContain("ЕГЭ");
    expect(options.grades).toEqual(["9", "11"]);
  });
});
