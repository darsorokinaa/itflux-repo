import { COLLAB_PERMISSIONS, FOLLOW_MODE_CONTENT_ACTIONS, NAVIGATION_ACTIONS } from "./constants";
import { isDrawAction, isFollowContentAction, isNavigationAction } from "./applyMaterialOperation";

/**
 * Decide if the local user may send an action over the wire.
 * Local temporary unfollow allows navigation without claiming server independent mode.
 */
export function canSendMaterialAction({
  action,
  canManage,
  isController = true,
  interactionMode = "view_only",
  followPolicy = "strict",
  presentationMode = null,
  collaborationPermission = COLLAB_PERMISSIONS.ANSWERS_ONLY,
  followingTeacher = true,
  localBrowsingAway = false,
}) {
  if (!action) return false;
  const mode = presentationMode || (interactionMode === "collaborative"
    ? "collaboration"
    : (followPolicy === "independent" ? "independent" : "presentation"));
  if (canManage) {
    if (isNavigationAction(action) && !isController) return false;
    return true;
  }

  if (isNavigationAction(action)) return false;

  if (mode === "collaboration") {
    if (collaborationPermission === COLLAB_PERMISSIONS.FULL) return !isNavigationAction(action);
    if (collaborationPermission === COLLAB_PERMISSIONS.EDIT_CONTENT) {
      return isFollowContentAction(action) || action === "cell_updated"
        || action === "sheet_changed" || action === "selection_changed";
    }
    if (collaborationPermission === COLLAB_PERMISSIONS.ANNOTATE) {
      return isDrawAction(action) || action === "cursor" || action === "pointer" || isFollowContentAction(action);
    }
    return isFollowContentAction(action) || action === "cursor" || action === "pointer";
  }

  if (mode === "independent" || localBrowsingAway || !followingTeacher) {
    return isFollowContentAction(action);
  }

  // presentation: ученик не меняет общее состояние
  return false;
}

export function shouldBreakFollowOnLocalNav({ canManage, interactionMode, followingTeacher }) {
  if (canManage) return false;
  if (interactionMode === "collaborative") return false;
  return followingTeacher;
}

export { FOLLOW_MODE_CONTENT_ACTIONS, NAVIGATION_ACTIONS, isDrawAction, isFollowContentAction, isNavigationAction };
