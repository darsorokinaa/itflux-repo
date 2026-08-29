import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JOIN_FATAL_TIMEOUT_MS,
  JOIN_SLOW_HINT,
  JOIN_SLOW_THRESHOLD_MS,
  createJitsiMeetSession,
} from "./jitsiMeet";
import { resetRuntimeResourceState } from "./pwa/runtimeResources";

function createFakeJitsiApi({ participantCount = 1, autoJoin = false, iframe = null } = {}) {
  const listeners = new Map();
  const api = {
    addListener(event, handler) {
      const list = listeners.get(event) || [];
      list.push(handler);
      listeners.set(event, list);
      if (autoJoin && event === "videoConferenceJoined") {
        queueMicrotask(() => handler({ id: "local-abc", roomName: "digitalstreamroom" }));
      }
    },
    removeListener(event, handler) {
      const list = listeners.get(event) || [];
      listeners.set(event, list.filter((h) => h !== handler));
    },
    emit(event, payload) {
      for (const handler of [...(listeners.get(event) || [])]) handler(payload);
    },
    getNumberOfParticipants() {
      return participantCount;
    },
    getParticipantsInfo() {
      return [{ id: "local-only", displayName: "Я" }];
    },
    getRoomsInfo() {
      return Promise.resolve({ rooms: [] });
    },
    executeCommand() {},
    dispose: vi.fn(() => {
      listeners.clear();
    }),
    getIFrame() {
      return iframe;
    },
    getSupportedEvents() {
      return [];
    },
    _listeners: listeners,
  };
  return api;
}

const jwtConfig = {
  domain: "meet.example.test",
  roomName: "digitalstreamroom",
  jwt: "jwt-token",
  authMode: "jwt",
  meeting: { uuid: "m1", title: "Урок" },
};

