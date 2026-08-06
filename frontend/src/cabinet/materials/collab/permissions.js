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
  collaborationPermission = COLLAB_PERMISSIONS.ANSWERS_ONLY,
  followingTeacher = true,
  localBrowsingAway = false,
}) {
  if (!action) return false;
  if (canManage) {
    if (isNavigationAction(action) && !isController) return false;
    return true;
  }

  const collab = interactionMode === "collaborative";
  if (isFollowContentAction(action)) return true;

  if (collab) {
    if (collaborationPermission === COLLAB_PERMISSIONS.FULL) return true;
    if (collaborationPermission === COLLAB_PERMISSIONS.EDIT_CONTENT) {
      return !isDrawAction(action) || isFollowContentAction(action) || action === "cell_updated"
        || action === "sheet_changed" || action === "selection_changed" || isNavigationAction(action);
    }
    if (collaborationPermission === COLLAB_PERMISSIONS.ANNOTATE) {
      return isDrawAction(action) || action === "cursor" || action === "pointer" || isNavigationAction(action);
    }
    // answers_only
    return isFollowContentAction(action) || action === "cursor" || action === "pointer";
  }

  // Follow mode: temporary local browse may change local page, but we do NOT send nav to server.
  if (localBrowsingAway || !followingTeacher) {
    return false;
  }
  return false;
}

export function shouldBreakFollowOnLocalNav({ canManage, interactionMode, followingTeacher }) {
  if (canManage) return false;
  if (interactionMode === "collaborative") return false;
  return followingTeacher;
}

export { FOLLOW_MODE_CONTENT_ACTIONS, NAVIGATION_ACTIONS, isDrawAction, isFollowContentAction, isNavigationAction };
