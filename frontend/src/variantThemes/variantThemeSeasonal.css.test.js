import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const variantCss = readFileSync(join(here, "variant-themes.css"), "utf8");
const seasonalCss = readFileSync(join(here, "../seasonal/seasonal-theme.css"), "utf8");

describe("variant theme covers the seasonal platform background", () => {
  it("does not force the seasonal background onto a variant that owns the page", () => {
    const block = seasonalCss.split("Страница варианта без своей темы")[1] || "";
    expect(block).toContain(":not(.variant-theme-owns-page)");
    expect(block).not.toMatch(/:not\(\.seasonal-heavy\)(?!:not\(\.variant-theme-owns-page\))/);
    expect(variantCss).toMatch(
      /html\.seasonal-theme-active\.variant-theme-owns-page:has\(#main-wrapper\.exam-page--edu\)/,
    );
  });

  it("hides the seasonal pattern, snow and decorations when the variant has a theme", () => {
    expect(seasonalCss).toMatch(
      /seasonal-has-pattern:not\(\.seasonal-heavy\):not\(\.variant-theme-owns-page\) \.app-shell-pattern/,
    );
    expect(seasonalCss).toMatch(
      /html\.seasonal-theme-active:not\(\.seasonal-heavy\):not\(\.variant-theme-owns-page\) \.app-shell::after/,
    );
    expect(variantCss).toMatch(
      /html\.variant-theme-owns-page \.seasonal-fx-canvas,\s*html\.variant-theme-owns-page \.seasonal-decor-layer/,
    );
  });

  it("keeps seasonal snow behind an unthemed variant page", () => {
    expect(seasonalCss).toMatch(
      /html\.exam-variant-view \.seasonal-fx-canvas,[\s\S]*?\{[^}]*z-index:\s*1;[^}]*pointer-events:\s*none/,
    );
  });

  it("keeps lesson, board and call views without decor", () => {
    expect(seasonalCss).toMatch(
      /html\.seasonal-heavy \.seasonal-fx-canvas,\s*html\.seasonal-heavy \.seasonal-decor-layer:not\(\.seasonal-decor-layer--chrome\),\s*html\.seasonal-heavy \.app-shell-pattern/,
    );
    expect(seasonalCss).toMatch(/\.app-shell--lesson-viewer \.seasonal-decor-layer/);
    expect(seasonalCss).toMatch(/\.cb-board-editor \.seasonal-fx-canvas/);
  });

  it("uses the variant page colour and display font instead of the dark seasonal text", () => {
    expect(variantCss).toMatch(
      /variant-theme-owns-page \{\s*--on-page-text:\s*var\(--variant-theme-page-text, var\(--text-main\)\);/,
    );
    expect(variantCss).toMatch(
      /variant-theme-mode--dark \{\s*--on-page-text:\s*var\(--variant-theme-page-text, #f2f4ff\);/,
    );
    expect(variantCss).toMatch(
      /variant-theme-owns-page #main-wrapper\.exam-page--edu \.exam-edu-section-title \{\s*font-family:\s*var\(--font-display\);/,
    );
  });

  it("leaves the classic background rule for pages without a seasonal theme", () => {
    expect(variantCss).toMatch(
      /html\.variant-theme-active:not\(\.seasonal-theme-active\):has\(#main-wrapper\.exam-page--edu\)/,
    );
  });
});
