import { describe, expect, it } from "vitest";
import { filterVariants, tasksWord } from "./MyVariantsPage";

const list = [
  { id: 10, title: "Пробник март", subject: "inf", createdAt: "2026-03-01T10:00:00Z" },
  { id: 1955, title: "", subject: "inf", createdAt: "2026-10-01T10:00:00Z" },
  { id: 77, title: "Алгебра", subject: "math", createdAt: "2026-05-01T10:00:00Z" },
];

describe("r129 Мои варианты", () => {
  it("search by number and title", () => {
    expect(filterVariants(list, { query: "№ 1955" }).map((v) => v.id)).toEqual([1955]);
    expect(filterVariants(list, { query: "пробник" }).map((v) => v.id)).toEqual([10]);
  });
  it("filter by subject + sort", () => {
    expect(filterVariants(list, { subject: "inf" }).map((v) => v.id)).toEqual([1955, 10]);
    expect(filterVariants(list, { sort: "old" }).map((v) => v.id)).toEqual([10, 77, 1955]);
  });
  it("plural", () => {
    expect(tasksWord(1)).toBe("задание");
    expect(tasksWord(3)).toBe("задания");
    expect(tasksWord(25)).toBe("заданий");
    expect(tasksWord(12)).toBe("заданий");
  });
});
