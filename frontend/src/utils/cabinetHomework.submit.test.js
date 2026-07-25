import { describe, expect, it } from "vitest";
import {
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
