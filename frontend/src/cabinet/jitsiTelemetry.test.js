import { describe, expect, it } from "vitest";

import {
  canonicalJitsiRoomName,
  classifyConferencePresence,
  jitsiRoomsMatch,
  sanitizeTelemetryMetadata,
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
});