describe("createJitsiMeetSession join gating", () => {
  let container;
  let api;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    api = createFakeJitsiApi();
    window.JitsiMeetExternalAPI = function JitsiMeetExternalAPI() {
      return api;
    };
  });

  afterEach(() => {
    container.remove();
    delete window.JitsiMeetExternalAPI;
    resetRuntimeResourceState();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not treat iframe load as conference join", async () => {
    vi.useFakeTimers();
    const onJoined = vi.fn();
    const onEmbedded = vi.fn();
    const session = await createJitsiMeetSession(
      {
        domain: "meet.example.test",
        roomName: "digitalstreamroom",
        authMode: "open",
        meeting: { uuid: "m1", title: "Урок" },
      },
      container,
      { preferIframe: true, onJoined, onEmbedded },
    );
    expect(session.mode).toBe("iframe");
    await vi.advanceTimersByTimeAsync(1500);
    expect(onJoined).not.toHaveBeenCalled();
    expect(onEmbedded).toHaveBeenCalled();
    session.dispose();
  });

  it("records a verified join when videoConferenceJoined provides a participant id", async () => {
    window.JitsiMeetExternalAPI = function JitsiMeetExternalAPI() {
      return createFakeJitsiApi({ autoJoin: true });
    };
    const onJoined = vi.fn();
    const session = await createJitsiMeetSession(jwtConfig, container, { onJoined });
    expect(session.mode).toBe("external-api");
    expect(onJoined).toHaveBeenCalled();
    expect(onJoined.mock.calls[0][0].id).toBe("local-abc");
    session.dispose();
  });

  it("A: slow videoConferenceJoined after 15s resolves without dispose or error", async () => {
    vi.useFakeTimers();
    const onJoined = vi.fn();
    const onConnectionHint = vi.fn();
    const pending = createJitsiMeetSession(jwtConfig, container, { onJoined, onConnectionHint });

    await vi.advanceTimersByTimeAsync(JOIN_SLOW_THRESHOLD_MS);
    expect(api.dispose).not.toHaveBeenCalled();
    expect(onJoined).not.toHaveBeenCalled();
    expect(onConnectionHint).toHaveBeenCalledWith(JOIN_SLOW_HINT);

    await vi.advanceTimersByTimeAsync(7000);
    expect(api.dispose).not.toHaveBeenCalled();
    api.emit("videoConferenceJoined", { id: "local-late", roomName: "digitalstreamroom" });

    const session = await pending;
    expect(session.mode).toBe("external-api");
    expect(onJoined).toHaveBeenCalled();
    expect(api.dispose).not.toHaveBeenCalled();
    session.dispose();
    expect(api.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not treat participants>=1 as join before videoConferenceJoined", async () => {
    vi.useFakeTimers();
    const onJoined = vi.fn();
    const pending = createJitsiMeetSession(
      { ...jwtConfig, meeting: { uuid: "m1", title: "Урок" } },
      container,
      { onJoined },
    );
    await vi.advanceTimersByTimeAsync(JOIN_SLOW_THRESHOLD_MS + 50);
    expect(onJoined).not.toHaveBeenCalled();
    expect(api.dispose).not.toHaveBeenCalled();
    api.emit("videoConferenceJoined", { id: "self", roomName: "digitalstreamroom" });
    await pending;
    expect(onJoined).toHaveBeenCalled();
  });

  it("B: connectionFailed rejects immediately and disposes once", async () => {
    vi.useFakeTimers();
    const pending = createJitsiMeetSession(jwtConfig, container, {});
    await vi.advanceTimersByTimeAsync(3000);
    api.emit("connectionFailed", { error: "connection.droppedError" });
    await expect(pending).rejects.toMatchObject({ code: "jitsi_connection_failed" });
    expect(api.dispose).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(JOIN_FATAL_TIMEOUT_MS);
    expect(api.dispose).toHaveBeenCalledTimes(1);
  });

  it("B: conferenceFailed rejects immediately and disposes once", async () => {
    vi.useFakeTimers();
    const pending = createJitsiMeetSession(jwtConfig, container, {});
    await vi.advanceTimersByTimeAsync(2000);
    api.emit("conferenceFailed", { error: "conference.connectionError" });
    await expect(pending).rejects.toMatchObject({ code: "jitsi_conference_failed" });
    expect(api.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects auth/token failure immediately as jitsi_auth", async () => {
    vi.useFakeTimers();
    const pending = createJitsiMeetSession(jwtConfig, container, {});
    await vi.advanceTimersByTimeAsync(500);
    api.emit("connectionFailed", { error: "connection.connectionError.not-allowed" });
    await expect(pending).rejects.toMatchObject({ code: "jitsi_auth" });
    expect(api.dispose).toHaveBeenCalledTimes(1);
  });

  it("C: fatal watchdog rejects and disposes when join never arrives", async () => {
    vi.useFakeTimers();
    const onJoined = vi.fn();
    const pending = createJitsiMeetSession(jwtConfig, container, { onJoined });
    await vi.advanceTimersByTimeAsync(JOIN_SLOW_THRESHOLD_MS + 50);
    expect(api.dispose).not.toHaveBeenCalled();
    const assertion = expect(pending).rejects.toMatchObject({ code: "jitsi_join_timeout" });
    await vi.advanceTimersByTimeAsync(JOIN_FATAL_TIMEOUT_MS - JOIN_SLOW_THRESHOLD_MS);
    await assertion;
    expect(onJoined).not.toHaveBeenCalled();
    expect(api.dispose).toHaveBeenCalledTimes(1);
  });

  it("D: abort during join clears timers, removes listeners and disposes once", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const pending = createJitsiMeetSession(jwtConfig, container, { signal: abort.signal });
    await vi.advanceTimersByTimeAsync(120);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "jitsi_aborted" });
    expect(api.dispose).toHaveBeenCalledTimes(1);
    const remainingJoinWait = [...api._listeners.values()].reduce((n, list) => n + list.length, 0);
    expect(remainingJoinWait).toBe(0);
    await vi.advanceTimersByTimeAsync(JOIN_FATAL_TIMEOUT_MS);
    expect(api.dispose).toHaveBeenCalledTimes(1);
  });
});
