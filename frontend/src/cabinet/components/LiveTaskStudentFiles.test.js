import { describe, expect, it } from "vitest";
import { liveStudentsFilesForTask } from "./LiveTaskStudentFiles";

const answers = {
  students: [
    { studentId: 83, displayName: "Аня", result: { task_attachments: { tasks: { 1226: { student: [{ id: "a", name: "page-1.jpg", url: "/api/homework/attachments/a/file/" }], teacher: [] } } } } },
    { studentId: 84, displayName: "Боря", result: {} },
  ],
};

describe("r129 files under task", () => {
  it("only students with files for this task", () => {
    const rows = liveStudentsFilesForTask(answers, { id: 1226, number: 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0].studentId).toBe(83);
    expect(liveStudentsFilesForTask(answers, { id: 1, number: 1 })).toEqual([]);
  });
});
