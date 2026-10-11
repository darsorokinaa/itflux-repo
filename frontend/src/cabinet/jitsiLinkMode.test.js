import { describe, expect, it, vi } from "vitest";

import {
  WEAK_VIDEO_HEIGHT,
  applyAudioOnlyMode,
  applyStoredLinkPreferences,
  applyWeakVideo,
  describeCallLink,
  inspectCallMicrophone,
  shouldAskIfTheyHear,
} from "./jitsiLinkMode";

function fakeApi(supported = ["setAudioOnly", "setVideoQuality"]) {
  const commands = [];
  const api = {
    commands,
    videoMuted: false,
    audioMuted: false,
    executeCommand: vi.fn((name, value) => {
      commands.push([name, value]);
    }),
    isVideoMuted: vi.fn(async () => api.videoMuted),
    isAudioMuted: vi.fn(async () => api.audioMuted),
    getSupportedCommands: () => supported,
  };
  return api;
}

let fake;

describe("applyAudioOnlyMode", () => {
  it("enables audio-only on the current api and does not hang up", async () => {
    fake = fakeApi();
    fake.videoMuted = false;
    const result = await applyAudioOnlyMode(fake, true);
    expect(result.applied).toBe(true);
    expect(result.audioOnly).toBe(true);
    expect(result.videoMutedBefore).toBe(false);
    expect(fake.commands.map((row) => row[0])).toEqual(["setAudioOnly"]);
    expect(fake.commands.map((row) => row[0])).not.toContain("toggleAudio");
    expect(fake.commands).not.toContainEqual(["hangup", undefined]);
  });

  it("restores a camera that was already off", async () => {
    fake = fakeApi();
    fake.videoMuted = false;
    await applyAudioOnlyMode(fake, false, { videoMutedBefore: true });
    expect(fake.commands.map((row) => row[0])).toEqual(["setAudioOnly", "toggleVideo"]);
    expect(fake.commands.map((row) => row[0])).not.toContain("toggleAudio");
  });

  it("sends only the command the build lists", async () => {
    fake = fakeApi(["setLowBandwidthMode", "setAudioOnly"]);
    await applyAudioOnlyMode(fake, true);
    expect(fake.commands.map((row) => row[0])).toEqual(["setAudioOnly"]);

    fake = fakeApi(["set-low-bandwidth-mode"]);
    await applyAudioOnlyMode(fake, true);
    expect(fake.commands.map((row) => row[0])).toEqual(["setLowBandwidthMode"]);
  });

  it("does not send a quality command the build does not list", () => {
    fake = fakeApi(["setAudioOnly"]);
    expect(applyWeakVideo(fake, true)).toBe(false);
    expect(fake.commands).toEqual([]);
  });

  it("does not invent a command when the api is missing", async () => {
    const result = await applyAudioOnlyMode(null, true);
    expect(result.applied).toBe(false);
    expect(result.audioOnly).toBe(false);
  });
});

describe("applyWeakVideo", () => {
  it("lowers only this client's video height", () => {
    fake = fakeApi();
    expect(applyWeakVideo(fake, true)).toBe(true);
    expect(fake.commands[0]).toEqual(["setVideoQuality", WEAK_VIDEO_HEIGHT]);
    expect(fake.commands.map((row) => row[0])).not.toContain("setBlurredBackground");
  });

  it("reapplies audio-only without opening a new room", async () => {
    fake = fakeApi();
    const next = await applyStoredLinkPreferences(fake, { audioOnly: true, weak: true, videoMutedBefore: false });
    expect(next.audioOnly).toBe(true);
    expect(fake.commands.map((row) => row[0])).toEqual(["setAudioOnly"]);
  });
});

describe("describeCallLink", () => {
  it("does not call the call connected before the media channel opens", () => {
    const joinedOnly = describeCallLink({ callState: "joined", mediaChannelOpen: false });
    expect(joinedOnly.phase).toBe("in_room");
    expect(joinedOnly.title).not.toMatch(/хорош/i);
    const media = describeCallLink({ callState: "joined", mediaChannelOpen: true });
    expect(media.phase).toBe("media");
    expect(media.title).toBe("Слышимость не подтверждена");
    const heard = describeCallLink({
      callState: "joined",
      mediaChannelOpen: true,
      hearingConfirmed: true,
    });
    expect(heard.title).toBe("Слышимость подтверждена");
    expect(describeCallLink({ callState: "connecting" }).title).toBe("Подключение к конференции");
    expect(describeCallLink({ callState: "joined", mediaChannelOpen: false }).title).toBe("Подключение к медиамосту");
  });

  it("separates a failed first join from a lost call", () => {
    expect(describeCallLink({ callState: "failed", reconnectCount: 0 }).phase).toBe("failed");
    expect(describeCallLink({ callState: "failed", reconnectCount: 1 }).title).toBe("Соединение потеряно");
    expect(describeCallLink({ callState: "reconnecting" }).title).toBe("Восстанавливаем соединение");
    expect(describeCallLink({ callState: "leaving" }).phase).toBe("hidden");
  });

  it("reports an unreachable video service before join", () => {
    const link = describeCallLink({
      callState: "connecting",
      videoServiceUnreachable: true,
    });
    expect(link.phase).toBe("unavailable");
    expect(link.showReconnect).toBe(true);
  });
});

describe("shouldAskIfTheyHear", () => {
  it("asks only after the media channel is open and a peer is present", () => {
    expect(shouldAskIfTheyHear({
      mediaChannelOpen: true,
      remoteCount: 0,
      callState: "joined",
    })).toBe(false);
    expect(shouldAskIfTheyHear({
      mediaChannelOpen: false,
      remoteCount: 1,
      callState: "joined",
    })).toBe(false);
    expect(shouldAskIfTheyHear({
      mediaChannelOpen: true,
      remoteCount: 1,
      callState: "joined",
    })).toBe(true);
    expect(shouldAskIfTheyHear({
      mediaChannelOpen: true,
      remoteCount: 1,
      callState: "joined",
      answer: "yes",
    })).toBe(false);
  });
});

describe("inspectCallMicrophone", () => {
  it("does not treat an enabled mic as proof the other person hears", async () => {
    fake = fakeApi();
    fake.audioMuted = false;
    vi.stubGlobal("navigator", { permissions: { query: async () => ({ state: "granted" }) } });
    const result = await inspectCallMicrophone(fake);
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/не доказывает/i);
    vi.unstubAllGlobals();
  });
});
