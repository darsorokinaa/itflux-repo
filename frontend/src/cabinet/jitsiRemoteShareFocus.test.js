import { describe, it, expect, vi } from "vitest";
import { attachRemoteShareFocus, SCREENSHARE_RECEIVE_HEIGHT } from "./jitsiRemoteShareFocus";

function fakeApi() {
  const l = {};
  return {
    executeCommand: vi.fn(),
    addListener: (n, f) => { (l[n] ||= []).push(f); },
    removeListener: vi.fn(),
    fire: (n, e) => (l[n] || []).forEach((f) => f(e)),
  };
}

describe("r94 remote screenshare focus (receiver)", () => {
  it("pins remote sharer and requests 1080", () => {
    const api = fakeApi();
    attachRemoteShareFocus(api, { keepAliveMs: 0 });
    api.fire("videoConferenceJoined", { id: "me" });
    api.fire("contentSharingParticipantsChanged", { data: ["student1"] });
    expect(api.executeCommand).toHaveBeenCalledWith("setTileView", false);
    expect(api.executeCommand).toHaveBeenCalledWith("setLargeVideoParticipant", "student1");
    expect(api.executeCommand).toHaveBeenCalledWith("setVideoQuality", SCREENSHARE_RECEIVE_HEIGHT);
    expect(SCREENSHARE_RECEIVE_HEIGHT).toBe(1080);
  });

  it("ignores own share", () => {
    const api = fakeApi();
    attachRemoteShareFocus(api, { keepAliveMs: 0 });
    api.fire("videoConferenceJoined", { id: "me" });
    api.fire("contentSharingParticipantsChanged", { data: ["me"] });
    expect(api.executeCommand).not.toHaveBeenCalled();
  });

  it("re-pins when stage moves away (throttled), releases when share stops", () => {
    let t = 0;
    const api = fakeApi();
    attachRemoteShareFocus(api, { keepAliveMs: 0, now: () => t });
    api.fire("videoConferenceJoined", { id: "me" });
    api.fire("contentSharingParticipantsChanged", { data: ["s"] });
    api.executeCommand.mockClear();
    t = 500;
    api.fire("largeVideoChanged", { id: "me" });
    expect(api.executeCommand).not.toHaveBeenCalled(); // throttle
    t = 3000;
    api.fire("largeVideoChanged", { id: "me" });
    expect(api.executeCommand).toHaveBeenCalledWith("setLargeVideoParticipant", "s");
    api.executeCommand.mockClear();
    api.fire("contentSharingParticipantsChanged", { data: [] });
    expect(api.executeCommand).toHaveBeenCalledWith("setLargeVideoParticipant");
  });
});
