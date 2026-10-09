import { describe, expect, it } from "vitest";
import {
  getStudentAssignmentPath,
  mapStudentAssignmentToHwCard,
  studentAssignmentPhase,
  studentHomeworkStatus,
  studentShowsPublishedReview,
  studentTeacherRemark,
  STUDENT_PHASE_LABEL,
} from "./studentAssignmentCards";

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

describe("student assignment phase", () => {
  const returned = {
    status: "needs_fix",
    status_label: "Нужно исправить",
    variant_submitted: true,
    submitted_at: "2026-10-02T12:00:00+03:00",
    teacher_comment: "Покажите ход решения",
    title: "Дроби",
    type_label: "Домашнее задание",
  };

  it("shows a returned work as needs fix even when submitted_at is set", () => {
    expect(studentAssignmentPhase(returned)).toBe("needs_fix");
    expect(STUDENT_PHASE_LABEL.needs_fix).toBe("На доработке");
    const card = mapStudentAssignmentToHwCard(returned);
    expect(card.deadlineLabel).toBe("На доработке");
    expect(card.commentPreview).toBe("Покажите ход решения");
  });

  it("does not let variant_submitted override the returned status", () => {
    expect(studentAssignmentPhase({
      ...returned,
      variant_submitted: true,
    })).toBe("needs_fix");
    expect(studentAssignmentPhase({
      status: "submitted",
      variant_submitted: true,
    })).toBe("reviewing");
    expect(studentAssignmentPhase({ status: "new", variant_submitted: false })).toBe("not_submitted");
    expect(studentAssignmentPhase({ status: "overdue" })).toBe("overdue");
    expect(studentAssignmentPhase({ status: "checked", variant_submitted: true })).toBe("checked");
  });

  it("shows the teacher remark on a returned work and keeps it as history after resubmit", () => {
    expect(studentTeacherRemark(returned)).toEqual({
      kind: "current",
      text: "Покажите ход решения",
    });
    const resubmitted = { ...returned, status: "submitted", status_label: "Сдано" };
    expect(studentAssignmentPhase(resubmitted)).toBe("reviewing");
    expect(studentTeacherRemark(resubmitted)).toEqual({
      kind: "history",
      text: "Покажите ход решения",
    });
    expect(mapStudentAssignmentToHwCard(resubmitted).deadlineLabel).toBe("На проверке");
    expect(mapStudentAssignmentToHwCard(resubmitted).commentPreview).toBe("");
  });

  it("does not show a comment when review cards disagree", () => {
    const conflict = {
      ...returned,
      review_comment_conflict: true,
      teacher_comment: "Произвольный комментарий",
    };
    expect(studentTeacherRemark(conflict).kind).toBe("conflict");
    expect(studentTeacherRemark(conflict).text).not.toContain("Произвольный комментарий");
    expect(mapStudentAssignmentToHwCard(conflict).commentPreview).toBe("");
  });

  it("shows a published review after check, return, and a later resubmit", () => {
    expect(studentShowsPublishedReview({ status: "checked", teacher_comment: "Зачтено" })).toBe(true);
    expect(studentShowsPublishedReview({ status: "needs_fix", teacher_comment: "Исправьте" })).toBe(true);
    expect(studentShowsPublishedReview({
      status: "submitted",
      teacher_comment: "Исправьте чертеж",
      published_notebooks: [{ task_id: "A", revision_id: "rev-1" }],
    })).toBe(true);
    expect(studentShowsPublishedReview({ status: "submitted", teacher_comment: "" })).toBe(false);
    expect(studentShowsPublishedReview({ status: "new" })).toBe(false);
  });
});
