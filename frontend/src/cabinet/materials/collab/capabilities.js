/** Material capabilities by resource kind. */

export function emptyCapabilities() {
  return {
    pageNavigation: false,
    scrollSync: false,
    zoomSync: false,
    pointerSync: false,
    annotations: false,
    textEditing: false,
    formInputs: false,
    cellEditing: false,
    objectEditing: false,
    mediaSync: false,
  };
}

const BY_KIND = {
  pdf: {
    pageNavigation: true,
    scrollSync: false,
    zoomSync: false,
    pointerSync: true,
    annotations: true,
  },
  presentation: {
    pageNavigation: true,
    scrollSync: false,
    zoomSync: false,
    pointerSync: true,
    annotations: true,
  },
  image: {
    scrollSync: false,
    zoomSync: false,
    pointerSync: true,
    annotations: true,
  },
  interactive: {
    pageNavigation: true,
    scrollSync: true,
    formInputs: true,
    objectEditing: true,
    annotations: true,
  },
  cards: {
    formInputs: true,
    objectEditing: true,
  },
  test: {
    formInputs: true,
    scrollSync: true,
  },
  exercise: {
    formInputs: true,
    objectEditing: true,
    pageNavigation: true,
  },
  workbook: {
    pageNavigation: true,
    scrollSync: true,
    formInputs: true,
    annotations: true,
  },
  text: {
    scrollSync: true,
    formInputs: true,
    annotations: true,
  },
  notes: {
    scrollSync: true,
    formInputs: true,
    annotations: true,
  },
  embed: {
    pageNavigation: true,
    scrollSync: false,
    annotations: true,
    mediaSync: true,
    formInputs: true,
  },
  link: {
    scrollSync: true,
    annotations: true,
  },
  file: {
    pageNavigation: true,
    scrollSync: false,
    zoomSync: false,
    pointerSync: true,
    annotations: true,
  },
  spreadsheet: {
    cellEditing: true,
    formInputs: false,
    annotations: true,
    pointerSync: true,
  },
  board: {
    objectEditing: true,
    pointerSync: true,
  },
};

export function getCapabilitiesForKind(kind) {
  const base = emptyCapabilities();
  const extra = BY_KIND[String(kind || "").toLowerCase()] || {};
  return { ...base, ...extra };
}

/** Default collab permission when teacher enables collaborative mode. */
export function defaultCollabPermissionForKind(kind) {
  const caps = getCapabilitiesForKind(kind);
  if (caps.cellEditing) return "edit_content";
  if (caps.formInputs && !caps.annotations) return "answers_only";
  if (caps.annotations) return "annotate";
  return "answers_only";
}
