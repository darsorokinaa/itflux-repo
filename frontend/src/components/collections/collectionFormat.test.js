import { describe, expect, it } from "vitest";
import { collectionItemCount, hoursLabel, lessonsLabel, materialsLabel } from "./collectionFormat";

describe("materialsLabel", () => {
  it("uses Russian plural forms for every kit item", () => {
    expect(materialsLabel(1)).toBe("материал");
    expect(materialsLabel(21)).toBe("материал");
    expect(materialsLabel(101)).toBe("материал");
    expect(materialsLabel(2)).toBe("материала");
    expect(materialsLabel(3)).toBe("материала");
    expect(materialsLabel(4)).toBe("материала");
    expect(materialsLabel(22)).toBe("материала");
    expect(materialsLabel(0)).toBe("материалов");
    expect(materialsLabel(5)).toBe("материалов");
    expect(materialsLabel(11)).toBe("материалов");
    expect(materialsLabel(12)).toBe("материалов");
    expect(materialsLabel(14)).toBe("материалов");
    expect(materialsLabel(25)).toBe("материалов");
    expect(materialsLabel(111)).toBe("материалов");
  });
});

describe("collectionItemCount", () => {
  it("counts file and variant rows, not only lessons", () => {
    expect(collectionItemCount({
      lessons_count: 1,
      lessons: [
        { kind: "lesson" },
        { kind: "trainer" },
        { kind: "file" },
        { kind: "variant" },
      ],
    })).toBe(4);
    expect(collectionItemCount({ lessons_count: 5 })).toBe(5);
    expect(collectionItemCount({})).toBe(0);
  });
});

describe("lessonsLabel and hoursLabel", () => {
  it("keeps the same plural groups", () => {
    expect(lessonsLabel(1)).toBe("урок");
    expect(lessonsLabel(2)).toBe("урока");
    expect(lessonsLabel(5)).toBe("уроков");
    expect(lessonsLabel(11)).toBe("уроков");
    expect(hoursLabel(1)).toBe("час");
    expect(hoursLabel(2)).toBe("часа");
    expect(hoursLabel(5)).toBe("часов");
  });
});
