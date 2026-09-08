import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";

import { GEOMETRY_STATUS } from "./jitsiGeometry";
import { useJitsiShareGeometry } from "./useJitsiShareGeometry";

afterEach(() => {
  cleanup();
});

function dispatchGeometry(iframe, data, origin = "https://lesson.itflux-academy.ru") {
  window.dispatchEvent(new MessageEvent("message", {
    data,
    origin,
    source: iframe.contentWindow,
  }));
}

describe("useJitsiShareGeometry camera vs desktop", () => {
  it("does not enter exact for a camera largeVideo with metadata", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const { result } = renderHook(() => useJitsiShareGeometry({
      enabled: true,
      iframe,
      jitsiOrigin: "https://lesson.itflux-academy.ru",
      shareSessionId: "sess-a",
      presenterJitsiId: "sharer-a",
    }));
    act(() => {
      dispatchGeometry(iframe, {
        type: "itflux:screenshare-geometry",
        source: "itflux-jitsi",
        present: true,
        isDesktopTrack: false,
        desktopTrackDetected: false,
        participantId: "sharer-a",
        shareSessionId: "sess-a",
        videoWidth: 1920,
        videoHeight: 1080,
        contentRect: { left: 0, top: 0, width: 1280, height: 720 },
        iframeViewportWidth: 1280,
        iframeViewportHeight: 720,
      });
    });
    expect(result.current.status).not.toBe(GEOMETRY_STATUS.EXACT);
    expect(result.current.contentRect).toBeNull();
  });

  it("enters exact only for a desktop track and revokes it on stop", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const { result } = renderHook(() => useJitsiShareGeometry({
      enabled: true,
      iframe,
      jitsiOrigin: "https://lesson.itflux-academy.ru",
      shareSessionId: "sess-a",
      presenterJitsiId: "sharer-a",
    }));
    const desktop = {
      type: "itflux:screenshare-geometry",
      source: "itflux-jitsi",
      present: true,
      isDesktopTrack: true,
      desktopTrackDetected: true,
      stageSurfaceFound: true,
      surfaceKind: "stage",
      participantId: "sharer-a",
      shareSessionId: "sess-a",
      videoWidth: 1920,
      videoHeight: 1080,
      videoElementRect: { left: 0, top: 0, width: 872, height: 490 },
      contentRect: { left: 0, top: 0, width: 872, height: 490 },
      iframeViewportWidth: 872,
      iframeViewportHeight: 490,
    };
    act(() => {
      dispatchGeometry(iframe, desktop);
    });
    expect(result.current.status).toBe(GEOMETRY_STATUS.EXACT);
    expect(result.current.videoWidth).toBe(1920);
    act(() => {
      dispatchGeometry(iframe, {
        ...desktop,
        present: false,
        isDesktopTrack: false,
        desktopTrackDetected: false,
        videoWidth: 1280,
        videoHeight: 720,
      });
    });
    expect(result.current.status).toBe(GEOMETRY_STATUS.WAITING);
    expect(result.current.contentRect).toBeNull();
  });
});
