import { describe, expect, it } from "vitest";
import { CLASSIC_VARIANT_THEME, resolveVariantTheme } from "./registry";

describe("resolveVariantTheme", () => {
  it("falls back to classic when payload is empty", () => {
    expect(resolveVariantTheme(null)).toEqual(CLASSIC_VARIANT_THEME);
    expect(resolveVariantTheme(undefined).isClassic).toBe(true);
  });

  it("uses travel route layout", () => {
    const theme = resolveVariantTheme({
      id: 3,
      slug: "travel",
      layout_type: "route",
      config: {
        labels: { task: "Остановка", next: "Следующая остановка" },
        decorations: ["clouds", "plane"],
        animation: "plane-route",
      },
    });
    expect(theme.isClassic).toBe(false);
    expect(theme.layoutType).toBe("route");
    expect(theme.labels.task).toBe("Остановка");
    expect(theme.labels.finish).toBe("Завершить вариант");
    expect(theme.animation).toBe("plane-route");
    expect(theme.background.blockUrl).toBe("");
  });

  it("reads page and block background urls separately", () => {
    const theme = resolveVariantTheme({
      slug: "travel",
      layout_type: "route",
      background_image_url: "https://example.test/page.png",
      block_background_image_url: "https://example.test/blocks.png",
      config: { background: { type: "image", url: "https://example.test/page.png" } },
    });
    expect(theme.background.url).toBe("https://example.test/page.png");
    expect(theme.background.blockUrl).toBe("https://example.test/blocks.png");
  });

  it("falls back to classic for unknown layout and slug", () => {
    const theme = resolveVariantTheme({
      slug: "unknown-space",
      layout_type: "custom-html",
      config: { labels: { task: "Космос" } },
    });
    expect(theme.isClassic).toBe(true);
    expect(theme.layoutType).toBe("classic");
  });

  it("ignores unknown animation and decorations", () => {
    const theme = resolveVariantTheme({
      slug: "travel",
      layout_type: "route",
      config: { animation: "eval()", decorations: ["malware", "clouds"] },
    });
    expect(theme.animation).toBe("none");
    expect(theme.decorations).toEqual(["clouds"]);
  });
});
