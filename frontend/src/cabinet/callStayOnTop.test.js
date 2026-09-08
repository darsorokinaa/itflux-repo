import { describe, expect, it, vi, afterEach } from "vitest";

import {
  callStayOnTopAvailable,
  closeCallStayOnTop,
  findSameOriginCallVideo,
  liveCallVideoPipAvailable,
  requestCallStayOnTop,
  videoPipAvailable,
} from "./callStayOnTop";

vi.mock("../utils/clientTelemetry", () => ({
  reportClientEvent: vi.fn(() => true),
}));

describe("callStayOnTop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not throw when Picture-in-Picture is missing", async () => {
    vi.stubGlobal("document", {
      pictureInPictureEnabled: false,
      querySelectorAll: () => [],
    });
    expect(videoPipAvailable()).toBe(false);
    expect(callStayOnTopAvailable()).toBe(false);
    const result = await requestCallStayOnTop({ iframe: null });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("unsupported");
    await expect(closeCallStayOnTop()).resolves.toBeUndefined();
  });

  it("returns null for a cross-origin iframe", () => {
    const iframe = {
      get contentDocument() {
        throw new DOMException("Blocked", "SecurityError");
      },
      get contentWindow() {
        throw new DOMException("Blocked", "SecurityError");
      },
    };
    expect(findSameOriginCallVideo(iframe)).toBeNull();
  });

  it("picks a same-origin video with a live stream", () => {
    const video = {
      srcObject: { getTracks: () => [{}] },
      readyState: 2,
      ended: false,
      videoWidth: 640,
      videoHeight: 360,
    };
    const iframe = {
      contentDocument: {
        querySelectorAll: () => [video],
      },
    };
    expect(findSameOriginCallVideo(iframe)).toBe(video);
  });

  it("opens a document window for the mini call when Document PiP exists", async () => {
    const host = document.createElement("div");
    const parent = document.createElement("div");
    parent.appendChild(host);
    const pipWindow = {
      document: {
        adoptedStyleSheets: [],
        querySelectorAll: () => [],
        head: { appendChild: () => {} },
        body: { className: "", appendChild: vi.fn((node) => node) },
      },
      addEventListener: vi.fn(),
    };
    const requestWindow = vi.fn(async () => pipWindow);
    window.documentPictureInPicture = { requestWindow };
    const result = await requestCallStayOnTop({ host });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("document-pip");
    expect(pipWindow.document.body.appendChild).toHaveBeenCalledWith(host);
    delete window.documentPictureInPicture;
  });

  it("does not open a document window when there is no call video and no host", async () => {
    const requestWindow = vi.fn();
    vi.stubGlobal("document", {
      pictureInPictureEnabled: true,
      pictureInPictureElement: null,
      querySelectorAll: () => [],
    });
    vi.stubGlobal("HTMLVideoElement", function HTMLVideoElement() {});
    HTMLVideoElement.prototype.requestPictureInPicture = vi.fn();
    vi.stubGlobal("window", {
      documentPictureInPicture: { requestWindow },
    });
    const result = await requestCallStayOnTop({ iframe: null });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("no-video");
    expect(requestWindow).not.toHaveBeenCalled();
    expect(liveCallVideoPipAvailable(null)).toBe(false);
  });
});
