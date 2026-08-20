import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachConferencePresence,
  createParticipantStore,
  extractParticipantsFromInfo,
  extractParticipantsFromRoomsInfo,
  reconcileConferenceParticipants,
  shouldFallbackToIframe,
  isJitsiAuthJoinFailure,
} from "./jitsiParticipants";

function fakeApi({ participants = [], rooms = null } = {}) {
  const listeners = new Map();
  return {
    participants: [...participants],
    addListener(event, handler) {
      const list = listeners.get(event) || [];
      list.push(handler);
      listeners.set(event, list);
    },
    emit(event, payload) {
      for (const handler of listeners.get(event) || []) handler(payload);
    },
    getParticipantsInfo() {
      return this.participants;
    },
    getRoomsInfo() {
      return Promise.resolve(rooms);
    },
    executeCommand() {},
  };
}

describe("jitsi participant store", () => {
  it("upserts by participantId and does not double-count duplicates", () => {
    const store = createParticipantStore();
    store.setLocalId("local-1");
    store.upsert({ id: "local-1", displayName: "Учитель" });
    store.upsert({ id: "remote-1", displayName: "Ученик" });
    store.upsert({ id: "remote-1", displayName: "Ученик" });
    const snap = store.snapshot();
    expect(snap.count).toBe(2);
    expect(snap.localParticipant.id).toBe("local-1");
    expect(snap.remoteParticipants).toHaveLength(1);
    expect(snap.remoteParticipants[0].id).toBe("remote-1");
  });

  it("removes only the left participant", () => {
    const store = createParticipantStore();
    store.setLocalId("local-1");
    store.upsert({ id: "local-1" });
    store.upsert({ id: "remote-1" });
    store.upsert({ id: "remote-2" });
    store.remove("remote-1");
    const snap = store.snapshot();
    expect(snap.count).toBe(2);
    expect(snap.ids).toEqual(["local-1", "remote-2"]);
  });

  it("snapshot recovers a remote that never got participantJoined", () => {
    const store = createParticipantStore();
    store.setLocalId("local-1");
    store.upsert({ id: "local-1" });
    store.applySnapshot(
      [
        { participantId: "local-1", displayName: "Учитель" },
        { participantId: "remote-1", displayName: "Ученик" },
      ],
      { replace: true },
    );
    const snap = store.snapshot();
    expect(snap.count).toBe(2);
    expect(snap.remoteParticipants.map((p) => p.id)).toEqual(["remote-1"]);
  });

  it("does not count local user twice when snapshot includes local", () => {
    const store = createParticipantStore();
    store.setLocalId("abc");
    store.upsert({ id: "abc", displayName: "Я" });
    store.applySnapshot(
      [
        { participantId: "abc", displayName: "Я" },
        { id: "abc", displayName: "Я" },
      ],
      { replace: true },
    );
    expect(store.snapshot().count).toBe(1);
  });
});

describe("extract participants", () => {
  it("reads getParticipantsInfo and getRoomsInfo shapes", () => {
    expect(extractParticipantsFromInfo([
      { participantId: "a", displayName: "A" },
      { id: "b", displayName: "B" },
    ]).map((p) => p.id)).toEqual(["a", "b"]);

    expect(extractParticipantsFromRoomsInfo({
      rooms: [{ participants: [{ id: "c", displayName: "C" }] }],
    }).map((p) => p.id)).toEqual(["c"]);
  });
});

describe("reconcileConferenceParticipants", () => {
  it("replaces store from a complete live Jitsi roster", async () => {
    const store = createParticipantStore();
    store.setLocalId("local-1");
    store.upsert({ id: "local-1" });
    store.upsert({ id: "stale-1" });
    const api = fakeApi({
      participants: [
        { participantId: "local-1", displayName: "Учитель" },
        { participantId: "remote-1", displayName: "Ученик" },
      ],
    });
    const snap = await reconcileConferenceParticipants(api, store, { reason: "joined" });
    expect(snap.count).toBe(2);
    expect(snap.ids.sort()).toEqual(["local-1", "remote-1"]);
    expect(snap.reason).toBe("joined");
  });

  it("does not drop event-added remotes when snapshot is still only local", async () => {
    const store = createParticipantStore();
    store.setLocalId("local-1");
    store.upsert({ id: "local-1" });
    store.upsert({ id: "remote-1" });
    const api = fakeApi({
      participants: [{ participantId: "local-1", displayName: "Учитель" }],
    });
    const snap = await reconcileConferenceParticipants(api, store, { reason: "stale-info" });
    expect(snap.count).toBe(2);
    expect(snap.ids.sort()).toEqual(["local-1", "remote-1"]);
  });
});

