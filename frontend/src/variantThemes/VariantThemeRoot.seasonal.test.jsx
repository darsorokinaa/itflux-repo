/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { VariantThemeRoot } from "./VariantThemeRoot";

const payload = {
  slug: "travel",
  layout_type: "route",
  config: { background: { type: "color", color: "#112233" } },
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
    expect(document.documentElement.style.getPropertyValue("background-color")).not.toBe("");
  });

  it("yields the page background while the seasonal theme is showing", async () => {
    document.documentElement.classList.add("seasonal-theme-active");
    render(
      <VariantThemeRoot payload={payload}>
        <div>variant</div>
      </VariantThemeRoot>,
    );
    expect(document.documentElement.style.getPropertyValue("background-color")).toBe("");

    document.documentElement.classList.remove("seasonal-theme-active");
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("background-color")).not.toBe("");
    });
  });
});
