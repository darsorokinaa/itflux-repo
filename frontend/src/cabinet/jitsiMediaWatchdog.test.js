import { describe, expect, it, vi } from "vitest";

import {
  classifyMediaError,
  detectImpossibleMediaState,
  attachMediaWatchdog,
} from "./jitsiMediaWatchdog";

describe("classifyMediaError", () => {
  it("maps permission, missing, busy and ended cases", () => {
    expect(classifyMediaError({ name: "NotAllowedError" }, "camera").code).toBe("permission_denied");
    expect(classifyMediaError({ name: "NotFoundError" }, "camera").code).toBe("device_missing");
    expect(classifyMediaError({ message: "Could not start video source" }, "camera").code).toBe("device_busy");
    expect(classifyMediaError({ message: "ended" }, "mic").code).toBe("track_ended");
    expect(classifyMediaError({ name: "NotAllowedError" }, "mic").message).toMatch(/микрофон/i);
  });
});

describe("detectImpossibleMediaState", () => {
  it("flags UI vs track mismatches", () => {
    expect(detectImpossibleMediaState({
      intendedMicOn: true,
      audioMuted: true,
    }).map((i) => i.code)).toContain("mic_ui_mismatch");
    expect(detectImpossibleMediaState({
      intendedCamOn: true,
      videoMuted: true,
    }).map((i) => i.code)).toContain("camera_ui_mismatch");
    expect(detectImpossibleMediaState({
      screenSharing: true,
      screenTrackActive: false,
    }).map((i) => i.code)).toContain("screenshare_stale");
    expect(detectImpossibleMediaState({
      intendedMicOn: true,
      audioMuted: false,
    })).toEqual([]);
  });
});

describe("attachMediaWatchdog", () => {
  it("classifies camera errors without reload", () => {
    const listeners = new Map();
    const api = {
      addListener(event, handler) {
        listeners.set(event, handler);
      },
      removeListener(event) {
        listeners.delete(event);
      },
      executeCommand: vi.fn(),
    };
    const onWarning = vi.fn();
    const handle = attachMediaWatchdog(api, {
      diagnostics: { meetingUuid: "m1", roomName: "r1" },
      getIntended: () => ({ micOn: false, camOn: true }),
      onWarning,
    });
    listeners.get("cameraError")?.({ name: "NotAllowedError" });
    expect(onWarning).toHaveBeenCalledWith("Нет разрешения на камеру");
    expect(api.executeCommand).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("does not treat peerConnectionFailure as a lost room", () => {
    const listeners = new Map();
    const api = {
      addListener(event, handler) {
        listeners.set(event, handler);
      },
      removeListener(event) {
        listeners.delete(event);
      },
      executeCommand: vi.fn(),
    };
    const onConnectionState = vi.fn();
    const onHint = vi.fn();
    const handle = attachMediaWatchdog(api, { onConnectionState, onHint });
    listeners.get("peerConnectionFailure")?.();
    expect(onConnectionState).toHaveBeenCalledWith("peer_glitch", "peerConnectionFailure");
    expect(onHint).not.toHaveBeenCalled();
    handle.dispose();
  });
});
