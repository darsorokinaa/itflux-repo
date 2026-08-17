import { describe, expect, it, vi, afterEach } from "vitest";

import {
  attachScreenSharePresence,
  buildScreenShareSnapshot,
  extractDisplaySurface,
  extractTrackResolution,
  parseSharingParticipantIds,
} from "./jitsiScreenShare";

describe("parseSharingParticipantIds", () => {
  it("accepts array, sharingParticipantIds and data shapes", () => {
    expect(parseSharingParticipantIds(["a", "b"])).toEqual(["a", "b"]);
    expect(parseSharingParticipantIds({ sharingParticipantIds: ["x"] })).toEqual(["x"]);
    expect(parseSharingParticipantIds({ data: ["y"] })).toEqual(["y"]);
  });
});

describe("extractTrackResolution", () => {
  it("reads nested participant/ssrc resolution", () => {
    const stats = {
      resolution: {
        abc: { "111": { width: 1920, height: 1080 } },
      },
    };
    expect(extractTrackResolution(stats, "abc")).toEqual({ width: 1920, height: 1080 });
  });

  it("prefers the largest nested track (desktop over camera)", () => {
    const stats = {
      resolution: {
        abc: {
          camera: { width: 640, height: 360 },
          desktop: { width: 1920, height: 1080 },
        },
      },
    };
    expect(extractTrackResolution(stats, "abc")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("extractDisplaySurface", () => {
  it("maps Jitsi sourceType / getDisplayMedia displaySurface", () => {
    expect(extractDisplaySurface({ on: true, details: { displaySurface: "browser" } })).toBe("browser");
    expect(extractDisplaySurface({ details: { sourceType: "screen" } })).toBe("monitor");
    expect(extractDisplaySurface({ sourceType: "window" })).toBe("window");
  });
});

describe("buildScreenShareSnapshot", () => {
  it("is active when local or remote sharing", () => {
    expect(buildScreenShareSnapshot({ localSharing: true, localId: "me" }).active).toBe(true);
    expect(buildScreenShareSnapshot({ sharingIds: ["other"] }).presenterJitsiId).toBe("other");
    expect(buildScreenShareSnapshot({}).active).toBe(false);
  });
});

describe("attachScreenSharePresence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to documented IFrame events and reports local share", async () => {
    const listeners = new Map();
    const api = {
      addListener(event, handler) {
        listeners.set(event, handler);
      },
      removeListener(event) {
        listeners.delete(event);
      },
      getSupportedEvents: () => [
        "screenSharingStatusChanged",
        "contentSharingParticipantsChanged",
        "largeVideoChanged",
        "tileViewChanged",
        "videoConferenceJoined",
      ],
      getContentSharingParticipants: vi.fn(async () => ({ sharingParticipantIds: ["p2"] })),
      isSharingScreen: vi.fn(async () => true),
      getConnectionStats: vi.fn(async () => ({
        resolution: { p2: { ssrc: { width: 1280, height: 720 } } },
      })),
    };
    const onChange = vi.fn();
    const handle = attachScreenSharePresence(api, { onChange, pollMs: 60000 });
    listeners.get("screenSharingStatusChanged")?.({ on: true, details: { displaySurface: "browser" } });
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.localSharing).toBe(true);
    expect(last.sharingIds).toContain("p2");
    expect(last.displaySurface).toBe("browser");
    handle.dispose();
  });
});
