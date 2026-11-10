/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { VariantThemeRoot } from "./VariantThemeRoot";

const payload = {
  id: 3,
  slug: "travel",
  name: "Путешествие",
  layout_type: "route",
  config: {
    background: { type: "color", color: "#112233" },
    tokens: { page_text_primary: "#243044", accent: "#2f6f9f" },
  },
};

const classicWithCardOnly = {
  id: 4,
  slug: "paper",
  layout_type: "classic",
  block_background_image_url: "/media/card.png",
  config: { background: { type: "none" } },
};

describe("VariantThemeRoot seasonal page background", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
  });

  it("paints its own page background when the seasonal theme is off", () => {
    render(
      <VariantThemeRoot payload={payload}>
        <div>variant</div>
      </VariantThemeRoot>,
    );
    expect(document.documentElement.style.getPropertyValue("background-color")).toBe("rgb(17, 34, 51)");
    expect(document.documentElement.classList.contains("variant-theme-owns-page")).toBe(true);
  });

  it("keeps the variant background, colours and ownership while the seasonal theme is showing", async () => {
    document.documentElement.classList.add("seasonal-theme-active", "seasonal-dark-bg", "seasonal-has-pattern");
    render(
      <VariantThemeRoot payload={payload}>
        <div>variant</div>
      </VariantThemeRoot>,
    );
    const root = document.documentElement;
    expect(root.style.getPropertyValue("background-color")).toBe("rgb(17, 34, 51)");
    expect(root.style.getPropertyValue("background-image")).not.toBe("");
    expect(root.style.getPropertyValue("--variant-theme-page-text")).toBe("#243044");
    expect(root.style.getPropertyValue("--variant-theme-accent")).toBe("#2f6f9f");
    expect(root.classList.contains("variant-theme-owns-page")).toBe(true);
    expect(root.classList.contains("variant-theme-active")).toBe(true);

    root.classList.remove("seasonal-theme-active", "seasonal-dark-bg", "seasonal-has-pattern");
    await waitFor(() => {
      expect(root.style.getPropertyValue("background-color")).toBe("rgb(17, 34, 51)");
      expect(root.classList.contains("variant-theme-owns-page")).toBe(true);
    });
  });

  it("does not claim the page when the variant has no theme", () => {
    document.documentElement.classList.add("seasonal-theme-active");
    render(
      <VariantThemeRoot payload={null}>
        <div>variant</div>
      </VariantThemeRoot>,
    );
    const root = document.documentElement;
    expect(root.style.getPropertyValue("background-color")).toBe("");
    expect(root.classList.contains("variant-theme-owns-page")).toBe(false);
    expect(root.classList.contains("variant-theme-active")).toBe(false);
  });

  it("leaves a card-only classic theme on the seasonal background", () => {
    document.documentElement.classList.add("seasonal-theme-active");
    render(
      <VariantThemeRoot payload={classicWithCardOnly}>
        <div>variant</div>
      </VariantThemeRoot>,
    );
    const root = document.documentElement;
    expect(root.style.getPropertyValue("background-color")).toBe("");
    expect(root.classList.contains("variant-theme-owns-page")).toBe(false);
    expect(root.classList.contains("variant-theme-active")).toBe(true);
    expect(root.style.getPropertyValue("--variant-theme-block-bg-image")).toContain("/media/card.png");
  });
});
