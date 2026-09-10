/** Three material-session modes. Mapped onto existing interactionMode + followPolicy. */

export const PRESENTATION_MODES = Object.freeze({
  INDEPENDENT: "independent",
  PRESENTATION: "presentation",
  COLLABORATION: "collaboration",
});

export const SHARED_BUCKET = "shared";

export function derivePresentationMode({ interactionMode, followPolicy } = {}) {
  if (String(interactionMode || "") === "collaborative") return PRESENTATION_MODES.COLLABORATION;
  if (String(followPolicy || "") === "independent") return PRESENTATION_MODES.INDEPENDENT;
  return PRESENTATION_MODES.PRESENTATION;
}

export function modeToSessionFields(mode) {
  const value = String(mode || PRESENTATION_MODES.PRESENTATION).toLowerCase();
  if (value === PRESENTATION_MODES.COLLABORATION) {
    return { interactionMode: "collaborative", followPolicy: "strict" };
  }
  if (value === PRESENTATION_MODES.INDEPENDENT) {
    return { interactionMode: "view_only", followPolicy: "independent" };
  }
  return { interactionMode: "view_only", followPolicy: "strict" };
}

export function isFollowNavigationMode(mode) {
  return mode === PRESENTATION_MODES.PRESENTATION || mode === PRESENTATION_MODES.COLLABORATION;
}

export function studentsCanInteractInMode(mode, studentsCanInteract = true) {
  return mode === PRESENTATION_MODES.COLLABORATION && studentsCanInteract !== false;
}

/** Flatten answers/fields for the material DOM. Presentation/collab use the shared bucket. */
export function flattenContentBucket(bucket, { currentUserId, canManage, presentationMode } = {}) {
  if (!bucket || typeof bucket !== "object") return {};
  const values = Object.values(bucket);
  const looksPerUser = values.some((v) => {
    if (!v || typeof v !== "object" || "value" in v) return false;
    return Object.values(v).some((row) => row && typeof row === "object" && ("value" in row || "author_id" in row));
  });
  if (!looksPerUser) return bucket;

  const follow = isFollowNavigationMode(presentationMode);
  if (follow && bucket[SHARED_BUCKET] && typeof bucket[SHARED_BUCKET] === "object") {
    return bucket[SHARED_BUCKET];
  }
  if (canManage) {
    const flat = { ...(bucket[SHARED_BUCKET] && typeof bucket[SHARED_BUCKET] === "object" ? bucket[SHARED_BUCKET] : {}) };
    for (const [key, userBucket] of Object.entries(bucket)) {
      if (key === SHARED_BUCKET || !userBucket || typeof userBucket !== "object") continue;
      for (const [itemId, row] of Object.entries(userBucket)) {
        if (row && typeof row === "object" && !flat[itemId]) flat[itemId] = row;
      }
    }
    return flat;
  }
  const key = currentUserId != null ? String(currentUserId) : "";
  const mine = (key && bucket[key]) || {};
  return mine && typeof mine === "object" ? mine : {};
}
