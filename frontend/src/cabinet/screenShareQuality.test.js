import { describe, expect, it, vi } from "vitest";

import {
  JITSI_SCREEN_SHARE_FRAME_RATE,
  SCREEN_SHARE_BITRATE_CAP,
  SCREEN_SHARE_CAPTURE,
  SCREEN_SHARE_CAPTURE_EDGE,
  SCREEN_SHARE_MAX_FPS,
  SCREEN_SHARE_RECEIVE_HEIGHT,
  jitsiScreenShareBitrateCaps,
  liveKitScreenShareEncoding,
  liveKitScreenSharePublish,
  refreshScreenShareSubscription,
  screenShareCaptureFallback,
  screenShareViewWantsDetail,
} from "./screenShareQuality";

describe("screen share quality policy", () => {
  it("keeps a text-first frame cap without a hard minimum", () => {
    expect(JITSI_SCREEN_SHARE_FRAME_RATE).toEqual({ max: SCREEN_SHARE_MAX_FPS });
    expect(JITSI_SCREEN_SHARE_FRAME_RATE).not.toHaveProperty("min");
    expect(SCREEN_SHARE_MAX_FPS).toBeLessThanOrEqual(15);
    expect(SCREEN_SHARE_RECEIVE_HEIGHT).toBe(1080);
  });

  it("raises only the screen-share bitrate ceiling", () => {
    const caps = jitsiScreenShareBitrateCaps();
    expect(caps.vp9).toBeGreaterThanOrEqual(4_000_000);
    expect(caps.vp8).toBeGreaterThanOrEqual(caps.vp9);
    expect(caps.h264).toBe(caps.vp8);
    expect(SCREEN_SHARE_BITRATE_CAP).toBeGreaterThanOrEqual(2_500_000);
    expect(SCREEN_SHARE_BITRATE_CAP).toBeLessThanOrEqual(6_000_000);
  });

  it("asks for detail on an expanded stage and not on a minimized strip", () => {
    expect(screenShareViewWantsDetail({ expanded: true })).toBe(true);
    expect(screenShareViewWantsDetail({ minimized: true })).toBe(false);
    expect(screenShareViewWantsDetail({ expanded: true, weak: true })).toBe(false);
    expect(screenShareViewWantsDetail({})).toBe(true);
  });

  it("does not put an exact frame rate on capture and stays square", () => {
    expect(SCREEN_SHARE_CAPTURE.contentHint).toBe("detail");
    expect(SCREEN_SHARE_CAPTURE.resolution.width).toBe(SCREEN_SHARE_CAPTURE_EDGE);
    expect(SCREEN_SHARE_CAPTURE.resolution.height).toBe(SCREEN_SHARE_CAPTURE.resolution.width);
    expect(SCREEN_SHARE_CAPTURE.resolution).not.toHaveProperty("frameRate");
    expect(SCREEN_SHARE_CAPTURE_EDGE).toBeGreaterThanOrEqual(1920);
    const encoding = liveKitScreenShareEncoding();
    expect(encoding.maxBitrate).toBe(SCREEN_SHARE_BITRATE_CAP);
    expect(encoding.maxFramerate).toBe(SCREEN_SHARE_MAX_FPS);
    expect(encoding).not.toHaveProperty("minBitrate");
    expect(liveKitScreenSharePublish().degradationPreference).toBe("maintain-resolution");
    expect(liveKitScreenSharePublish().simulcast).toBe(true);
  });

  it("retries capture without a resolution box only when constraints were rejected", () => {
    expect(screenShareCaptureFallback({ name: "OverconstrainedError" })).toEqual({ contentHint: "detail" });
    expect(screenShareCaptureFallback({ name: "ConstraintNotSatisfiedError" }).resolution).toBeUndefined();
    expect(screenShareCaptureFallback({ name: "NotAllowedError" })).toBeNull();
    expect(screenShareCaptureFallback({ name: "NotFoundError" })).toBeNull();
  });

  it("re-requests the high screen layer after expand and leaves the camera alone", () => {
    const screen = { setVideoQuality: vi.fn() };
    const camera = { setVideoQuality: vi.fn() };
    const room = {
      remoteParticipants: new Map([
        ["student", {
          identity: "student",
          getTrackPublication: (source) => (source === "screen" ? screen : camera),
        }],
      ]),
    };
    expect(refreshScreenShareSubscription(room, "screen", { expanded: true, highQuality: 2 })).toEqual(["student"]);
    expect(screen.setVideoQuality).toHaveBeenCalledWith(2);
    expect(camera.setVideoQuality).not.toHaveBeenCalled();
    screen.setVideoQuality.mockClear();
    expect(refreshScreenShareSubscription(room, "screen", { expanded: false, highQuality: 2 })).toEqual([]);
    expect(screen.setVideoQuality).not.toHaveBeenCalled();
  });
});
