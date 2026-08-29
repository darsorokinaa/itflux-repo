import { describe, expect, it } from "vitest";
import {
  isLessonWorkspaceSelfMeetingUrl,
  openPresentedMaterial,
  shouldEmbedMaterialInLesson,
} from "./meetingPresent";

describe("lesson workspace embed", () => {
  const meetingUuid = "meet-1";

  it("embeds same-origin, files, and external links in the room", () => {
    expect(shouldEmbedMaterialInLesson("/cabinet/boards/b1", { meetingUuid })).toBe(true);
    expect(shouldEmbedMaterialInLesson("/api/cabinet/files/1/preview/", { meetingUuid })).toBe(true);
    expect(shouldEmbedMaterialInLesson("https://docs.google.com/document/d/x", { meetingUuid })).toBe(true);
    expect(shouldEmbedMaterialInLesson("https://vk.com/doc1", { meetingUuid })).toBe(true);
  });

  it("does not embed the live meeting page into itself", () => {
    expect(isLessonWorkspaceSelfMeetingUrl(`/cabinet/meetings/${meetingUuid}`, meetingUuid)).toBe(true);
    expect(shouldEmbedMaterialInLesson(
      `https://itflux-academy.ru/cabinet/meetings/${meetingUuid}`,
      { meetingUuid },
    )).toBe(false);
  });

  it("never navigates the meeting tab to an external URL", () => {
    expect(openPresentedMaterial("https://example.com/file.pdf")).toBe("in-room");
  });
});
