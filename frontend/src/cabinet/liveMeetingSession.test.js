import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearActiveLiveMeeting,
  getActiveLiveMeeting,
  inAppPathForSameTab,
  meetingUuidFromPath,
  resolvePersistentMeetingView,
  setActiveLiveMeeting,
  subscribeActiveLiveMeeting,
} from "./liveMeetingSession";

const UUID = "d81b69db-5558-4279-8fbd-7bfe018437e5";

afterEach(() => clearActiveLiveMeeting());

describe("liveMeetingSession store", () => {
  it("sets, notifies and clears only the matching meeting", () => {
    const fn = vi.fn();
    const off = subscribeActiveLiveMeeting(fn);
    setActiveLiveMeeting(UUID);
    setActiveLiveMeeting(UUID);
    expect(fn).toHaveBeenCalledTimes(1);
    clearActiveLiveMeeting("other");
    expect(getActiveLiveMeeting()).toBe(UUID);
    clearActiveLiveMeeting(UUID);
    expect(getActiveLiveMeeting()).toBe("");
    expect(fn).toHaveBeenCalledTimes(2);
    off();
  });
});

describe("resolvePersistentMeetingView", () => {
  it("is full on the meeting route, mini elsewhere while live, none otherwise", () => {
    expect(resolvePersistentMeetingView({ pathname: `/cabinet/meetings/${UUID}` })).toEqual({ uuid: UUID, mode: "full" });
    expect(resolvePersistentMeetingView({ pathname: `/cabinet/meetings/${UUID}/`, activeUuid: UUID }).mode).toBe("full");
    for (const p of ["/ege/inf/variant/1707", "/oge/inf/variant/1828", "/cabinet/journal/lesson/1406", "/cabinet/schedule", "/cabinet"]) {
      expect(resolvePersistentMeetingView({ pathname: p, activeUuid: UUID })).toEqual({ uuid: UUID, mode: "mini" });
      expect(resolvePersistentMeetingView({ pathname: p })).toBeNull();
    }
    expect(meetingUuidFromPath("/cabinet/meetings")).toBe("");
  });
});

describe("inAppPathForSameTab", () => {
  const origin = "https://itflux-academy.ru";
  it("keeps SPA paths and rejects external / Django pages", () => {
    expect(inAppPathForSameTab("/ege/inf/variant/1707?meeting=x", origin)).toBe("/ege/inf/variant/1707?meeting=x");
    expect(inAppPathForSameTab(`${origin}/cabinet/boards/b1#a`, origin)).toBe("/cabinet/boards/b1#a");
    expect(inAppPathForSameTab("https://example.com/x", origin)).toBe("");
    expect(inAppPathForSameTab("/media/files/a.pdf", origin)).toBe("");
    expect(inAppPathForSameTab("/admin/", origin)).toBe("");
    expect(inAppPathForSameTab("", origin)).toBe("");
  });
});
