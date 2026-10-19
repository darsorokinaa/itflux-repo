import { describe, expect, it } from "vitest";
import { quantizeSceneElementsForPersist, quantizeStrokeElement } from "./boardStrokeQuantize";

const stroke = {
  id: "s",
  type: "freedraw",
  version: 3,
  versionNonce: 7,
  isDeleted: false,
  points: [[0, 0], [-9.59991455078125, 3.2000350952148438]],
  pressures: [0.0400390625, 0.4443359375],
};

describe("boardStrokeQuantize", () => {
  it("округляет точки до 0.01 и давление до 0.001, version не трогает", () => {
    const q = quantizeStrokeElement(stroke);
    expect(q.points).toEqual([[0, 0], [-9.6, 3.2]]);
    expect(q.pressures).toEqual([0.04, 0.444]);
    expect(q.version).toBe(3);
    expect(q.versionNonce).toBe(7);
    expect(stroke.points[1][0]).toBe(-9.59991455078125);
  });

  it("идемпотентно и не копирует без изменений", () => {
    const q = quantizeStrokeElement(stroke);
    expect(quantizeStrokeElement(q)).toBe(q);
  });

  it("не трогает прямоугольники, текст и удалённые", () => {
    const rect = { type: "rectangle", x: 1.23456 };
    expect(quantizeStrokeElement(rect)).toBe(rect);
    const del = { ...stroke, isDeleted: true };
    expect(quantizeStrokeElement(del)).toBe(del);
  });

  it("сжимает типичный штрих более чем вдвое", () => {
    const pts = Array.from({ length: 60 }, (_, i) => [i * 1.0000123456789, -i * 2.333333333333]);
    const el = { ...stroke, points: pts, pressures: pts.map(() => 0.123456789) };
    const [q] = quantizeSceneElementsForPersist([el]);
    expect(JSON.stringify(q).length).toBeLessThan(JSON.stringify(el).length * 0.5);
  });
});
