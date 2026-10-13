import { describe, expect, it, vi } from "vitest";

import {
  loadConferenceDevices,
  readMuteState,
  runConferenceCommand,
  setConferenceAudioMuted,
  setConferenceDevice,
} from "./conferenceCommands";

describe("conference commands", () => {
  it("forwards official commands and reports a missing api", () => {
    const executeCommand = vi.fn();
    expect(runConferenceCommand({ executeCommand }, "toggleAudio")).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith("toggleAudio");
    expect(runConferenceCommand(null, "toggleVideo")).toBe(false);
    executeCommand.mockImplementation(() => {
      throw new Error("gone");
    });
    expect(runConferenceCommand({ executeCommand }, "hangup")).toBe(false);
  });

  it("toggles audio only when the live mute state differs", async () => {
    const executeCommand = vi.fn();
    const muted = {
      executeCommand,
      isAudioMuted: vi.fn(async () => true),
    };
    await expect(setConferenceAudioMuted(muted, false)).resolves.toBe(true);
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(executeCommand).toHaveBeenCalledWith("toggleAudio");

    executeCommand.mockClear();
    const open = {
      executeCommand,
      isAudioMuted: vi.fn(async () => false),
    };
    await expect(setConferenceAudioMuted(open, false)).resolves.toBe(true);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("reads mute from the api instead of the button click", async () => {
    const api = {
      isAudioMuted: vi.fn(async () => true),
      isVideoMuted: vi.fn(async () => false),
    };
    await expect(readMuteState({ api })).resolves.toEqual({
      audioMuted: true,
      videoMuted: false,
    });
  });

  it("selects input and output devices through official commands", async () => {
    const executeCommand = vi.fn();
    const api = {
      executeCommand,
      getAvailableDevices: vi.fn(async () => ({
        audioInput: [{ deviceId: "mic", label: "Mic" }],
        audioOutput: [{ deviceId: "spk", label: "Speaker" }],
        videoInput: [],
      })),
    };
    expect(setConferenceDevice(api, "audioInput", { deviceId: "mic", label: "Mic" })).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith("setAudioInputDevice", "Mic", "mic");
    expect(setConferenceDevice(api, "audioOutput", { deviceId: "spk", label: "Speaker" })).toBe(true);
    expect(executeCommand).toHaveBeenCalledWith("setAudioOutputDevice", "spk");
    await expect(loadConferenceDevices(api)).resolves.toMatchObject({
      audioInput: [{ deviceId: "mic" }],
    });
    expect(setConferenceDevice(api, "audioInput", {})).toBe(false);
  });
});
