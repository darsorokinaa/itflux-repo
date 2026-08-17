/**
 * Временные флаги функций кабинета.
 * PAYMENTS_ENABLED = false — раздел оплат скрыт/заблокирован для всех.
 */
export const PAYMENTS_ENABLED = true;

/**
 * Screen-share annotations V2: captured-surface coordinates, canvas renderer,
 * Document Picture-in-Picture toolbar. V1 остаётся в коде.
 * Override: ?ssAnn=v1|v2 или localStorage itflux.ssAnn=v1|v2
 */
const SS_ANN_DEFAULT_V2 = true;

function readSsAnnOverride() {
  try {
    const query = new URLSearchParams(window.location.search).get("ssAnn");
    if (query === "v1") return false;
    if (query === "v2") return true;
  } catch {
    /* ignore */
  }
  try {
    const stored = window.localStorage.getItem("itflux.ssAnn");
    if (stored === "v1") return false;
    if (stored === "v2") return true;
  } catch {
    /* ignore */
  }
  return SS_ANN_DEFAULT_V2;
}

export const SCREEN_SHARE_ANNOTATIONS_V2 = typeof window === "undefined"
  ? SS_ANN_DEFAULT_V2
  : readSsAnnOverride();
