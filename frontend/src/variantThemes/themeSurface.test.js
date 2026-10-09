import { describe, expect, it } from "vitest";
import {
  blendOverWhite,
  BLOCK_IMAGE_OPACITY,
  blockBackgroundStyle,
  contrastRatio,
  fallbackGradient,
  normalizeHex,
  orientedImageUrl,
  pageBackgroundStyle,
  pageContrastWarning,
} from "./themeSurface";

describe("themeSurface", () => {
  it("accepts #RGB and #RRGGBB and rejects partial values", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("#A1B2C3")).toBe("#a1b2c3");
    expect(normalizeHex("#12")).toBe("");
    expect(normalizeHex("red")).toBe("");
    expect(normalizeHex("#gg0000")).toBe("");
  });

  it("warns when page text would fail WCAG AA and keeps the color", () => {
    expect(pageContrastWarning("#111111")).toMatch(/не изменён/);
    expect(pageContrastWarning("#e7f3fb")).toBe("");
    expect(contrastRatio("#243044", blendOverWhite("#e7f3fb", 0.26))).toBeGreaterThan(4.5);
  });

  it("paints a chosen color instead of the default route gradient", () => {
    const style = pageBackgroundStyle({ type: "color", color: "#112233" }, "");
    expect(style.backgroundColor).toBe("#112233");
    expect(style.backgroundImage).not.toContain("#9fc8e4");
    expect(style.backgroundImage).toContain("rgba(255, 255, 255, 0.22)");
  });

  it("keeps the historical route gradient when no color is chosen", () => {
    const style = pageBackgroundStyle({ type: "none" }, "");
    expect(style.backgroundImage).toContain("#9fc8e4");
    expect(style.backgroundImage).toContain("#e7f3fb");
  });

  it("builds the same page wash the exam view uses", () => {
    const style = pageBackgroundStyle(
      { type: "gradient", colors: ["#112233", "#445566"], direction: "horizontal" },
      "",
    );
    expect(style.backgroundColor).toBe("#cfe8f6");
    expect(style.backgroundImage).toContain("linear-gradient(rgba(255, 255, 255, 0.22)");
    expect(style.backgroundImage).toContain("linear-gradient(90deg, #112233, #445566)");
    expect(fallbackGradient({ type: "color", color: "#fff" })).toContain("#9fc8e4");
  });

  it("uses the horizontal or vertical picture and falls back to the one that exists", () => {
    expect(orientedImageUrl("/wide.png", "/tall.png", "horizontal")).toBe("/wide.png");
    expect(orientedImageUrl("/wide.png", "/tall.png", "vertical")).toBe("/tall.png");
    expect(orientedImageUrl("/wide.png", "", "vertical")).toBe("/wide.png");
    expect(orientedImageUrl("", "/tall.png", "horizontal")).toBe("/tall.png");
  });

  it("keeps a task-card picture clearly visible", () => {
    expect(BLOCK_IMAGE_OPACITY).toBe(0.72);
    const style = blockBackgroundStyle("/media/card.png");
    expect(style["--variant-theme-block-opacity"]).toBe("0.72");
    expect(style["--te-card-image"]).toContain("/media/card.png");
    expect(blockBackgroundStyle("")).toEqual({});
  });

  it("prefers an uploaded picture over the gradient", () => {
    const style = pageBackgroundStyle({ type: "gradient", colors: ["#111111", "#222222"] }, "/media/bg.png");
    expect(style.backgroundImage).toBe('url("/media/bg.png")');
    expect(style.backgroundSize).toBe("cover");
    expect(style.backgroundImage).not.toContain("#9fc8e4");
  });
});
