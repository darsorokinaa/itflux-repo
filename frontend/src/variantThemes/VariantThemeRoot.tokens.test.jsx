import { describe, expect, it } from "vitest";
import { applyThemeTokens } from "./VariantThemeRoot";

describe("applyThemeTokens", () => {
  it("sets card text secondary var and removes it for themes without the token", () => {
    const node = document.createElement("div");
    applyThemeTokens(node, { themeMode: "light", tokens: { card_text_secondary: "#22313f", hero_overlay: "rgba(22,60,96,.66)" } });
    expect(node.style.getPropertyValue("--variant-theme-card-text-secondary")).toBe("#22313f");
    expect(node.style.getPropertyValue("--variant-theme-hero-overlay")).toMatch(/rgba\(22,\s?60,\s?96,\s?\.?0?\.?66\)/);
    applyThemeTokens(node, { themeMode: "dark", tokens: {} });
    expect(node.style.getPropertyValue("--variant-theme-card-text-secondary")).toBe("");
    expect(node.classList.contains("variant-theme-mode--dark")).toBe(true);
  });
});
