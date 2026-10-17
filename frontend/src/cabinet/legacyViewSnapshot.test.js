import { describe, expect, it } from "vitest";
import { buildStudentHomeworkReviewRows, legacyViewTask } from "./cabinetReviewUtils";

const live = [
  { id: 10, number: 17, max_score: 1, part: 1, part_title: "Часть 1", answer: "5" },
  { id: 11, number: 24, max_score: 2, part: 2, part_title: "Часть 2", answer: "" },
];
const snapshot = [
  { id: 10, number: 17, max_score: 2, part: 1, part_title: "Часть 1" },
  { id: 11, number: 24, max_score: 2, part: 1, part_title: "Часть 1" },
];

describe("legacy view snapshot (r69)", () => {
  it("applies snapshot max/part only with marker", () => {
    expect(legacyViewTask(live[0], { tasks_snapshot: snapshot }).max_score).toBe(1);
    const t = legacyViewTask(live[0], { tasks_snapshot: snapshot, legacy_view_snapshot: "r69" });
    expect(t.max_score).toBe(2);
    expect(t.answer).toBe("5");
  });
  it("student rows follow the frozen parts", () => {
    const result = { by_task_id: { 10: "5" }, tasks_snapshot: snapshot, legacy_view_snapshot: "r69" };
    const rows = buildStudentHomeworkReviewRows(live, result, "oge", "math");
    expect(rows.part1.map((r) => r.number)).toEqual([17, 24]);
    expect(rows.part2).toEqual([]);
    const fresh = buildStudentHomeworkReviewRows(live, { by_task_id: { 10: "5" } }, "oge", "math");
    expect(fresh.part2.map((r) => r.number)).toEqual([24]);
  });
});
