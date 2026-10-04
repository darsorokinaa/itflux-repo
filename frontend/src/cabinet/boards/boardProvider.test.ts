import { describe, expect, it } from "vitest";

import {
  lessonBoardDisplayName,
  lessonBoardPresenceColor,
  lessonBoardRoomId,
  lessonBoardSyncUri,
  normalizeBoardProvider,
  tldrawLicenseKey,
} from "./boardProvider";

const BOARD_A = "11111111-1111-4111-8111-111111111111";
const BOARD_B = "22222222-2222-4222-8222-222222222222";

describe("board provider", () => {
  it("keeps excalidraw unless the flag is exactly tldraw", () => {
    expect(normalizeBoardProvider(undefined)).toBe("excalidraw");
    expect(normalizeBoardProvider("")).toBe("excalidraw");
    expect(normalizeBoardProvider("excalidraw")).toBe("excalidraw");
    expect(normalizeBoardProvider("yjs")).toBe("excalidraw");
    expect(normalizeBoardProvider("tldraw")).toBe("tldraw");
    expect(normalizeBoardProvider(" TLDRAW ")).toBe("tldraw");
  });

  it("builds one stable room id from the board uuid", () => {
    const first = lessonBoardRoomId(BOARD_A);
    const second = lessonBoardRoomId(BOARD_A);
    expect(first).toBe(BOARD_A);
    expect(second).toBe(first);
    expect(lessonBoardRoomId(BOARD_B)).toBe(BOARD_B);
    expect(lessonBoardSyncUri(BOARD_A)).toBe(`ws://${window.location.host}/ws/tldraw/${BOARD_A}/`);
  });

  it("rejects names, emails and blank ids", () => {
    expect(lessonBoardRoomId("")).toBe("");
    expect(lessonBoardRoomId("  ")).toBe("");
    expect(lessonBoardRoomId("teacher@school.test")).toBe("");
    expect(lessonBoardRoomId("Анна Петрова")).toBe("");
    expect(lessonBoardRoomId("board-1")).toBe("");
  });

  it("does not put an email on the cursor", () => {
    expect(lessonBoardDisplayName("teacher@school.test", "teacher")).toBe("Учитель");
    expect(lessonBoardDisplayName("Мария", "student")).toBe("Мария");
    expect(lessonBoardDisplayName("", "student")).toBe("Ученик");
    expect(lessonBoardPresenceColor("teacher", 1)).toBe("#2563eb");
    expect(lessonBoardPresenceColor("teacher", 2)).toBe("#2563eb");
    expect(lessonBoardPresenceColor("student", 4)).not.toBe(lessonBoardPresenceColor("student", 9));
    expect(lessonBoardPresenceColor("student", 4)).toBe(lessonBoardPresenceColor("student", 4));
  });

  it("omits an empty license key", () => {
    expect(tldrawLicenseKey()).toBeUndefined();
  });
});
