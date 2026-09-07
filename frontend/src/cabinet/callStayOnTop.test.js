import { describe, expect, it, vi, afterEach } from "vitest";

import {
  callStayOnTopAvailable,
  closeCallStayOnTop,
  findSameOriginCallVideo,
  requestCallStayOnTop,
  videoPipAvailable,
} from "./callStayOnTop";

vi.mock("../utils/clientTelemetry", () => ({
  reportClientEvent: vi.fn(() => true),
}));

describe("callStayOnTop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not throw when Picture-in-Picture is missing", async () => {
    vi.stubGlobal("document", {
      pictureInPictureEnabled: false,
      querySelectorAll: () => [],
    });
    expect(videoPipAvailable()).toBe(false);
    expect(callStayOnTopAvailable()).toBe(false);
    const result = await requestCallStayOnTop({ iframe: null });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("unsupported");
    await expect(closeCallStayOnTop()).resolves.toBeUndefined();
  });

  it("returns null for a cross-origin iframe", () => {
    const iframe = {
      get contentDocument() {
        throw new DOMException("Blocked", "SecurityError");
      },
      get contentWindow() {
        throw new DOMException("Blocked", "SecurityError");
      },
    };
    expect(findSameOriginCallVideo(iframe)).toBeNull();
  });

  it("picks a same-origin video with a live stream", () => {
    const video = {
      srcObject: { getTracks: () => [{}] },
      readyState: 2,
      ended: false,
      videoWidth: 640,
      videoHeight: 360,
    };
    const iframe = {
      contentDocument: {
        querySelectorAll: () => [video],
      },
    };
    expect(findSameOriginCallVideo(iframe)).toBe(video);
  });
});
