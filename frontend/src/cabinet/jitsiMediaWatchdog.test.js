import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NETWORK_RECOVERY_GRACE_MS,
  classifyMediaError,
  detectImpossibleMediaState,
  attachMediaWatchdog,
  createHardReconnectPolicy,
  shouldRecoverFromJitsiEvent,
  syncJitsiAudioDevices,
  audioDeviceStillPresent,
  pickReplacementDevice,
} from "./jitsiMediaWatchdog";

function createApi(overrides = {}) {
  const listeners = new Map();
  const api = {
    addListener(event, handler) {
      const list = listeners.get(event) || [];
      list.push(handler);
      listeners.set(event, list);
    },
    removeListener(event, handler) {
      const list = listeners.get(event) || [];
      listeners.set(event, list.filter((h) => h !== handler));
    },
    emit(event, payload) {
      for (const handler of [...(listeners.get(event) || [])]) handler(payload);
    },
    executeCommand: vi.fn(),
    getIFrame: () => ({ isConnected: true }),
    ...overrides,
  };
  api._listeners = listeners;
  return api;
}

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

  it("does not treat unknown mute state as a mismatch", () => {
    expect(detectImpossibleMediaState({
      intendedMicOn: true,
      audioMuted: null,
    })).toEqual([]);
  });
});

describe("shouldRecoverFromJitsiEvent", () => {
  it("never treats participantLeft as a local reconnect trigger", () => {
    expect(shouldRecoverFromJitsiEvent("participantLeft")).toBe(false);
    expect(shouldRecoverFromJitsiEvent("readyToClose")).toBe(false);
    expect(shouldRecoverFromJitsiEvent("connectionFailed")).toBe(true);
    expect(shouldRecoverFromJitsiEvent("videoConferenceLeft")).toBe(true);
  });
});

describe("audio device helpers", () => {
  it("keeps the current microphone when it is still listed", () => {
    expect(audioDeviceStillPresent({ deviceId: "mic-1" }, [
      { deviceId: "mic-1" },
      { deviceId: "mic-2" },
    ])).toBe(true);
    expect(pickReplacementDevice([{ deviceId: "mic-1" }], { deviceId: "mic-1" })).toBeNull();
  });

  it("picks a fallback when the selected microphone disappeared", () => {
    expect(audioDeviceStillPresent({ deviceId: "gone" }, [{ deviceId: "mic-2" }])).toBe(false);
    expect(deviceIdOfSafe(pickReplacementDevice(
      [{ deviceId: "default" }, { deviceId: "mic-2" }],
      { deviceId: "gone" },
    ))).toBe("default");
  });
});

function deviceIdOfSafe(entry) {
  return entry?.deviceId || "";
}

describe("syncJitsiAudioDevices", () => {
  it("does nothing when the selected microphone still exists", async () => {
    const api = {
      getCurrentDevices: vi.fn(async () => ({ audioInput: { deviceId: "mic-1" } })),
      getAvailableDevices: vi.fn(async () => ({
        audioInput: [{ deviceId: "mic-1" }, { deviceId: "mic-2" }],
        audioOutput: [{ deviceId: "out-1" }],
      })),
      setAudioInputDevice: vi.fn(),
      setAudioOutputDevice: vi.fn(),
    };
    const result = await syncJitsiAudioDevices(api);
    expect(result.inputAction).toBe("none");
    expect(api.setAudioInputDevice).not.toHaveBeenCalled();
  });

  it("switches input when the selected microphone disappeared", async () => {
    const api = {
      getCurrentDevices: vi.fn(async () => ({ audioInput: { deviceId: "bt-gone" } })),
      getAvailableDevices: vi.fn(async () => ({
        audioInput: [{ deviceId: "mic-builtin" }],
      })),
      setAudioInputDevice: vi.fn(),
    };
    const result = await syncJitsiAudioDevices(api);
    expect(result.inputAction).toBe("switched");
    expect(api.setAudioInputDevice).toHaveBeenCalled();
    expect(api.setAudioInputDevice.mock.calls[0][1] || api.setAudioInputDevice.mock.calls[0][0]).toBe("mic-builtin");
  });

  it("does not throw when output device change is unavailable", async () => {
    const api = {
      getCurrentDevices: vi.fn(async () => ({
        audioInput: { deviceId: "mic-1" },
        audioOutput: { deviceId: "out-gone" },
      })),
      getAvailableDevices: vi.fn(async () => ({
        audioInput: [{ deviceId: "mic-1" }],
        audioOutput: [{ deviceId: "out-2" }],
      })),
      setAudioOutputDevice: vi.fn(),
      isDeviceChangeAvailable: vi.fn(async () => false),
    };
    await expect(syncJitsiAudioDevices(api)).resolves.toMatchObject({ outputAction: "unsupported" });
    expect(api.setAudioOutputDevice).not.toHaveBeenCalled();
  });

  it("treats missing device APIs as unsupported, not as an error", async () => {
    await expect(syncJitsiAudioDevices({})).resolves.toMatchObject({ unsupported: true });
    await expect(syncJitsiAudioDevices({
      getCurrentDevices: async () => ({}),
    })).resolves.toMatchObject({ unsupported: true });
  });
});

