/** Follow / go-to rules and smoothing for board viewports. */

import type { TeacherViewport } from "./boardViewport";

export const FOLLOW_SMOOTH_MS = 120;
export const FOLLOW_SNAP_SCENE_PX = 900;
export const FOLLOW_SNAP_ZOOM_RATIO = 0.35;

export function isTeacherRole(role?: string | null): boolean {
  const r = String(role || "").toLowerCase();
  return r === "teacher" || r === "owner";
}

export function isStudentRole(role?: string | null): boolean {
  const r = String(role || "").toLowerCase();
  return r === "student";
}

/** Teacher → any student. Student → teacher only. */
export function canFollowPeer(selfRole?: string | null, targetRole?: string | null): boolean {
  if (isTeacherRole(selfRole)) return isStudentRole(targetRole);
  return isTeacherRole(targetRole);
}

export function canGoToPeer(selfRole?: string | null, targetRole?: string | null): boolean {
  return canFollowPeer(selfRole, targetRole);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeOutQuad(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) * (1 - x);
}

export function shouldSnapFollow(prev: TeacherViewport | null, next: TeacherViewport): boolean {
  if (!prev) return true;
  const dx = next.centerX - prev.centerX;
  const dy = next.centerY - prev.centerY;
  const dist = Math.hypot(dx, dy);
  const zoomJump = Math.abs(next.zoom - prev.zoom) / Math.max(prev.zoom, 0.01);
  return dist > FOLLOW_SNAP_SCENE_PX || zoomJump > FOLLOW_SNAP_ZOOM_RATIO;
}

export function lerpViewportCenters(
  from: TeacherViewport,
  to: TeacherViewport,
  t: number,
): { centerX: number; centerY: number; zoom: number } {
  const k = easeOutQuad(t);
  return {
    centerX: lerp(from.centerX, to.centerX, k),
    centerY: lerp(from.centerY, to.centerY, k),
    zoom: lerp(from.zoom, to.zoom, k),
  };
}
