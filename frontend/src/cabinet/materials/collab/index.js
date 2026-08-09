export { applyMaterialOperation, initialMaterialState, isFollowContentAction, isNavigationAction, isDrawAction } from "./applyMaterialOperation";
export { getCapabilitiesForKind, defaultCollabPermissionForKind, emptyCapabilities } from "./capabilities";
export { canSendMaterialAction, shouldBreakFollowOnLocalNav } from "./permissions";
export { createHtmlLessonBridge, htmlEventToMaterialOp } from "./htmlLessonBridge";
export {
  COORD_SPACE_CONTENT_V1,
  clamp01,
  clientToContentNorm,
  contentNormToClient,
  getContainedMediaRect,
  getMaterialViewportTransform,
  getVisibleContentViewport,
  isContentCoordSpace,
  normWidthToPx,
  pxWidthToNorm,
  resolveStrokeWidthPx,
} from "./materialViewportTransform";
export * from "./constants";
