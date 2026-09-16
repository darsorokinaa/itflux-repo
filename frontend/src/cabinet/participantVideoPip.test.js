/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createParticipantPipController,
  requestIframeParticipantPip,
  videoPipAvailable,
} from "./participantVideoPip";

vi.mock("../utils/clientTelemetry", () => ({
  reportClientEvent: vi.fn(() => true),
}));

function fakeRemoteVideo(track) {
  const parent = {
    id: "participant_student",
    className: "remote-video",
    nodeType: 1,
    parentElement: null,
  };
  return {
    id: "remoteVideo_student",
    className: "",
    nodeType: 1,
    parentElement: parent,
    ended: false,
    readyState: 2,
    videoWidth: 640,
    videoHeight: 360,
    disablePictureInPicture: false,
    srcObject: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    },
  };
}

class FakeMediaStream {
  constructor(tracks = []) {
    this._tracks = [...tracks];
  }

  getTracks() {
    return this._tracks;
  }

  getVideoTracks() {
    return this._tracks.filter((track) => track.kind !== "audio");
  }

  addTrack(track) {
    this._tracks.push(track);
  }

  removeTrack(track) {
    this._tracks = this._tracks.filter((item) => item !== track);
  }
}

describe("participantVideoPip", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelectorAll("video").forEach((node) => node.remove());
  });

  beforeEach(() => {
    vi.stubGlobal("MediaStream", FakeMediaStream);
    HTMLCanvasElement.prototype.captureStream = function captureStream() {
      return new FakeMediaStream([{
        id: "avatar",
        kind: "video",
        readyState: "live",
        stop: vi.fn(),
        getSettings: () => ({}),
      }]);
    };
  });

  it("does not throw when Picture-in-Picture is missing", async () => {
    vi.stubGlobal("document", {
      ...document,
      pictureInPictureEnabled: false,
      pictureInPictureElement: null,
    });
    expect(videoPipAvailable()).toBe(false);
    const controller = createParticipantPipController();
    const result = await controller.requestPip({ iframe: null });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported");
    controller.dispose();
  });

  it("opens PiP with the existing remote track and does not stop it", async () => {
    const stop = vi.fn();
    const track = {
      id: "remote-cam",
      kind: "video",
      readyState: "live",
      label: "camera",
      stop,
      getSettings: () => ({ facingMode: "user" }),
    };
    const requestPictureInPicture = vi.fn(async function requestPictureInPicture() {
      document.pictureInPictureElement = this;
    });
    HTMLVideoElement.prototype.requestPictureInPicture = requestPictureInPicture;
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      writable: true,
      value: null,
    });
    document.exitPictureInPicture = vi.fn(async () => {
      document.pictureInPictureElement = null;
    });

    const iframe = {
      contentDocument: {
        querySelectorAll: () => [fakeRemoteVideo(track)],
      },
    };
    const states = [];
    const controller = createParticipantPipController({
      onState: (snap) => states.push(snap),
    });
    const result = await controller.requestPip({
      iframe,
      participant: { id: "student", displayName: "Дарья", videoMuted: false },
      localId: "teacher",
      userGesture: true,
    });
    expect(result.ok).toBe(true);
    expect(requestPictureInPicture).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(states.some((snap) => snap.active)).toBe(true);

    controller.dispose();
    expect(stop).not.toHaveBeenCalled();
    expect(document.body.querySelectorAll("video").length).toBe(0);
  });

  it("does not create a second presentation video across share cycles", async () => {
    HTMLVideoElement.prototype.requestPictureInPicture = vi.fn(async () => {});
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      writable: true,
      value: null,
    });
    document.exitPictureInPicture = vi.fn(async () => {});

    const controller = createParticipantPipController();
    const context = {
      iframe: { contentDocument: { querySelectorAll: () => [] } },
      participant: { id: "student", displayName: "Дарья", videoMuted: true },
      localId: "teacher",
    };
    await controller.onScreenShareChanged(true, context);
    await controller.onScreenShareChanged(false, context);
    await controller.onScreenShareChanged(true, context);
    expect(document.body.querySelectorAll("video").length).toBe(1);
    controller.dispose();
    expect(document.body.querySelectorAll("video").length).toBe(0);
  });

  it("keeps a user-opened PiP after screen share stops", async () => {
    const exitPictureInPicture = vi.fn(async () => {});
    document.exitPictureInPicture = exitPictureInPicture;
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      writable: true,
      value: null,
    });
    HTMLVideoElement.prototype.requestPictureInPicture = vi.fn(async function requestPictureInPicture() {
      document.pictureInPictureElement = this;
    });
    const controller = createParticipantPipController();
    const context = {
      iframe: { contentDocument: { querySelectorAll: () => [] } },
      participant: { id: "student", displayName: "Дарья", videoMuted: true },
    };
    await controller.toggle(context);
    exitPictureInPicture.mockClear();
    await controller.onScreenShareChanged(true, context);
    await controller.onScreenShareChanged(false, context);
    expect(exitPictureInPicture).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("posts a PiP request into the Jitsi iframe without creating a new conference", () => {
    const postMessage = vi.fn();
    const iframe = {
      src: "https://lesson.example.test/room",
      contentWindow: { postMessage },
    };
    expect(requestIframeParticipantPip(iframe, { action: "request", participantId: "student" })).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      type: "itflux:participant-pip",
      action: "request",
      participantId: "student",
    });
  });
});