describe("attachConferencePresence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers listeners and snapshots existing remotes after join", async () => {
    const api = fakeApi({
      participants: [
        { participantId: "teacher", displayName: "Учитель" },
        { participantId: "student", displayName: "Ученик" },
      ],
    });
    const counts = [];
    const presence = attachConferencePresence(api, {
      diagnostics: { roomName: "room1", meetingUuid: "m1", role: "teacher" },
      onParticipantCount: (n) => counts.push(n),
    });
    api.emit("videoConferenceJoined", { id: "teacher", roomName: "room1" });
    await presence.reconcile("test");
    const snap = presence.snapshot();
    expect(snap.count).toBe(2);
    expect(snap.remoteParticipants[0].id).toBe("student");
    expect(counts.at(-1)).toBe(2);
    presence.dispose();
  });

  it("does not warn when event.roomName is a MUC JID of the same room", () => {
    const api = fakeApi({ participants: [{ participantId: "t" }] });
    const onMediaWarning = vi.fn();
    const presence = attachConferencePresence(api, {
      diagnostics: { roomName: "digitalstreamabc" },
      onMediaWarning,
    });
    api.emit("videoConferenceJoined", {
      id: "t",
      roomName: "digitalstreamabc@conference.lesson.example",
    });
    expect(onMediaWarning).not.toHaveBeenCalled();
    presence.dispose();
  });

  it("is idempotent on duplicate participantJoined", async () => {
    const api = fakeApi({ participants: [{ participantId: "t" }] });
    const presence = attachConferencePresence(api, {
      diagnostics: { roomName: "room1" },
    });
    api.emit("videoConferenceJoined", { id: "t" });
    api.emit("participantJoined", { id: "s" });
    api.emit("participantJoined", { id: "s" });
    await presence.reconcile("dup");
    expect(presence.snapshot().count).toBe(2);
    api.emit("participantLeft", { id: "s" });
    await presence.reconcile("left");
    expect(presence.snapshot().count).toBe(1);
    presence.dispose();
  });

  it("reconciles again after reconnect join", async () => {
    const api = fakeApi({
      participants: [
        { participantId: "t" },
        { participantId: "s" },
      ],
    });
    const presence = attachConferencePresence(api, { diagnostics: { roomName: "r" } });
    api.emit("videoConferenceJoined", { id: "t" });
    await presence.reconcile("first");
    api.emit("videoConferenceLeft", {});
    api.participants = [{ participantId: "t" }, { participantId: "s" }];
    api.emit("videoConferenceJoined", { id: "t" });
    await presence.reconcile("reconnect");
    expect(presence.snapshot().count).toBe(2);
    presence.dispose();
  });

  it("notifies onLeft after a verified conference join", () => {
    const api = fakeApi({ participants: [{ participantId: "t" }] });
    const onLeft = vi.fn();
    const presence = attachConferencePresence(api, {
      diagnostics: { roomName: "r" },
      onLeft,
    });
    api.emit("videoConferenceLeft", {});
    expect(onLeft).not.toHaveBeenCalled();
    api.emit("videoConferenceJoined", { id: "t" });
    api.emit("videoConferenceLeft", {});
    expect(onLeft).toHaveBeenCalledWith({ id: "t" });
    presence.dispose();
  });
});

describe("isJitsiAuthJoinFailure", () => {
  it("detects Jitsi not-allowed, not first-join passwordRequired", () => {
    expect(isJitsiAuthJoinFailure({ error: "connection.connectionError.not-allowed" })).toBe(true);
    expect(isJitsiAuthJoinFailure({ name: "passwordRequired" })).toBe(false);
    expect(isJitsiAuthJoinFailure({ error: { message: "authentication failed" } })).toBe(true);
    expect(isJitsiAuthJoinFailure({ error: "conference.focusDisconnected" })).toBe(false);
    expect(isJitsiAuthJoinFailure(null)).toBe(false);
  });
});

describe("shouldFallbackToIframe", () => {
  it("never falls back to iframe for JWT meetings", () => {
    expect(shouldFallbackToIframe(
      { code: "jitsi_join_timeout" },
      { authMode: "jwt" },
    )).toBe(false);
  });

  it("never falls back after JWT auth rejection", () => {
    expect(shouldFallbackToIframe(
      { code: "jitsi_auth" },
      { authMode: "none" },
    )).toBe(false);
  });

  it("allows iframe only when explicitly forced or public jitsi script failure", () => {
    expect(shouldFallbackToIframe(
      { code: "jitsi_join_timeout" },
      { authMode: "none" },
    )).toBe(true);
    expect(shouldFallbackToIframe(
      { code: "jitsi_join_timeout" },
      { authMode: "jwt" },
      { forceIframe: true },
    )).toBe(true);
  });
});
