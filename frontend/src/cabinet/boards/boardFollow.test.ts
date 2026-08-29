import { describe, expect, it } from "vitest";
import {
  canFollowPeer,
  canGoToPeer,
  lerpViewportCenters,
  shouldSnapFollow,
} from "./boardFollow";
import {
  normalizeViewportPayload,
  sceneCenterFromAppState,
  scrollForSceneCenter,
  viewportAppStatePatch,
  viewportDriftTooFar,
} from "./boardViewport";

describe("board follow permissions", () => {
  it("student may follow teacher, not another student", () => {
    expect(canFollowPeer("student", "teacher")).toBe(true);
    expect(canFollowPeer("student", "student")).toBe(false);
    expect(canGoToPeer("student", "teacher")).toBe(true);
  });

  it("teacher may follow student, not another teacher", () => {
    expect(canFollowPeer("teacher", "student")).toBe(true);
    expect(canFollowPeer("owner", "student")).toBe(true);
    expect(canFollowPeer("teacher", "teacher")).toBe(false);
  });
});

describe("LESSON_BOARD_FOLLOW_CENTER", () => {
  it("puts the remote scene center at the receiver screen center", () => {
    const teacher = normalizeViewportPayload(
      { scrollX: 0, scrollY: 0, zoom: 1, width: 1920, height: 1080, seq: 1, centerX: 960, centerY: 540 },
      "teacher-1",
      1,
      "teacher",
    )!;
    expect(teacher.centerX).toBe(960);
    expect(teacher.centerY).toBe(540);

    const phone = viewportAppStatePatch(teacher, { width: 390, height: 700 });
    const phoneCenter = sceneCenterFromAppState({
      ...phone,
      width: 390,
      height: 700,
    });
    expect(phoneCenter.centerX).toBeCloseTo(960, 5);
    expect(phoneCenter.centerY).toBeCloseTo(540, 5);
    expect(phone.scrollX).not.toBe(teacher.scrollX);
    expect(phone.scrollY).not.toBe(teacher.scrollY);
  });

  it("does not copy desktop scroll onto a phone", () => {
    const farRight = normalizeViewportPayload(
      {
        scrollX: -4000,
        scrollY: 0,
        zoom: 1,
        width: 1920,
        height: 1080,
        seq: 2,
      },
      "t",
    )!;
    const ipad = viewportAppStatePatch(farRight, { width: 1024, height: 768 });
    const seen = sceneCenterFromAppState({ ...ipad, width: 1024, height: 768 });
    expect(seen.centerX).toBeCloseTo(farRight.centerX, 5);
    expect(seen.centerY).toBeCloseTo(farRight.centerY, 5);
  });

  it("legacy payload without center uses sender width", () => {
    const vp = normalizeViewportPayload(
      { scrollX: 100, scrollY: 40, zoom: 2, width: 800, height: 400, seq: 1 },
      "t",
    )!;
    expect(vp.centerX).toBeCloseTo(-100 + 800 / 4, 5);
    expect(vp.centerY).toBeCloseTo(-40 + 400 / 4, 5);
  });

  it("manual pan past threshold stops follow; tiny jitter does not", () => {
    const target = normalizeViewportPayload(
      { scrollX: 0, scrollY: 0, zoom: 1, width: 400, height: 300, seq: 1, centerX: 200, centerY: 150 },
      "t",
    )!;
    const still = {
      scrollX: scrollForSceneCenter(200, 1, 400),
      scrollY: scrollForSceneCenter(150, 1, 300),
      zoom: 1,
      width: 400,
      height: 300,
    };
    expect(viewportDriftTooFar(still, target)).toBe(false);
    expect(viewportDriftTooFar({ ...still, scrollX: still.scrollX - 20 }, target)).toBe(false);
    expect(viewportDriftTooFar({ ...still, scrollX: still.scrollX - 200 }, target)).toBe(true);
  });

  it("large jumps snap, small ones interpolate", () => {
    const a = normalizeViewportPayload(
      { scrollX: 0, scrollY: 0, zoom: 1, width: 400, height: 300, seq: 1, centerX: 0, centerY: 0 },
      "t",
    )!;
    const near = { ...a, centerX: 40, centerY: 10, seq: 2 };
    const far = { ...a, centerX: 4000, centerY: 0, seq: 3 };
    expect(shouldSnapFollow(a, near)).toBe(false);
    expect(shouldSnapFollow(a, far)).toBe(true);
    const mid = lerpViewportCenters(a, near, 0.5);
    expect(mid.centerX).toBeGreaterThan(0);
    expect(mid.centerX).toBeLessThan(40);
  });
});
