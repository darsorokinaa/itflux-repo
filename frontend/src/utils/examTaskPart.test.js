import { describe, expect, it } from "vitest";
import { formatExamPartLabel, inferExamTaskPart } from "./examTaskPart";

describe("inferExamTaskPart", () => {
  it("maps part_id 1/2", () => {
    expect(inferExamTaskPart({ part: 1, number: 5 }, "ege", "inf")).toBe(1);
    expect(inferExamTaskPart({ part: 2, number: 5 }, "ege", "inf")).toBe(2);
  });

  it("maps speaking titles and part_id >= 3 to criteria part", () => {
    expect(inferExamTaskPart({ part: 3, part_title: "Говорение", number: 1 }, "ege", "eng_speaking")).toBe(2);
    expect(inferExamTaskPart({ part: 4, part_title: "Устная часть", number: 2 }, "ege", "eng_speaking")).toBe(2);
    expect(inferExamTaskPart({ part: 3, number: 1 }, "ege", "eng_speaking")).toBe(2);
  });

  it("uses title over misleading part id", () => {
    expect(inferExamTaskPart({ part: 9, part_title: "Часть 1", number: 1 }, "ege", "inf")).toBe(1);
    expect(inferExamTaskPart({ part: 9, part_title: "Часть 2", number: 20 }, "ege", "inf")).toBe(2);
  });

  it("maps ege chemistry 1–28 to part 1", () => {
    expect(inferExamTaskPart({ number: 28 }, "ege", "chem")).toBe(1);
    expect(inferExamTaskPart({ number: 29 }, "ege", "chem")).toBe(2);
  });
});

describe("formatExamPartLabel", () => {
  it("prefers title", () => {
    expect(formatExamPartLabel(3, "Говорение")).toBe("Говорение");
    expect(formatExamPartLabel(2, "")).toBe("Часть 2");
  });
});
