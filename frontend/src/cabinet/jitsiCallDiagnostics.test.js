import { describe, expect, it } from "vitest";

import { classifyJoinStop, joinMediaIntent } from "./jitsiCallDiagnostics";
import { createHardReconnectPolicy, decideHardReconnect } from "./jitsiMediaWatchdog";
import { roomGuardDecision } from "./jitsiTelemetry";

describe("join media intent across a reconnect", () => {
  it("keeps the microphone on when the user was speaking", () => {
    const intent = joinMediaIntent({
      storedMic: true,
      storedCam: true,
      recovering: true,
      intendedMicOn: true,
      intendedCamOn: true,
    });
    expect(intent.startWithAudioMuted).toBe(false);
    expect(intent.startWithVideoMuted).toBe(false);
  });

  it("does not turn the microphone on after a drop if it was muted", () => {
    const intent = joinMediaIntent({
      storedMic: false,
      storedCam: false,
      recovering: true,
      intendedMicOn: false,
      intendedCamOn: false,
    });
    expect(intent.micOn).toBe(false);
    expect(intent.startWithAudioMuted).toBe(true);
    expect(intent.camOn).toBe(false);
  });

  it("starts the first join muted unless the user already enabled the mic", () => {
    expect(joinMediaIntent({ storedMic: null, recovering: false }).micOn).toBe(false);
    expect(joinMediaIntent({ storedMic: true, recovering: false }).micOn).toBe(true);
  });
});

describe("classifyJoinStop", () => {
  it("does not split a failed script load into DNS versus HTTPS", () => {
    const stage = classifyJoinStop({ online: true, scriptLoaded: false, code: "jitsi_script" });
    expect(stage.failureClass).toBe("dns_or_https");
    expect(stage.dnsSeparated).toBe(false);
    expect(stage.httpsSeparated).toBe(false);
    expect(stage.mediaConfirmed).toBe(false);
  });

  it("does not call a script timeout, WebRTC or a Safari capture error dns_or_https", () => {
    expect(classifyJoinStop({
      online: true,
      scriptLoaded: false,
      iframeCreated: false,
      code: "jitsi_script_timeout",
    })).toMatchObject({ stage: "script", failureClass: "script_timeout", eventType: "connection_failed" });
    expect(classifyJoinStop({
      scriptLoaded: false,
      iframeCreated: false,
      code: "jitsi_join_timeout",
    })).toMatchObject({ stage: "signaling", failureClass: "signaling" });
    expect(classifyJoinStop({
      scriptLoaded: false,
      iframeCreated: false,
      code: "jitsi_connection_failed",
    }).failureClass).toBe("signaling");
    expect(classifyJoinStop({
      scriptLoaded: false,
      iframeCreated: false,
      code: "jitsi_conference_failed",
    }).failureClass).toBe("ice");
    expect(classifyJoinStop({
      scriptLoaded: false,
      iframeCreated: false,
      code: "peerConnectionFailure",
    }).failureClass).toBe("ice");
    expect(classifyJoinStop({
      scriptLoaded: false,
      iframeCreated: false,
      code: "NotAllowedError",
    }).failureClass).toBe("device");
    expect(classifyJoinStop({
      scriptLoaded: false,
      iframeCreated: false,
      eventName: "Activating capture must be called from a user gesture handler",
    }).failureClass).toBe("device");
  });

  it("separates signaling, ICE, missing media and an already open call that dropped", () => {
    expect(classifyJoinStop({
      scriptLoaded: true,
      iframeCreated: true,
      code: "jitsi_connection_failed",
    }).stage).toBe("signaling");
    expect(classifyJoinStop({
      scriptLoaded: true,
      iframeCreated: true,
      conferenceJoined: true,
      code: "jitsi_conference_failed",
    }).failureClass).toBe("ice");
    expect(classifyJoinStop({
      scriptLoaded: true,
      iframeCreated: true,
      conferenceJoined: true,
      mediaChannelOpen: false,
    }).stage).toBe("no_media");
    expect(classifyJoinStop({
      scriptLoaded: true,
      iframeCreated: true,
      conferenceJoined: true,
      mediaChannelOpen: true,
      eventName: "peerConnectionFailure",
    }).stage).toBe("interrupted");
  });

  it("treats an expired or rejected JWT as auth, not as a connected call", () => {
    const stage = classifyJoinStop({
      scriptLoaded: true,
      iframeCreated: true,
      code: "jitsi_auth",
    });
    expect(stage.stage).toBe("auth");
    expect(stage.mediaConfirmed).toBe(false);
  });

  it("does not treat an iframe as media", () => {
    const stage = classifyJoinStop({
      scriptLoaded: true,
      iframeCreated: true,
      conferenceJoined: false,
      code: "jitsi_join_timeout",
    });
    expect(stage.mediaConfirmed).toBe(false);
    expect(stage.stage).not.toBe("interrupted");
  });
});

describe("reconnect keeps one room and one attempt", () => {
  it("uses a fresh join only in the locked room", () => {
    const policy = createHardReconnectPolicy({ stableMs: 0 });
    const started = decideHardReconnect({ policy });
    expect(started.action).toBe("start");
    const room = roomGuardDecision("lesson-room", "lesson-room");
    expect(room.ok).toBe(true);
    expect(decideHardReconnect({ policy }).action).toBe("wait");
    policy.markSuccess();
  });

  it("does not open another reconnect after the user leaves", () => {
    const policy = createHardReconnectPolicy({ stableMs: 0 });
    decideHardReconnect({ policy });
    expect(decideHardReconnect({ intentionalLeave: true, policy }).action).toBe("stop");
    expect(policy.snapshot().inFlight).toBe(true);
  });
});
