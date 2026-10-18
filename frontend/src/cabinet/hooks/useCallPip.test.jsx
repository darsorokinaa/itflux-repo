/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/clientTelemetry", () => ({ reportClientEvent: vi.fn(() => true) }));

import useCallPip from "./useCallPip";

function installDocumentPip() {
  const listeners = {};
  const pipDoc = document.implementation.createHTMLDocument("pip");
  const handlers = {};
  const pipWin = {
    document: pipDoc,
    closed: false,
    close: vi.fn(() => {
      pipWin.closed = true;
      handlers.pagehide?.();
    }),
    addEventListener: vi.fn((name, fn) => { handlers[name] = fn; }),
    removeEventListener: vi.fn(),
  };
  const dpip = {
    window: null,
    requestWindow: vi.fn(async () => {
      dpip.window = pipWin;
      listeners.enter?.({ window: pipWin });
      return pipWin;
    }),
    addEventListener: vi.fn((name, fn) => { listeners[name] = fn; }),
    removeEventListener: vi.fn(),
  };
  window.documentPictureInPicture = dpip;
  return { dpip, pipWin, listeners };
}

function jitsiApi(onShow) {
  return {
    showPiP: vi.fn(() => onShow?.()),
    hidePiP: vi.fn(),
    _teardownIntersectionObserver: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
}

describe("useCallPip", () => {
  let session;
  beforeEach(() => {
    session = { setActionHandler: vi.fn() };
    Object.defineProperty(navigator, "mediaSession", { value: session, configurable: true });
  });
  afterEach(() => {
    delete window.documentPictureInPicture;
    delete navigator.mediaSession;
    vi.restoreAllMocks();
  });

  it("hides the button where nothing is supported (Firefox)", () => {
    const { result } = renderHook(() => useCallPip({ live: true, getJitsiApi: () => null, isLiveKit: () => false }));
    expect(result.current.manualAvailable).toBe(false);
  });

  it("Jitsi: button asks the External API, tab-switch handler is registered and cleared", async () => {
    const { dpip, listeners } = installDocumentPip();
    const api = jitsiApi(() => { void dpip.requestWindow(); });
    const { result, rerender, unmount } = renderHook((props) => useCallPip(props), {
      initialProps: { live: true, getJitsiApi: () => api, isLiveKit: () => false, jitsiEpoch: 1 },
    });
    expect(result.current.manualAvailable).toBe(true);
    expect(session.setActionHandler).toHaveBeenCalledWith("enterpictureinpicture", expect.any(Function));
    await act(async () => {
      await result.current.toggle();
    });
    expect(api.showPiP).toHaveBeenCalledTimes(1);
    expect(listeners.enter).toBeTypeOf("function");
    expect(result.current.active).toBe(true);
    // Повторное нажатие закрывает окно.
    await act(async () => {
      await result.current.toggle();
    });
    expect(api.hidePiP).toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    // Конец звонка: обработчик снимается.
    rerender({ live: false, getJitsiApi: () => api, isLiveKit: () => false, jitsiEpoch: 1 });
    expect(session.setActionHandler).toHaveBeenLastCalledWith("enterpictureinpicture", null);
    unmount();
  });

  it("Jitsi: share start without a fresh gesture does not call showPiP", async () => {
    installDocumentPip();
    Object.defineProperty(navigator, "userActivation", { value: { isActive: false }, configurable: true });
    const api = jitsiApi();
    const { result } = renderHook(() => useCallPip({ live: true, getJitsiApi: () => api, isLiveKit: () => false }));
    let res;
    await act(async () => {
      res = await result.current.onLocalShareStarted();
    });
    expect(res).toMatchObject({ ok: false, reason: "needs-gesture" });
    expect(api.showPiP).not.toHaveBeenCalled();
    delete navigator.userActivation;
  });

  it("Jitsi: window opened for a share closes when the share stops", async () => {
    const { dpip } = installDocumentPip();
    Object.defineProperty(navigator, "userActivation", { value: { isActive: true }, configurable: true });
    const api = jitsiApi(() => { void dpip.requestWindow(); });
    const { result } = renderHook(() => useCallPip({ live: true, getJitsiApi: () => api, isLiveKit: () => false }));
    await act(async () => {
      await result.current.onLocalShareStarted();
    });
    expect(api.showPiP).toHaveBeenCalled();
    act(() => {
      result.current.onLocalShareStopped();
    });
    expect(api.hidePiP).toHaveBeenCalled();
    delete navigator.userActivation;
  });

  it("LiveKit: opens own window with tracks; hangup returns to the tab", async () => {
    const { pipWin } = installDocumentPip();
    const remote = { attach: vi.fn(), detach: vi.fn() };
    const onHangup = vi.fn();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useCallPip({
      live: true,
      getJitsiApi: () => null,
      isLiveKit: () => true,
      getLiveKitMedia: () => ({ remote: { source: remote, name: "Ученик" }, local: { cameraOff: true }, micOn: true, camOn: false }),
      actions: { onHangup },
    }));
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.active).toBe(true);
    expect(remote.attach).toHaveBeenCalled();
    act(() => {
      pipWin.document.querySelector('[data-action="hangup"]').click();
    });
    expect(onHangup).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(pipWin.close).toHaveBeenCalled();
    expect(remote.detach).toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    unmount();
  });

  it("LiveKit without Document PiP falls back to video PiP of the remote tile", async () => {
    const video = { requestPictureInPicture: vi.fn(async () => ({})) };
    Object.defineProperty(document, "pictureInPictureEnabled", { value: true, configurable: true });
    const proto = window.HTMLVideoElement.prototype;
    const had = "requestPictureInPicture" in proto;
    if (!had) proto.requestPictureInPicture = () => {};
    const { result } = renderHook(() => useCallPip({
      live: true,
      isLiveKit: () => true,
      liveKit: true,
      getLiveKitRemoteVideo: () => video,
    }));
    expect(result.current.manualAvailable).toBe(true);
    await act(async () => {
      await result.current.toggle();
    });
    expect(video.requestPictureInPicture).toHaveBeenCalled();
    if (!had) delete proto.requestPictureInPicture;
    delete document.pictureInPictureEnabled;
  });
});

describe("useCallPip legacy fallback", () => {
  it("auto PiP without Document PiP uses the previous path, button does not", async () => {
    const legacy = vi.fn(() => Promise.resolve({ ok: false }));
    const session = { setActionHandler: vi.fn() };
    Object.defineProperty(navigator, "mediaSession", { value: session, configurable: true });
    const api = { showPiP: vi.fn(), addListener: vi.fn() };
    const { result, unmount } = renderHook(() => useCallPip({
      live: true,
      getJitsiApi: () => api,
      isLiveKit: () => false,
      legacyFallback: legacy,
    }));
    const handler = session.setActionHandler.mock.calls.find((c) => c[0] === "enterpictureinpicture")[1];
    await act(async () => {
      handler({});
    });
    expect(legacy).toHaveBeenCalledWith("auto");
    expect(api.showPiP).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.open("button");
    });
    expect(legacy).toHaveBeenCalledTimes(1);
    unmount();
    delete navigator.mediaSession;
  });
});
