import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JOIN_TIMEOUT_MS, createJitsiMeetSession } from "./jitsiMeet";

function createFakeJitsiApi({ participantCount = 1, autoJoin = false } = {}) {
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
    emit(event, payload) {
      for (const handler of listeners.get(event) || []) handler(payload);
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
    dispose() {},
    getIFrame() {
      return null;
    },
    getSupportedEvents() {
      return [];
    },
  };
  return api;
}

describe("createJitsiMeetSession join gating", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    window.JitsiMeetExternalAPI = function JitsiMeetExternalAPI() {
      return createFakeJitsiApi();
    };
  });

  afterEach(() => {
    container.remove();
    delete window.JitsiMeetExternalAPI;
    vi.useRealTimers();
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
    const session = await createJitsiMeetSession(
      {
        domain: "meet.example.test",
        roomName: "digitalstreamroom",
        jwt: "jwt-token",
        authMode: "jwt",
        meeting: { uuid: "m1", title: "Урок", isModerator: true },
      },
      container,
      { onJoined },
    );
    expect(session.mode).toBe("external-api");
    expect(onJoined).toHaveBeenCalled();
    expect(onJoined.mock.calls[0][0].id).toBe("local-abc");
    session.dispose();
  });

  it("does not join on timeout just because participants>=1 (self)", async () => {
    vi.useFakeTimers();
    const onJoined = vi.fn();
    const pending = createJitsiMeetSession(
      {
        domain: "meet.example.test",
        roomName: "digitalstreamroom",
        jwt: "jwt-token",
        authMode: "jwt",
        meeting: { uuid: "m1", title: "Урок" },
      },
      container,
      { onJoined },
    );
    const assertion = expect(pending).rejects.toMatchObject({ code: "jitsi_join_timeout" });
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS + 50);
    await assertion;
    expect(onJoined).not.toHaveBeenCalled();
  });
});
