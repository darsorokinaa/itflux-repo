import { describe, expect, it } from "vitest";

import {
  computeContentRect,
  dimensionsChanged,
  normalizedToClient,
  pointerToNormalized,
} from "./coordinateMapper";

const POINTS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [0.25, 0.75],
  [0.5, 0.5],
];

function pair(source, container) {
  const content = computeContentRect({
    container: { left: 0, top: 0, width: container.w, height: container.h },
    sourceWidth: source.w,
    sourceHeight: source.h,
  });
  return { content, source, container };
}

function expectRoundTrip(content, nx, ny) {
  const client = normalizedToClient(nx, ny, content);
  expect(client).toBeTruthy();
  const back = pointerToNormalized(client.x, client.y, content);
  expect(back.x).toBeCloseTo(nx, 6);
  expect(back.y).toBeCloseTo(ny, 6);
}

describe("captured-surface coordinate mapper", () => {
  const cases = [
    { name: "1920×1080 → 1920×1080", source: { w: 1920, h: 1080 }, container: { w: 1920, h: 1080 } },
    { name: "1920×1080 → 1000×800", source: { w: 1920, h: 1080 }, container: { w: 1000, h: 800 } },
    { name: "1920×1080 → mobile portrait", source: { w: 1920, h: 1080 }, container: { w: 390, h: 844 } },
    { name: "1366×768 → 2560×1440", source: { w: 1366, h: 768 }, container: { w: 2560, h: 1440 } },
    { name: "4K → 1366×768", source: { w: 3840, h: 2160 }, container: { w: 1366, h: 768 } },
    { name: "21:9 → 16:9", source: { w: 2560, h: 1080 }, container: { w: 1920, h: 1080 } },
    { name: "16:9 → 21:9", source: { w: 1920, h: 1080 }, container: { w: 2560, h: 1080 } },
    { name: "portrait → landscape", source: { w: 1080, h: 1920 }, container: { w: 1920, h: 1080 } },
    { name: "landscape → portrait", source: { w: 1920, h: 1080 }, container: { w: 1080, h: 1920 } },
  ];

  for (const item of cases) {
    it(item.name, () => {
      const { content } = pair(item.source, item.container);
      expect(content.width / content.height).toBeCloseTo(item.source.w / item.source.h, 5);
      const center = normalizedToClient(0.5, 0.5, content);
      expect(center.x).toBeCloseTo(content.left + content.width / 2, 5);
      expect(center.y).toBeCloseTo(content.top + content.height / 2, 5);
      for (const [x, y] of POINTS) {
        expectRoundTrip(content, x, y);
      }
      const origin = normalizedToClient(0, 0, content);
      expect(origin.x).toBeCloseTo(content.left, 5);
      expect(origin.y).toBeCloseTo(content.top, 5);
      const far = normalizedToClient(1, 1, content);
      expect(far.x).toBeCloseTo(content.left + content.width, 5);
      expect(far.y).toBeCloseTo(content.top + content.height, 5);
    });
  }

  it("letterboxes 16:9 inside 1000×800", () => {
    const { content } = pair({ w: 1920, h: 1080 }, { w: 1000, h: 800 });
    expect(content.width).toBeCloseTo(1000);
    expect(content.height).toBeCloseTo(562.5);
    expect(content.offsetX).toBeCloseTo(0);
    expect(content.offsetY).toBeCloseTo(118.75);
    expect(pointerToNormalized(10, 10, content)).toBeNull();
  });

  it("does not treat container size as source size", () => {
    const { content } = pair({ w: 1920, h: 1080 }, { w: 1000, h: 800 });
    expect(content.width).not.toBe(800);
    expect(content.height).not.toBe(800);
  });

  it("detects aspect / dimension source changes", () => {
    expect(dimensionsChanged({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(false);
    expect(dimensionsChanged({ width: 1920, height: 1080 }, { width: 2560, height: 1080 })).toBe(true);
    expect(dimensionsChanged({ width: 1080, height: 1920 }, { width: 1920, height: 1080 })).toBe(true);
  });
});
