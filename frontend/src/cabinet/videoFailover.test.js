import { describe, expect, it } from "vitest";

import {
  acceptGeneration,
  classifyClientFault,
  describeCallReadiness,
  finishWithin,
  nextProviderSwitch,
  nextPublishIntent,
  providerSwitchStillCurrent,
  reconnectDelayMs,
  shouldReportFault,
} from "./videoFailover";

describe("classifyClientFault", () => {
  it("does not treat a muted microphone as a provider outage", () => {
    expect(classifyClientFault({ intentionalMute: true, code: "connection_failed" })).toBe("intentional_mute");
    expect(classifyClientFault({ name: "NotAllowedError", code: "jitsi_script" })).toBe("device_permission");
  });

  it("keeps a single local network error off the room switch", () => {
    expect(classifyClientFault({ code: "ice_failed", scope: "local", online: true })).toBe("local_network");
    expect(classifyClientFault({ online: false, code: "jitsi_script" })).toBe("platform_offline");
    expect(classifyClientFault({ status: 403 })).toBe("auth_denied");
    expect(classifyClientFault({ status: 503, code: "server" })).toBe("platform_error");
  });

  it("recognises a real provider failure only by an explicit code", () => {
    expect(classifyClientFault({ code: "jitsi_script_timeout", online: true })).toBe("provider_outage");
    expect(classifyClientFault({ code: "something_else" })).toBe("local_network");
    expect(classifyClientFault({ code: "local_audio" })).toBe("local_network");
  });
});

describe("failover guards", () => {
  it("reports only after the local retry budget", () => {
    expect(shouldReportFault({ fault: "provider_outage", attempt: 2, maxAttempts: 3 })).toBe(false);
    expect(shouldReportFault({ fault: "provider_outage", attempt: 3, maxAttempts: 3 })).toBe(true);
    expect(shouldReportFault({ fault: "device_permission", attempt: 5 })).toBe(false);
  });

  it("keeps a single in-flight provider switch", () => {
    expect(nextProviderSwitch({ activeOp: 0, currentKind: "jaas", targetKind: "livekit" })).toEqual({ target: "livekit" });
    for (let i = 0; i < 10; i += 1) {
      expect(nextProviderSwitch({ activeOp: 1, currentKind: "jaas", targetKind: "livekit" })).toBeNull();
      expect(nextProviderSwitch({ activeOp: 1, currentKind: "jaas", targetKind: "jaas" })).toBeNull();
    }
    expect(nextProviderSwitch({ activeOp: 0, currentKind: "livekit", targetKind: "livekit" })).toBeNull();
    expect(nextProviderSwitch({ activeOp: 0, currentKind: "livekit", targetKind: "jaas" })).toEqual({ target: "jaas" });
    expect(providerSwitchStillCurrent(4, 4)).toBe(true);
    expect(providerSwitchStillCurrent(5, 4)).toBe(false);
    expect(providerSwitchStillCurrent(0, 4)).toBe(false);
  });

  it("stops waiting when a disconnect does not finish", async () => {
    let finished = false;
    await finishWithin(async () => {
      finished = true;
    }, 1000);
    expect(finished).toBe(true);
    const started = Date.now();
    await finishWithin(() => new Promise(() => {}), 40);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("ignores a stale provider generation", () => {
    expect(acceptGeneration(4, 4)).toBe(false);
    expect(acceptGeneration(4, 3)).toBe(false);
    expect(acceptGeneration(4, 5)).toBe(true);
  });

  it("does not call the call connected before audio actually leaves", () => {
    expect(describeCallReadiness({ iceConnected: false, micIntended: true, packetsSent: 10 })).toBe("connecting");
    expect(describeCallReadiness({ iceConnected: true, micIntended: true, packetsSent: 0, micLive: true })).toBe("checking-audio");
    expect(describeCallReadiness({ iceConnected: true, micIntended: true, packetsSent: 4, micLive: true })).toBe("media");
    expect(describeCallReadiness({
      iceConnected: true,
      micIntended: true,
      packetsSent: 0,
      micLive: true,
      timedOut: true,
    })).toBe("media");
    expect(describeCallReadiness({
      iceConnected: true,
      micIntended: true,
      packetsSent: 0,
      micLive: false,
      timedOut: true,
    })).toBe("audio-stalled");
    expect(describeCallReadiness({ iceConnected: true, micIntended: false, packetsSent: 0 })).toBe("media");
  });

  it("backs off and keeps the chosen mute state", () => {
    expect(reconnectDelayMs(1)).toBe(1000);
    expect(reconnectDelayMs(2)).toBe(2000);
    expect(reconnectDelayMs(8)).toBe(15000);
    expect(nextPublishIntent({ micOn: false, camOn: true, screenSharing: true })).toEqual({
      micOn: false,
      camOn: true,
      screenSharing: false,
    });
  });
});
