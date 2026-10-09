/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DECORATION_GROUPS, VARIANT_THEME_ANIMATIONS, VARIANT_THEME_DECORATIONS } from "./registry";
import { DECORATIONS } from "./decorations";
import DecorationSample, { ANIMATION_LABELS, DECORATION_LABELS } from "./DecorationSample";
import ThemeDecorations from "./ThemeDecorations";

describe("decoration samples", () => {
  it("keeps every catalog entry editable as one record", () => {
    for (const item of DECORATIONS) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.label.length).toBeGreaterThan(0);
      expect(["background", "line"]).toContain(item.group);
      expect(item.sample).toBeTruthy();
    }
  });

  it("splits decorations into background, line and objects", () => {
    const seen = DECORATION_GROUPS.flatMap((group) => group.items);
    expect(DECORATION_GROUPS.map((group) => group.id)).toEqual(["background", "line"]);
    expect(seen).toEqual(VARIANT_THEME_DECORATIONS);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("names every decoration and animation in Russian", () => {
    for (const name of VARIANT_THEME_DECORATIONS) {
      expect(DECORATION_LABELS[name]).toEqual(expect.any(String));
      expect(DECORATION_LABELS[name].length).toBeGreaterThan(0);
    }
    for (const name of VARIANT_THEME_ANIMATIONS) {
      expect(ANIMATION_LABELS[name]).toEqual(expect.any(String));
    }
  });

  it("draws a picture for every decoration", () => {
    for (const name of VARIANT_THEME_DECORATIONS) {
      const { container, unmount } = render(<DecorationSample name={name} />);
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("fills the page with a pattern instead of a small sticker", () => {
    const { container } = render(
      <ThemeDecorations decorations={["stars", "flowers", "leaves"]} layoutType="classic" contained />,
    );
    expect(container.querySelector(".vt-pattern-svg--stars")).not.toBeNull();
    expect(container.querySelector(".vt-pattern-svg--flowers")).not.toBeNull();
    expect(container.querySelector(".vt-pattern-svg--leaves")).not.toBeNull();
    expect(container.querySelector(".variant-theme-decor__scene--stars")).toBeNull();
  });

  it("shows selected decorations inside a contained preview", () => {
    const { container } = render(
      <ThemeDecorations decorations={["mountains", "clouds"]} layoutType="classic" contained />,
    );
    expect(container.querySelector(".variant-theme-decor--contained")).not.toBeNull();
    expect(container.querySelector(".vt-pattern-svg--clouds")).not.toBeNull();
    expect(container.querySelector(".vt-pattern-svg--mountains")).not.toBeNull();
  });

  it("keeps classic exam pages free of decoration overlays", () => {
    const { container } = render(
      <ThemeDecorations decorations={["mountains", "clouds"]} layoutType="classic" />,
    );
    expect(container.querySelector(".variant-theme-decor")).toBeNull();
  });
});
