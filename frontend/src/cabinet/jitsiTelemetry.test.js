import { describe, expect, it } from "vitest";

import {
  canonicalJitsiRoomName,
  classifyConferencePresence,
  jitsiRoomsMatch,
  roomGuardDecision,
  sanitizeTelemetryMetadata,
  toPersistableTechnicalEvent,
} from "./jitsiTelemetry";

describe("jitsi conference identity", () => {
  it("treats MUC JID as the same room as join-config roomName", () => {
    expect(canonicalJitsiRoomName("digitalstreamabc@conference.lesson.example")).toBe("digitalstreamabc");
    expect(jitsiRoomsMatch("digitalstreamabc", "digitalstreamabc@conference.lesson.example")).toBe(true);
    expect(jitsiRoomsMatch("digitalstreamabc", "OTHER@conference.lesson.example")).toBe(false);
  });

  it("strips jwt/email from telemetry metadata", () => {
    const cleaned = sanitizeTelemetryMetadata({
      jwt: "secret.token",
      email: "a@b.c",
      configuredRoomName: "room1",
      eventRoomName: "room1@conference.x",
    });
    expect(cleaned.jwt).toBeUndefined();
    expect(cleaned.email).toBeUndefined();
    expect(cleaned.configuredRoomName).toBe("room1");
  });

  it("stores reconnect and device events under types the backend accepts", () => {
    expect(toPersistableTechnicalEvent("jitsi_hard_reconnect_started", "peerConnectionFailure")).toMatchObject({
      eventType: "connection_reconnecting",
      reason: "peerConnectionFailure",
      clientEvent: "jitsi_hard_reconnect_started",
    });
    expect(toPersistableTechnicalEvent("jitsi_hard_reconnect_succeeded").eventType).toBe("connection_restored");
    expect(toPersistableTechnicalEvent("mic_error", "permission_denied")).toMatchObject({
      eventType: "connection_failed",
      reason: "permission_denied",
      clientEvent: "mic_error",
    });
    expect(toPersistableTechnicalEvent("conference_joined", "").eventType).toBe("conference_joined");
    const mapped = toPersistableTechnicalEvent("jitsi_hard_reconnect_failed", "exhausted");
    expect(JSON.stringify(mapped)).not.toMatch(/eyJ|PRIVATE KEY|jwt/i);
  });

  it("refuses a reconnect into a different room", () => {
    expect(roomGuardDecision("", "room-a")).toEqual({ ok: true, lock: "room-a", reason: "" });
    expect(roomGuardDecision("room-a", "room-a").ok).toBe(true);
    expect(roomGuardDecision("room-a", "room-a@conference.example").ok).toBe(true);
    expect(roomGuardDecision("room-a", "room-b")).toMatchObject({ ok: false, reason: "room_changed", lock: "room-a" });
  });
});

describe("presence classification", () => {
  it("classifies scenario A vs media failure", () => {
    expect(classifyConferencePresence({ conferenceJoined: true, participantCount: 1 }).scenario).toBe("A");
    expect(classifyConferencePresence({
      conferenceJoined: true,
      participantCount: 2,
      mediaFailed: true,
    }).code).toBe("media_failed");
    expect(classifyConferencePresence({
      conferenceJoined: true,
      participantCount: 2,
    }).code).toBe("peer_connecting_media");
  });
});

describe("presence events change conference presence", () => {
  it("participantJoined is not treated as attendance proof", () => {
    const waiting = classifyConferencePresence({ conferenceJoined: true, participantCount: 1 });
    const together = classifyConferencePresence({ conferenceJoined: true, participantCount: 2 });
    expect(waiting.code).toBe("waiting_peer");
    expect(together.code).toBe("peer_connecting_media");
  });

  it("shows waiting until a remote peer is actually in the room", () => {
    expect(classifyConferencePresence({
      conferenceJoined: true,
      participantCount: 1,
      remoteCount: 0,
      isTeacher: true,
    }).label).toBe("Ждём ученика");
    expect(classifyConferencePresence({
      conferenceJoined: true,
      participantCount: 1,
      remoteCount: 0,
      isTeacher: false,
    }).label).toBe("Ждём учителя");
  });

  it("does not keep waiting when roster count already includes a peer", () => {
    expect(classifyConferencePresence({
      conferenceJoined: true,
      participantCount: 2,
      remoteCount: 0,
      isTeacher: true,
    }).code).toBe("peer_connecting_media");
    expect(classifyConferencePresence({
      conferenceJoined: true,
      participantCount: 2,
      remoteCount: 0,
      mediaUp: true,
      isTeacher: false,
    }).code).toBe("in_call");
  });

  it("shows connecting only after the peer joined and media is not up yet", () => {
    expect(classifyConferencePresence({
      conferenceJoined: true,
      participantCount: 2,
      remoteCount: 1,
      isTeacher: true,
    }).label).toBe("Ученик подключается…");
    expect(classifyConferencePresence({
      conferenceJoined: true,
      participantCount: 2,
      remoteCount: 1,
      mediaUp: true,
      isTeacher: true,
    }).label).toBe("");
    expect(classifyConferencePresence({
      conferenceJoined: true,
      participantCount: 2,
      remoteCount: 1,
      isTeacher: false,
    }).label).toBe("Учитель подключается…");
  });

  it("does not keep a media-failed hint after media is up", () => {
    expect(classifyConferencePresence({
      conferenceJoined: true,
      participantCount: 2,
      mediaFailed: true,
      mediaUp: true,
    }).code).toBe("in_call");
  });
});
