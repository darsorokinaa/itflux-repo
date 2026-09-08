/** Classify Jitsi desktop-stream <video> surfaces. Thumbnail is never exact. */

export const SHARE_SURFACE_KIND = Object.freeze({
  STAGE: "stage",
  FILMSTRIP: "filmstrip",
  LOCAL_PREVIEW: "local-preview",
  UNKNOWN: "unknown",
});

function blobOf(candidate) {
  const ancestors = [
    ...(candidate.ancestorIds || []),
    ...(candidate.ancestorClasses || []),
  ].join(" ");
  return `${candidate.id || ""} ${candidate.className || ""} ${ancestors}`.toLowerCase();
}

export function shareSurfaceArea(rect) {
  const width = Math.max(0, Number(rect?.width) || 0);
  const height = Math.max(0, Number(rect?.height) || 0);
  return width * height;
}

export function isShareSurfaceVisible(candidate) {
  if (!candidate || candidate.visible === false) return false;
  if (candidate.streamMatch === false) return false;
  return shareSurfaceArea(candidate.rect) > 0;
}

/**
 * Semantic classification from live Jitsi DOM (ids/ancestors), not magic px.
 * Confirmed local-sharer thumbnail: #localScreenshare_container.
 */
export function classifyShareSurfaceKind(candidate, { tileView = false } = {}) {
  const blob = blobOf(candidate);
  const id = String(candidate.id || "").toLowerCase();

  if (/localscreenshare|local-screenshare|local_screenshare/.test(blob) || id === "localscreenshare_container") {
    return SHARE_SURFACE_KIND.LOCAL_PREVIEW;
  }
  if (/localpreview|local-preview|local_preview/.test(blob)) {
    return SHARE_SURFACE_KIND.LOCAL_PREVIEW;
  }

  if (/largevideo|large-video|large_video/.test(blob) || id === "largevideo") {
    return SHARE_SURFACE_KIND.STAGE;
  }

  if (!tileView && (/filmstrip|thumbnail|remotevideos|filmstrip__/.test(blob))) {
    return SHARE_SURFACE_KIND.FILMSTRIP;
  }

  return SHARE_SURFACE_KIND.UNKNOWN;
}

function withKind(candidate, tileView) {
  return {
    ...candidate,
    surfaceKind: classifyShareSurfaceKind(candidate, { tileView }),
    area: shareSurfaceArea(candidate.rect),
  };
}

function pickLargest(list) {
  if (!list.length) return null;
  return list.reduce((best, item) => (item.area > best.area ? item : best));
}

/**
 * Among videos that already display the desktop MediaStream, pick the stage.
 * Never fall back to filmstrip / local preview.
 */
export function selectDesktopStageSurface(candidates = [], { tileView = false } = {}) {
  const classified = (Array.isArray(candidates) ? candidates : [])
    .filter(isShareSurfaceVisible)
    .map((candidate) => withKind(candidate, tileView));

  const previews = classified.filter((item) => (
    item.surfaceKind === SHARE_SURFACE_KIND.FILMSTRIP
    || item.surfaceKind === SHARE_SURFACE_KIND.LOCAL_PREVIEW
  ));
  const stages = classified.filter((item) => item.surfaceKind === SHARE_SURFACE_KIND.STAGE);
  const unknown = classified.filter((item) => item.surfaceKind === SHARE_SURFACE_KIND.UNKNOWN);

  let selected = pickLargest(stages);
  if (!selected && !tileView) {
    selected = pickLargest(unknown);
    if (selected) selected = { ...selected, surfaceKind: SHARE_SURFACE_KIND.STAGE };
  }
  if (!selected && tileView) {
    const usable = classified.filter((item) => item.surfaceKind !== SHARE_SURFACE_KIND.LOCAL_PREVIEW);
    selected = pickLargest(usable);
    if (selected) selected = { ...selected, surfaceKind: SHARE_SURFACE_KIND.STAGE };
  }

  if (!selected) {
    return {
      surface: null,
      stageSurfaceFound: false,
      surfaceKind: previews.length ? previews[0].surfaceKind : SHARE_SURFACE_KIND.UNKNOWN,
      surfaceCandidateCount: classified.length,
      classified,
    };
  }

  return {
    surface: selected,
    stageSurfaceFound: true,
    surfaceKind: SHARE_SURFACE_KIND.STAGE,
    surfaceCandidateCount: classified.length,
    classified,
  };
}

export function isJitsiTileView(reduxState) {
  const layout = reduxState?.["features/video-layout"] || {};
  return Boolean(layout.tileViewEnabled || layout.tileView);
}
