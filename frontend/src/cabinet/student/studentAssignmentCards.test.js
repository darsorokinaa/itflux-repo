import { describe, expect, it } from "vitest";
import { getStudentAssignmentPath, mapStudentAssignmentToHwCard, studentHomeworkStatus } from "./studentAssignmentCards";

describe("getStudentAssignmentPath", () => {
  it("opens student interactives by assignment id, not interactive id", () => {
    expect(getStudentAssignmentPath({
      kind: "interactive",
      id: 10,
      interactive_id: 99,
      interactive_assignment_id: 10,
    })).toBe("/cabinet/student/interactives/10/play");

    expect(getStudentAssignmentPath({
      kind: "interactive",
      id: 10,
      interactive_id: 99,
    })).toBe("/cabinet/student/interactives/10/play");
  });

  it("keeps a future due date instead of marking the homework overdue", () => {
    const item = {
      status: "overdue",
      status_label: "Просрочено",
      due_at: "2099-06-01T15:00:00.000Z",
      title: "Логика",
      type_label: "Домашнее задание",
    };
    expect(studentHomeworkStatus(item)).toBe("new");
    const card = mapStudentAssignmentToHwCard(item);
    expect(card.deadlineLabel).not.toMatch(/просроч/i);
    expect(card.deadlineTone).not.toBe("overdue");
    expect(card.deadlineLabel).toMatch(/До /);
  });
});
