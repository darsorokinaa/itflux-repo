/**
 * Scene ↔ client coordinates. Same formula as Excalidraw
 * viewportCoordsToSceneCoords / sceneCoordsToViewportCoords.
 *
 * Always use appState.offsetLeft/offsetTop + zoom + scroll — never a
 * getBoundingClientRect taken on a different element, and never screen px.
 */

export function boardZoomValue(appState: Record<string, unknown> | null | undefined): number {
  const z = appState?.zoom;
  if (typeof z === "number" && z > 0) return z;
  if (z && typeof z === "object" && typeof (z as { value?: number }).value === "number") {
    return (z as { value: number }).value || 1;
  }
  return 1;
}

export function boardSceneCoordsFromClient(
  clientX: number,
  clientY: number,
  appState: Record<string, unknown> | null | undefined,
): { x: number; y: number } {
  const zoom = boardZoomValue(appState);
  const offsetLeft = Number(appState?.offsetLeft) || 0;
  const offsetTop = Number(appState?.offsetTop) || 0;
  const scrollX = Number(appState?.scrollX) || 0;
  const scrollY = Number(appState?.scrollY) || 0;
  return {
    x: (clientX - offsetLeft) / zoom - scrollX,
    y: (clientY - offsetTop) / zoom - scrollY,
  };
}

export function boardClientCoordsFromScene(
  sceneX: number,
  sceneY: number,
  appState: Record<string, unknown> | null | undefined,
): { clientX: number; clientY: number } {
  const zoom = boardZoomValue(appState);
  const offsetLeft = Number(appState?.offsetLeft) || 0;
  const offsetTop = Number(appState?.offsetTop) || 0;
  const scrollX = Number(appState?.scrollX) || 0;
  const scrollY = Number(appState?.scrollY) || 0;
  return {
    clientX: (sceneX + scrollX) * zoom + offsetLeft,
    clientY: (sceneY + scrollY) * zoom + offsetTop,
  };
}
