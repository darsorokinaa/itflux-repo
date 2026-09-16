import { describe, expect, it } from "vitest";
import {
  catalogLessonSlugFromUrl,
  isLessonWorkspaceSelfMeetingUrl,
  meetingLessonContentUrl,
  openPresentedMaterial,
  presentedIdentityKey,
  presentedOpenKey,
  shouldEmbedMaterialInLesson,
  shouldReplaceWorkspaceMaterial,
  workspaceMaterialFromPresented,
  workspaceMaterialIdentityKey,
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

describe("catalog lesson url in the meeting workspace", () => {
  it("rewrites preview and spa viewer urls to lesson HTML", () => {
    expect(catalogLessonSlugFromUrl("/lessons?preview=grafiki-funkci")).toBe("grafiki-funkci");
    expect(catalogLessonSlugFromUrl("/lessons/grafiki-funkci/view")).toBe("grafiki-funkci");
    expect(meetingLessonContentUrl("/lessons?preview=grafiki-funkci")).toBe(
      "/api/lessons/grafiki-funkci/view/",
    );
    expect(meetingLessonContentUrl("https://itflux.ru/lessons/grafiki-funkci/view")).toBe(
      "/api/lessons/grafiki-funkci/view/",
    );
    expect(meetingLessonContentUrl("/api/cabinet/files/1/preview/")).toBe(
      "/api/cabinet/files/1/preview/",
    );
  });
});

describe("live variant workspace identity", () => {
  it("treats repeated SHOW with a new token/presentedAt as the same attempt", () => {
    const first = {
      kind: "variant",
      homeworkId: 41,
      variantId: 17,
      presentedAt: "2026-01-01T12:00:00.000Z",
      openUrl: "/ege/math/variant/17?cabinet_assignment=41&lesson_token=aaa&live_meeting=1",
    };
    const again = {
      ...first,
      presentedAt: "2026-01-01T12:03:00.000Z",
      openUrl: "/ege/math/variant/17?cabinet_assignment=41&lesson_token=bbb&live_meeting=1",
    };
    expect(presentedIdentityKey(first)).toBe("variant:41");
    expect(presentedOpenKey(again)).toBe(presentedOpenKey(first));
    const held = workspaceMaterialFromPresented(first, "meet-1");
    const incoming = workspaceMaterialFromPresented(again, "meet-1");
    expect(shouldReplaceWorkspaceMaterial(held, incoming)).toBe(false);
    expect(workspaceMaterialIdentityKey(held)).toBe("variant:41");
  });

  it("reloads only when the variant/homework identity changes", () => {
    const current = {
      kind: "variant",
      homeworkId: 41,
      variantId: 17,
      url: "/ege/math/variant/17?cabinet_assignment=41&lesson_token=aaa",
    };
    expect(shouldReplaceWorkspaceMaterial(current, {
      kind: "variant",
      homeworkId: 99,
      variantId: 18,
      url: "/ege/math/variant/18?cabinet_assignment=99&lesson_token=zzz",
    })).toBe(true);
  });
});
