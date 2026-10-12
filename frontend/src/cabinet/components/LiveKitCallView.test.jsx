import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const room = {
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(),
  on: vi.fn(),
  localParticipant: {
    identity: "p1",
    setMicrophoneEnabled: vi.fn(async () => {}),
    setCameraEnabled: vi.fn(async () => {}),
    setScreenShareEnabled: vi.fn(async () => {}),
    setName: vi.fn(async () => {}),
  },
  remoteParticipants: new Map(),
  switchActiveDevice: vi.fn(async () => {}),
};

vi.mock("livekit-client", () => {
  class MockRoom {
    constructor() {
      return room;
    }

    static getLocalDevices() {
      return Promise.resolve([]);
    }
  }
  return {
  Room: MockRoom,
  RoomEvent: {
    ConnectionStateChanged: "ConnectionStateChanged",
    Reconnecting: "Reconnecting",
    Reconnected: "Reconnected",
    ParticipantConnected: "ParticipantConnected",
    ParticipantDisconnected: "ParticipantDisconnected",
    TrackSubscribed: "TrackSubscribed",
    TrackUnsubscribed: "TrackUnsubscribed",
    LocalTrackPublished: "LocalTrackPublished",
    LocalTrackUnpublished: "LocalTrackUnpublished",
    TrackMuted: "TrackMuted",
    TrackUnmuted: "TrackUnmuted",
    MediaDevicesError: "MediaDevicesError",
    ConnectionQualityChanged: "ConnectionQualityChanged",
    Disconnected: "Disconnected",
    DataReceived: "dataReceived",
    ActiveSpeakersChanged: "activeSpeakersChanged",
  },
  Track: {
    Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen_share" },
    Kind: { Video: "video", Audio: "audio" },
  },
  ConnectionState: { Connected: "connected", Reconnecting: "reconnecting", Disconnected: "disconnected" },
  ConnectionQuality: { Poor: "poor", Lost: "lost" },
  DisconnectReason: { CLIENT_INITIATED: 1, PARTICIPANT_REMOVED: 4 },
  VideoPresets: {
    h180: { resolution: { width: 320, height: 180 } },
    h360: { resolution: { width: 640, height: 360 } },
    h540: { resolution: { width: 960, height: 540 } },
  },
  };
});

import LiveKitCallView, { audioOnlyForTileRefresh, collectTiles, liveKitConferenceStatus } from "./LiveKitCallView";

describe("LiveKitCallView", () => {
  beforeEach(() => {
    room.connect.mockClear();
    room.disconnect.mockClear();
    room.removeAllListeners.mockClear();
    room.localParticipant.setMicrophoneEnabled.mockClear();
  });

  it("starts muted when the lesson asked to keep the microphone off", async () => {
    render(
      <LiveKitCallView
        meetingUuid="meet-1"
        url="wss://video.example.test"
        token="header.payload.sig"
        startWithAudioMuted
        startWithVideoMuted
        displayName="Анна"
      />,
    );
    expect(await screen.findByRole("button", { name: "Включить микрофон" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Включить камеру" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Поднять руку" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Чат" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Завершить звонок" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Завершить участие" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Только звук" })).toBeNull();
    expect(room.connect).toHaveBeenCalledWith("wss://video.example.test", "header.payload.sig");
  });

  it("releases the room before another provider starts", async () => {
    const ref = createRef();
    const view = render(
      <LiveKitCallView
        ref={ref}
        meetingUuid="meet-1"
        url="wss://video.example.test"
        token="header.payload.sig"
      />,
    );
    await act(async () => {
      await ref.current.releaseMedia();
    });
    expect(room.removeAllListeners).toHaveBeenCalled();
    expect(room.disconnect).toHaveBeenCalledWith(true);
    view.unmount();
  });

  it("keeps other participants visible when a local camera or microphone is published", () => {
    const remoteCamera = { id: "remote-cam" };
    const localCamera = { id: "local-cam" };
    const sample = {
      localParticipant: {
        name: "Вы",
        getTrackPublication: (source) => (source === "camera" ? { track: localCamera } : null),
      },
      remoteParticipants: new Map([
        ["p2", {
          identity: "p2",
          name: "Ученик",
          getTrackPublication: (source) => (source === "camera" ? { track: remoteCamera } : null),
        }],
      ]),
    };
    const publishedTrack = { kind: "video", source: "camera" };
    const audioOnly = audioOnlyForTileRefresh(publishedTrack, false);
    const { tiles } = collectTiles(sample, { audioOnly });
    expect(audioOnly).toBe(false);
    expect(tiles.map((tile) => tile.key)).toEqual(["local-camera", "p2-camera"]);
  });

  it("keeps a participant on screen as an avatar when the camera is off", () => {
    const sample = {
      localParticipant: {
        name: "Вы",
        getTrackPublication: () => null,
      },
      remoteParticipants: new Map([
        ["p2", {
          identity: "p2",
          name: "Ученик",
          getTrackPublication: () => null,
        }],
      ]),
    };
    const { tiles } = collectTiles(sample, { audioOnly: false });
    expect(tiles.map((tile) => tile.key)).toEqual(["local-avatar", "p2-avatar"]);
    expect(tiles.every((tile) => tile.avatar)).toBe(true);
  });

  it("uses the same connection phrases as the lesson conference", () => {
    expect(liveKitConferenceStatus("reconnecting").title).toBe("Восстанавливаем соединение");
    expect(liveKitConferenceStatus("connecting").title).toBe("Подключаемся к занятию");
    expect(liveKitConferenceStatus("connected").title).toBe("");
  });

  it("does not play the local microphone back into the room", () => {
    const localMic = { id: "local" };
    const remoteMic = { id: "remote" };
    const sample = {
      localParticipant: {
        name: "Вы",
        getTrackPublication: (source) => (source === "microphone" ? { track: localMic } : null),
      },
      remoteParticipants: new Map([
        ["p2", {
          identity: "p2",
          name: "Участник",
          getTrackPublication: (source) => (source === "microphone" ? { track: remoteMic } : null),
        }],
      ]),
    };
    const { audios } = collectTiles(sample, { audioOnly: false });
    expect(audios.map((item) => item.track)).toEqual([remoteMic]);
  });

  it("stops the room when the view is removed", async () => {
    const view = render(
      <LiveKitCallView
        meetingUuid="meet-1"
        url="wss://video.example.test"
        token="header.payload.sig"
      />,
    );
    await screen.findByRole("button", { name: "Выключить микрофон" });
    view.unmount();
    expect(room.disconnect).toHaveBeenCalledWith(true);
  });
});