describe("createHardReconnectPolicy", () => {
  it("allows three attempts with backoff then stops", () => {
    const policy = createHardReconnectPolicy({ stableMs: 0 });
    expect(policy.consumeAttempt()).toEqual({ attempt: 1, delayMs: 0 });
    policy.markAttemptFailed();
    expect(policy.consumeAttempt()).toEqual({ attempt: 2, delayMs: 3000 });
    policy.markAttemptFailed();
    expect(policy.consumeAttempt()).toEqual({ attempt: 3, delayMs: 8000 });
    policy.markAttemptFailed();
    expect(policy.consumeAttempt()).toBeNull();
    expect(policy.snapshot().exhausted).toBe(true);
    policy.reset();
    expect(policy.consumeAttempt()).toEqual({ attempt: 1, delayMs: 0 });
  });

  it("does not start a second attempt while one is in flight", () => {
    const policy = createHardReconnectPolicy({ stableMs: 0 });
    expect(policy.consumeAttempt()).toEqual({ attempt: 1, delayMs: 0 });
    expect(policy.consumeAttempt()).toBeNull();
  });
});

describe("attachMediaWatchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("classifies camera errors without reload", () => {
    const api = createApi();
    const onWarning = vi.fn();
    const handle = attachMediaWatchdog(api, {
      diagnostics: { meetingUuid: "m1", roomName: "r1" },
      getIntended: () => ({ micOn: false, camOn: true }),
      onWarning,
    });
    api.emit("cameraError", { name: "NotAllowedError" });
    expect(onWarning).toHaveBeenCalledWith("Нет разрешения на камеру");
    expect(api.executeCommand).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("does not toggle audio when mute state is unknown", () => {
    const api = createApi();
    const handle = attachMediaWatchdog(api, {
      getIntended: () => ({ micOn: true, camOn: false }),
    });
    handle.inspect();
    expect(api.executeCommand).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("does not treat peerConnectionFailure as a lost room", () => {
    const api = createApi();
    const onConnectionState = vi.fn();
    const onHint = vi.fn();
    const onReconnectRequired = vi.fn();
    const handle = attachMediaWatchdog(api, { onConnectionState, onHint, onReconnectRequired });
    api.emit("peerConnectionFailure");
    expect(onConnectionState).toHaveBeenCalledWith("peer_glitch", "peerConnectionFailure");
    expect(onHint).not.toHaveBeenCalled();
    expect(onReconnectRequired).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("does not reconnect or dispose on participantLeft", () => {
    const api = createApi({ dispose: vi.fn() });
    const onReconnectRequired = vi.fn();
    const onConnectionState = vi.fn();
    const handle = attachMediaWatchdog(api, { onReconnectRequired, onConnectionState });
    api.emit("videoConferenceJoined", { id: "local" });
    api.emit("participantLeft", { id: "remote" });
    expect(onReconnectRequired).not.toHaveBeenCalled();
    expect(onConnectionState).not.toHaveBeenCalledWith("reconnecting", "participantLeft");
    expect(api.dispose).not.toHaveBeenCalled();
    expect(handle.snapshot().cycleOpen).toBe(false);
    handle.dispose();
  });

  it("does not finish the lesson immediately on videoConferenceLeft after join", () => {
    vi.useFakeTimers();
    const api = createApi({ dispose: vi.fn() });
    const onReconnectRequired = vi.fn();
    const onConnectionState = vi.fn();
    const handle = attachMediaWatchdog(api, { onReconnectRequired, onConnectionState });
    api.emit("videoConferenceJoined", { id: "local" });
    api.emit("videoConferenceLeft");
    expect(api.dispose).not.toHaveBeenCalled();
    expect(onReconnectRequired).not.toHaveBeenCalled();
    expect(onConnectionState).toHaveBeenCalledWith("reconnecting", "videoConferenceLeft");
    handle.dispose();
  });

  it("does not start recovery after readyToClose hangup", () => {
    vi.useFakeTimers();
    const api = createApi();
    const onReconnectRequired = vi.fn();
    const handle = attachMediaWatchdog(api, { onReconnectRequired });
    api.emit("videoConferenceJoined", { id: "s" });
    api.emit("readyToClose");
    api.emit("videoConferenceLeft");
    api.emit("connectionFailed", { error: "connection.droppedError" });
    vi.advanceTimersByTime(NETWORK_RECOVERY_GRACE_MS + 50);
    expect(onReconnectRequired).not.toHaveBeenCalled();
    expect(handle.snapshot().intentionalClose).toBe(true);
    handle.dispose();
  });

  it("moves connectionFailed into reconnecting without disposing, then cancels on recovery", () => {
    vi.useFakeTimers();
    const api = createApi({ dispose: vi.fn() });
    const onReconnectRequired = vi.fn();
    const onConnectionState = vi.fn();
    const onHint = vi.fn();
    const handle = attachMediaWatchdog(api, { onReconnectRequired, onConnectionState, onHint });
    api.emit("videoConferenceJoined", { id: "local" });
    api.emit("connectionFailed", { error: "connection.droppedError" });
    expect(api.dispose).not.toHaveBeenCalled();
    expect(onReconnectRequired).not.toHaveBeenCalled();
    expect(onConnectionState).toHaveBeenCalledWith("reconnecting", "connectionFailed");
    expect(onHint).toHaveBeenCalledWith("Соединение восстанавливается…");
    api.emit("dataChannelOpened");
    vi.advanceTimersByTime(NETWORK_RECOVERY_GRACE_MS + 50);
    expect(onReconnectRequired).not.toHaveBeenCalled();
    expect(api.dispose).not.toHaveBeenCalled();
    expect(handle.snapshot().cycleOpen).toBe(false);
    handle.dispose();
  });

  it("requests a single hard reconnect if the conference does not recover", () => {
    vi.useFakeTimers();
    const api = createApi({ dispose: vi.fn() });
    const onReconnectRequired = vi.fn();
    const handle = attachMediaWatchdog(api, { onReconnectRequired });
    api.emit("videoConferenceJoined", { id: "local" });
    api.emit("conferenceFailed", { error: "conference.connectionError" });
    api.emit("connectionFailed", { error: "again" });
    api.emit("connectionFailed", { error: "again-2" });
    expect(onReconnectRequired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(NETWORK_RECOVERY_GRACE_MS);
    expect(onReconnectRequired).toHaveBeenCalledTimes(1);
    expect(onReconnectRequired).toHaveBeenCalledWith({
      reason: "conferenceFailed",
      preserveMediaState: true,
    });
    expect(api.dispose).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("does not create another reconnect from repeated errors in the same cycle", () => {
    vi.useFakeTimers();
    const api = createApi();
    const onReconnectRequired = vi.fn();
    const handle = attachMediaWatchdog(api, { onReconnectRequired });
    api.emit("videoConferenceJoined", { id: "local" });
    api.emit("connectionFailed");
    vi.advanceTimersByTime(NETWORK_RECOVERY_GRACE_MS);
    api.emit("connectionFailed");
    api.emit("conferenceFailed");
    vi.advanceTimersByTime(NETWORK_RECOVERY_GRACE_MS);
    expect(onReconnectRequired).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it("does not switch devices from deviceListChanged when the mic is still present", async () => {
    vi.useFakeTimers();
    const api = createApi({
      getCurrentDevices: vi.fn(async () => ({ audioInput: { deviceId: "mic-1" } })),
      getAvailableDevices: vi.fn(async () => ({ audioInput: [{ deviceId: "mic-1" }] })),
      setAudioInputDevice: vi.fn(),
    });
    const handle = attachMediaWatchdog(api, {});
    api.emit("deviceListChanged");
    await vi.advanceTimersByTimeAsync(400);
    expect(api.setAudioInputDevice).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("switches microphone when deviceListChanged reports the current mic is gone", async () => {
    vi.useFakeTimers();
    const api = createApi({
      getCurrentDevices: vi.fn(async () => ({ audioInput: { deviceId: "usb-gone" } })),
      getAvailableDevices: vi.fn(async () => ({ audioInput: [{ deviceId: "built-in" }] })),
      setAudioInputDevice: vi.fn(),
    });
    const onTelemetry = vi.fn();
    const handle = attachMediaWatchdog(api, { onTelemetry });
    api.emit("deviceListChanged");
    await vi.advanceTimersByTimeAsync(400);
    expect(api.setAudioInputDevice).toHaveBeenCalled();
    expect(onTelemetry).toHaveBeenCalledWith("audio_device_lost", expect.any(Object));
    expect(onTelemetry).toHaveBeenCalledWith("audio_device_recovered", expect.any(Object));
    const lostMeta = onTelemetry.mock.calls.find((call) => call[0] === "audio_device_lost")[1];
    expect(JSON.stringify(lostMeta)).not.toMatch(/usb-gone|built-in/i);
    handle.dispose();
  });

  it("does not throw when output device replacement is unavailable after deviceListChanged", async () => {
    vi.useFakeTimers();
    const api = createApi({
      getCurrentDevices: vi.fn(async () => ({
        audioInput: { deviceId: "mic-1" },
        audioOutput: { deviceId: "headphones" },
      })),
      getAvailableDevices: vi.fn(async () => ({
        audioInput: [{ deviceId: "mic-1" }],
        audioOutput: [{ deviceId: "speakers" }],
      })),
      setAudioOutputDevice: vi.fn(() => {
        throw new Error("output not supported");
      }),
      isDeviceChangeAvailable: vi.fn(async () => false),
    });
    const handle = attachMediaWatchdog(api, {});
    expect(() => api.emit("deviceListChanged")).not.toThrow();
    await vi.advanceTimersByTimeAsync(400);
    expect(api.setAudioOutputDevice).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("does nothing after dispose, including delayed grace reconnect", () => {
    vi.useFakeTimers();
    const api = createApi();
    const onReconnectRequired = vi.fn();
    const onHint = vi.fn();
    const handle = attachMediaWatchdog(api, { onReconnectRequired, onHint });
    api.emit("videoConferenceJoined", { id: "local" });
    api.emit("connectionFailed");
    handle.dispose();
    api.emit("connectionFailed");
    api.emit("deviceListChanged");
    vi.advanceTimersByTime(NETWORK_RECOVERY_GRACE_MS + WATCHDOG_SAFE_TICK);
    expect(onReconnectRequired).not.toHaveBeenCalled();
    expect(handle.snapshot().disposed).toBe(true);
  });

  it("removes listeners and timers on dispose so inspect cannot recover", () => {
    vi.useFakeTimers();
    const api = createApi();
    const handle = attachMediaWatchdog(api, {
      getIntended: () => ({ micOn: true }),
    });
    api.emit("audioMuteStatusChanged", { muted: true });
    handle.dispose();
    handle.inspect();
    vi.advanceTimersByTime(20000);
    expect(api.executeCommand).not.toHaveBeenCalled();
    expect(api._listeners.get("connectionFailed") || []).toEqual([]);
  });

  it("does not auto-create a conference when hangup happens during reconnect grace", () => {
    vi.useFakeTimers();
    const api = createApi();
    const onReconnectRequired = vi.fn();
    const handle = attachMediaWatchdog(api, {
      onReconnectRequired,
      shouldReconnect: () => false,
    });
    api.emit("videoConferenceJoined", { id: "local" });
    api.emit("connectionFailed");
    api.emit("readyToClose");
    vi.advanceTimersByTime(NETWORK_RECOVERY_GRACE_MS + 20);
    expect(onReconnectRequired).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("runs a health check on visibility without reconnecting a healthy call", () => {
    const api = createApi();
    const onReconnectRequired = vi.fn();
    const handle = attachMediaWatchdog(api, { onReconnectRequired });
    api.emit("videoConferenceJoined", { id: "local" });
    handle.handleLifecycleEvent("visibilitychange");
    handle.handleLifecycleEvent("pageshow");
    handle.handleLifecycleEvent("online");
    expect(onReconnectRequired).not.toHaveBeenCalled();
    expect(handle.snapshot().state).toBe("healthy");
    handle.dispose();
  });
});

const WATCHDOG_SAFE_TICK = 20000;
