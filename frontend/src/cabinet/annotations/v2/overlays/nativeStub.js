/** Stub: native always-on-top overlay is not in this web app. Engine/protocol stay unchanged. */

export function nativeDesktopOverlayAvailable() {
  return typeof window !== "undefined" && Boolean(window.__ITFLUX_NATIVE_ANNOTATION_OVERLAY);
}

export function createNativeDesktopOverlay() {
  return {
    mode: "NATIVE_DESKTOP_OVERLAY",
    available: nativeDesktopOverlayAvailable(),
    async open() {
      return false;
    },
    close() {},
  };
}
