import { describe, expect, it, beforeEach } from "vitest";

import {
  buildJitsiConfigOverwrite,
  buildJitsiEmbedUrl,
  getMeetingCameraEnabled,
  setMeetingCameraEnabled,
} from "./jitsiMeet";

describe("meeting camera preference", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("stores and reads camera preference per meeting", () => {
    expect(getMeetingCameraEnabled("m1")).toBeNull();
    setMeetingCameraEnabled("m1", true);
    expect(getMeetingCameraEnabled("m1")).toBe(true);
    setMeetingCameraEnabled("m1", false);
    expect(getMeetingCameraEnabled("m1")).toBe(false);
    expect(getMeetingCameraEnabled("m2")).toBeNull();
  });

  it("passes startWithVideoMuted into config overwrite", () => {
    expect(buildJitsiConfigOverwrite({ startWithVideoMuted: true }).startWithVideoMuted).toBe(true);
    expect(buildJitsiConfigOverwrite({ startWithVideoMuted: false }).startWithVideoMuted).toBe(false);
  });

  it("encodes startWithVideoMuted in embed URL", () => {
    const urlOn = buildJitsiEmbedUrl({
      domain: "meet.example.com",
      roomName: "room-a",
      startWithVideoMuted: false,
    });
    const urlOff = buildJitsiEmbedUrl({
      domain: "meet.example.com",
      roomName: "room-a",
      startWithVideoMuted: true,
    });
    expect(urlOn).toContain("config.startWithVideoMuted=false");
    expect(urlOff).toContain("config.startWithVideoMuted=true");
  });
});
