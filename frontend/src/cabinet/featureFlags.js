/**
 * Временные флаги функций кабинета.
 * PAYMENTS_ENABLED = false — раздел оплат скрыт/заблокирован для всех.
 */
export const PAYMENTS_ENABLED = true;

/**
 * Screen-share annotation overlay in the video lesson.
 * false — hidden from the UI; engine/protocol stay in the codebase.
 */
export const SCREEN_SHARE_ANNOTATIONS_VISIBLE = false;

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

/**
 * Синхронизированная презентация материалов в комнате урока.
 * Продуктовая модель снята: материал открывается локально,
 * показ другим участникам — через демонстрацию экрана Jitsi.
 * Override: ?materialCollab=1 или localStorage itflux.materialCollab=1
 */
const MATERIAL_COLLAB_DEFAULT = false;

function readMaterialCollabOverride() {
  try {
    const query = new URLSearchParams(window.location.search).get("materialCollab");
    if (query === "0" || query === "false") return false;
    if (query === "1" || query === "true") return true;
  } catch {
    /* ignore */
  }
  try {
    const stored = window.localStorage.getItem("itflux.materialCollab");
    if (stored === "0" || stored === "false") return false;
    if (stored === "1" || stored === "true") return true;
  } catch {
    /* ignore */
  }
  return MATERIAL_COLLAB_DEFAULT;
}

export const MATERIAL_COLLABORATION_ENABLED = typeof window === "undefined"
  ? MATERIAL_COLLAB_DEFAULT
  : readMaterialCollabOverride();
