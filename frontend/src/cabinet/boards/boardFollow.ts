/** Follow / go-to rules and smoothing for board viewports. */

import type { TeacherViewport } from "./boardViewport";

/** Time constant for chasing the followed viewport. Not a one-shot tween. */
export const FOLLOW_SMOOTH_MS = 180;
export const FOLLOW_SNAP_SCENE_PX = 900;
export const FOLLOW_SNAP_ZOOM_RATIO = 0.35;
export const FOLLOW_SETTLE_SCENE_PX = 0.6;
export const FOLLOW_SETTLE_ZOOM_RATIO = 0.0015;

export function isTeacherRole(role?: string | null): boolean {
  const r = String(role || "").toLowerCase();
  return r === "teacher" || r === "owner";
}

export function isStudentRole(role?: string | null): boolean {
  const r = String(role || "").toLowerCase();
  return r === "student";
}

/** Viewport follow is not an edit permission: any remote participant can be followed. */
export function canFollowPeer(_selfRole?: string | null, _targetRole?: string | null): boolean {
  return true;
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

export function followCatchupT(dtMs: number, smoothMs = FOLLOW_SMOOTH_MS): number {
  const tau = Math.max(1, smoothMs);
  return 1 - Math.exp(-Math.max(0, dtMs) / tau);
}

/** Smoothly chase a moving follow target from the last painted pose. */
export function chaseViewportCenters(
  from: { centerX: number; centerY: number; zoom: number },
  to: { centerX: number; centerY: number; zoom: number },
  dtMs: number,
  smoothMs = FOLLOW_SMOOTH_MS,
): { centerX: number; centerY: number; zoom: number } {
  const k = followCatchupT(dtMs, smoothMs);
  return {
    centerX: lerp(from.centerX, to.centerX, k),
    centerY: lerp(from.centerY, to.centerY, k),
    zoom: lerp(from.zoom, to.zoom, k),
  };
}

export function isFollowPoseSettled(
  from: { centerX: number; centerY: number; zoom: number },
  to: { centerX: number; centerY: number; zoom: number },
  scenePx = FOLLOW_SETTLE_SCENE_PX,
  zoomRatio = FOLLOW_SETTLE_ZOOM_RATIO,
): boolean {
  const dist = Math.hypot(from.centerX - to.centerX, from.centerY - to.centerY);
  const zoomJump = Math.abs(from.zoom - to.zoom) / Math.max(to.zoom, 0.01);
  return dist <= scenePx && zoomJump <= zoomRatio;
}
