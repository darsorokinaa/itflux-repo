import { describe, expect, it } from "vitest";
import { getStudentAssignmentPath } from "./studentAssignmentCards";

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
});
