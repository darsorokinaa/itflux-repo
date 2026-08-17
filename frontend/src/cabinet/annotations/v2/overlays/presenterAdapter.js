export const OVERLAY_MODES = Object.freeze({
  PLATFORM_TAB_OVERLAY: "PLATFORM_TAB_OVERLAY",
  DOCUMENT_PIP_OVERLAY: "DOCUMENT_PIP_OVERLAY",
  FALLBACK_WEB: "FALLBACK_WEB",
  NATIVE_DESKTOP_OVERLAY: "NATIVE_DESKTOP_OVERLAY",
});

export function isBrowserTabSurface(displaySurface) {
  const value = String(displaySurface || "").toLowerCase();
  return value === "browser" || value === "tab" || value === "application-tab";
}

export function documentPipAvailable() {
  return typeof window !== "undefined"
    && Boolean(window.documentPictureInPicture)
    && typeof window.documentPictureInPicture.requestWindow === "function";
}

export function nativeDesktopOverlayAvailable() {
  return typeof window !== "undefined" && Boolean(window.__ITFLUX_NATIVE_ANNOTATION_OVERLAY);
}

/**
 * Overlay adapters are independent of AnnotationEngine / coordinate space.
 * Native desktop overlay is a stub until a helper exists.
 */
export function resolvePresenterOverlayPlan({
  localSharing = false,
  displaySurface = "",
} = {}) {
  const native = nativeDesktopOverlayAvailable();
  const pip = documentPipAvailable();
  const platformTab = Boolean(localSharing && isBrowserTabSurface(displaySurface));
  return {
    mode: native
      ? OVERLAY_MODES.NATIVE_DESKTOP_OVERLAY
      : (pip ? OVERLAY_MODES.DOCUMENT_PIP_OVERLAY : OVERLAY_MODES.FALLBACK_WEB),
    drawingSurface: platformTab
      ? OVERLAY_MODES.PLATFORM_TAB_OVERLAY
      : OVERLAY_MODES.FALLBACK_WEB,
    toolbar: native
      ? OVERLAY_MODES.NATIVE_DESKTOP_OVERLAY
      : (pip ? OVERLAY_MODES.DOCUMENT_PIP_OVERLAY : OVERLAY_MODES.FALLBACK_WEB),
    nativeAvailable: native,
    pipAvailable: pip,
    platformTab,
    fallback: !native,
  };
}
