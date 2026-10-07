import { describe, expect, it } from "vitest";
import {
  shouldAutosaveLiveVariant,
  shouldHideHomeworkFinishButton,
  shouldShowHomeworkBottomActions,
} from "./cabinetHomework";

describe("homework submit UI visibility", () => {
  it("shows finish for cabinet homework even with lesson_token", () => {
    expect(
      shouldHideHomeworkFinishButton({
        embed: false,
        lessonToken: "jwt-token",
        isHomework: true,
        homeworkReadonly: false,
      }),
    ).toBe(false);
  });

  it("hides finish in lesson iframe embed", () => {
    expect(
      shouldHideHomeworkFinishButton({
        embed: true,
        lessonToken: "jwt-token",
        isHomework: true,
        homeworkReadonly: false,
      }),
    ).toBe(true);
  });

  it("hides finish for non-homework lesson_token sessions", () => {
    expect(
      shouldHideHomeworkFinishButton({
        embed: false,
        lessonToken: "jwt-token",
        isHomework: false,
        homeworkReadonly: false,
      }),
    ).toBe(true);
  });

  it("shows bottom submit actions for cabinet homework", () => {
    expect(
      shouldShowHomeworkBottomActions({
        isEmbeddedHomework: false,
        isCabinetHomework: true,
        homeworkStudentMode: true,
        isLiveVariant: false,
        isTeacherView: false,
        homeworkReadonly: false,
        statusNorm: "sent",
      }),
    ).toBe(true);
  });

  it("hides bottom actions after submit", () => {
    expect(
      shouldShowHomeworkBottomActions({
        isCabinetHomework: true,
        homeworkStudentMode: true,
        homeworkReadonly: true,
        statusNorm: "submitted",
      }),
    ).toBe(false);
  });
});

describe("shouldAutosaveLiveVariant", () => {
  it("saves a student draft during a live lesson", () => {
    expect(shouldAutosaveLiveVariant({
      isLiveVariant: true,
      teacherSide: false,
      studentSide: true,
      meetingUuid: "meet-1",
      viewerSettled: true,
    })).toBe(true);
  });

  it("does not let the teacher page overwrite the student draft", () => {
    expect(shouldAutosaveLiveVariant({
      isLiveVariant: true,
      teacherSide: true,
      studentSide: false,
      meetingUuid: "meet-1",
      viewerSettled: true,
    })).toBe(false);
  });

  it("waits until the viewer is known when the lesson id is present", () => {
    expect(shouldAutosaveLiveVariant({
      isLiveVariant: true,
      teacherSide: false,
      studentSide: false,
      meetingUuid: "meet-1",
      viewerSettled: false,
    })).toBe(false);
  });
});
