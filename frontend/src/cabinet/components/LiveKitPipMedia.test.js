import { describe, expect, it, vi } from "vitest";

vi.mock("livekit-client", () => ({
  Room: class {},
  RoomEvent: {},
  Track: { Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen_share" }, Kind: { Video: "video" } },
  ConnectionState: {},
  ConnectionQuality: {},
  DisconnectReason: {},
  VideoPresets: { h180: {}, h360: {}, h540: { resolution: {} } },
}));

import { collectTiles } from "./LiveKitCallView";
import { pickPipMedia } from "../livekitPipMedia";

function participant(identity, name, { camera = null, cameraMuted = false } = {}) {
  return {
    identity,
    name,
    getTrackPublication: (source) => (source === "camera" && camera ? { track: camera, isMuted: cameraMuted } : null),
  };
}

describe("pickPipMedia (r72)", () => {
  it("prefers the dominant speaker and passes tracks as is", () => {
    const camA = { attach: vi.fn() };
    const camB = { attach: vi.fn() };
    const localCam = { attach: vi.fn() };
    const room = {
      remoteParticipants: new Map([
        ["a", participant("a", "Аня", { camera: camA })],
        ["b", participant("b", "Боря", { camera: camB })],
      ]),
      localParticipant: participant("me", "Я", { camera: localCam }),
    };
    const media = pickPipMedia(room, { dominantId: "b", micOn: true, camOn: true });
    expect(media.remote).toMatchObject({ source: camB, name: "Боря", cameraOff: false, waiting: false });
    expect(media.local).toMatchObject({ source: localCam, cameraOff: false });
    expect(media.micOn).toBe(true);
  });

  it("falls back to a remote with a live camera, then marks camera off", () => {
    const cam = {};
    const room = {
      remoteParticipants: new Map([
        ["a", participant("a", "Без камеры")],
        ["b", participant("b", "С камерой", { camera: cam })],
      ]),
      localParticipant: participant("me", "Я"),
    };
    expect(pickPipMedia(room, {}).remote.name).toBe("С камерой");
    const muted = { remoteParticipants: new Map([["a", participant("a", "А", { camera: cam, cameraMuted: true })]]) };
    expect(pickPipMedia(muted, {}).remote.cameraOff).toBe(true);
  });

  it("reports waiting with nobody in the room and own camera off when camOn=false", () => {
    const media = pickPipMedia({ remoteParticipants: new Map(), localParticipant: participant("me", "Я", { camera: {} }) }, { camOn: false });
    expect(media.remote.waiting).toBe(true);
    expect(media.local.cameraOff).toBe(true);
    expect(pickPipMedia(null).remote.waiting).toBe(true);
  });

  it("marks only remote camera tiles for video PiP", () => {
    const room = {
      localParticipant: participant("me", "Я", { camera: {} }),
      remoteParticipants: new Map([["a", participant("a", "А", { camera: {} })]]),
    };
    const { tiles } = collectTiles(room, { audioOnly: false });
    expect(tiles.filter((t) => t.pipRole === "remote").map((t) => t.key)).toEqual(["a-camera"]);
  });
});
