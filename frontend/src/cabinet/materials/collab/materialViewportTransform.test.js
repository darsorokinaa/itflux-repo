import { describe, expect, it } from "vitest";
import {
  COORD_SPACE_CONTENT_V1,
  clientToContentNorm,
  contentNormToClient,
  getContainedMediaRect,
  getMaterialViewportTransform,
  getVisibleContentViewport,
  isContentCoordSpace,
  pxWidthToNorm,
  resolveStrokeWidthPx,
} from "./materialViewportTransform";

function fakeRect(left, top, width, height) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() { return this; },
  };
}

describe("getContainedMediaRect", () => {
  it("letterboxes a 16:9 image inside a taller container", () => {
    const box = getContainedMediaRect({ left: 100, top: 50, width: 800, height: 600 }, 1600, 900);
    expect(box.width).toBeCloseTo(800);
    expect(box.height).toBeCloseTo(450);
    expect(box.offsetX).toBeCloseTo(0);
    expect(box.offsetY).toBeCloseTo(75);
    expect(box.left).toBeCloseTo(100);
    expect(box.top).toBeCloseTo(125);
  });

  it("letterboxes a tall image inside a wide container", () => {
    const box = getContainedMediaRect({ left: 0, top: 0, width: 1000, height: 500 }, 400, 800);
    expect(box.width).toBeCloseTo(250);
    expect(box.height).toBeCloseTo(500);
    expect(box.offsetX).toBeCloseTo(375);
    expect(box.offsetY).toBeCloseTo(0);
  });
});

describe("content-space mapping across viewports", () => {
  it("maps the same content point on teacher and student stages", () => {
    // Teacher: wide stage with letterboxed 16:9 media
    const teacherMedia = {
      getBoundingClientRect: () => fakeRect(200, 100, 1200, 800),
      naturalWidth: 1920,
      naturalHeight: 1080,
    };
    const teacherSurface = {
      getBoundingClientRect: () => fakeRect(200, 100, 1200, 800),
    };
    const teacherTx = getMaterialViewportTransform({
      surfaceEl: teacherSurface,
      mediaEl: teacherMedia,
      kind: "image",
      zoom: 1,
    });

    // Student: narrower stage, different letterboxing
    const studentMedia = {
      getBoundingClientRect: () => fakeRect(0, 80, 720, 500),
      naturalWidth: 1920,
      naturalHeight: 1080,
    };
    const studentSurface = {
      getBoundingClientRect: () => fakeRect(0, 80, 720, 500),
    };
    const studentTx = getMaterialViewportTransform({
      surfaceEl: studentSurface,
      mediaEl: studentMedia,
      kind: "image",
      zoom: 1,
    });

    // Teacher clicks near top of the letterboxed image (not stage center).
    const teacherPointClient = {
      x: teacherTx.rect.left + teacherTx.rect.width * 0.25,
      y: teacherTx.rect.top + teacherTx.rect.height * 0.1,
    };
    const norm = clientToContentNorm(teacherPointClient.x, teacherPointClient.y, teacherTx);
    expect(norm.x).toBeCloseTo(0.25);
    expect(norm.y).toBeCloseTo(0.1);

    const studentClient = contentNormToClient(norm.x, norm.y, studentTx);
    expect(studentClient.x).toBeCloseTo(studentTx.rect.left + studentTx.rect.width * 0.25);
    expect(studentClient.y).toBeCloseTo(studentTx.rect.top + studentTx.rect.height * 0.1);

    // Stage-normalized (legacy bug) maps the same client/stage ratios and misses the media box.
    const legacyTeacher = {
      x: (teacherPointClient.x - 200) / 1200,
      y: (teacherPointClient.y - 100) / 800,
    };
    const legacyOnStudent = {
      x: 0 + legacyTeacher.x * 720,
      y: 80 + legacyTeacher.y * 500,
    };
    expect(Math.abs(legacyOnStudent.y - studentClient.y)).toBeGreaterThan(1);
  });

  it("accounts for zoom via getBoundingClientRect of scaled surface", () => {
    // After CSS scale(2), bounding rect is doubled; toNorm still yields 0..1 of content.
    const surface = {
      getBoundingClientRect: () => fakeRect(50, 50, 800, 600),
    };
    const tx = getMaterialViewportTransform({ surfaceEl: surface, kind: "pdf", zoom: 2 });
    const p = clientToContentNorm(50 + 400, 50 + 300, tx);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.5);
  });
});

describe("getVisibleContentViewport", () => {
  it("returns full surface when stage fully covers it", () => {
    const stage = { getBoundingClientRect: () => fakeRect(0, 0, 1000, 800) };
    const surface = { getBoundingClientRect: () => fakeRect(100, 100, 800, 600) };
    const vp = getVisibleContentViewport(stage, surface);
    expect(vp.left).toBeCloseTo(0);
    expect(vp.top).toBeCloseTo(0);
    expect(vp.width).toBeCloseTo(1);
    expect(vp.height).toBeCloseTo(1);
  });

  it("returns partial viewport when stage clips surface", () => {
    const stage = { getBoundingClientRect: () => fakeRect(0, 0, 400, 300) };
    const surface = { getBoundingClientRect: () => fakeRect(0, 0, 800, 600) };
    const vp = getVisibleContentViewport(stage, surface);
    expect(vp.left).toBeCloseTo(0);
    expect(vp.top).toBeCloseTo(0);
    expect(vp.width).toBeCloseTo(0.5);
    expect(vp.height).toBeCloseTo(0.5);
  });
});

describe("stroke width", () => {
  it("normalizes and resolves content-space width", () => {
    const norm = pxWidthToNorm(3, 1000);
    expect(norm).toBeCloseTo(0.003);
    expect(resolveStrokeWidthPx({ coordSpace: COORD_SPACE_CONTENT_V1, width: norm }, 500))
      .toBeCloseTo(1.5); // minPx floor
    expect(resolveStrokeWidthPx({ coordSpace: COORD_SPACE_CONTENT_V1, width: 0.01 }, 800))
      .toBeCloseTo(8);
  });

  it("keeps legacy pixel widths", () => {
    expect(isContentCoordSpace({ width: 3 })).toBe(false);
    expect(resolveStrokeWidthPx({ width: 5 }, 400)).toBe(5);
  });
});
