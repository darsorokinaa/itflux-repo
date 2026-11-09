import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  buildSeasonalCssVars,
  isHeavyRoute,
  resolveAnimationCount,
  isMeetingChromeRoute,
  decorationAllowedOnRoute,
  readDayOverride,
  readCachedThemePayload,
  writeCachedThemePayload,
  resolveDeviceIntensity,
  themeAppliesToRoute,
  writeDayOverride,
  clearDayOverride,
  DAY_OVERRIDE_MS,
  CURRENT_CACHE_TTL_MS,
} from "./seasonalThemeApi";

describe("seasonalThemeApi", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });
  it("builds CSS variables from theme payload", () => {
    const vars = buildSeasonalCssVars({
      background: {
        color: "#F7FAFC",
        pattern_url: "/media/themes/new-year/pattern.webp",
        size: "240px",
        opacity: 0.18,
      },
      cards: {
        border_color: "#BBD8F2",
        accent_color: "#4D8FC9",
      },
      surfaces: {
        task_card: { pattern_opacity: 0.12 },
      },
    });
    expect(vars["--seasonal-page-background"]).toBe("#F7FAFC");
    expect(vars["--seasonal-page-pattern"]).toContain("pattern.webp");
    expect(vars["--seasonal-page-pattern-size"]).toBe("240px");
    expect(vars["--seasonal-page-pattern-repeat"]).toBe("repeat");
    expect(vars["--seasonal-page-pattern-position"]).toBe("0 0");
    expect(vars["--seasonal-card-border"]).toBe("#BBD8F2");
    expect(vars["--seasonal-accent"]).toBe("#4D8FC9");
  });

  it("uses meeting header decor when provided, otherwise cabinet header", () => {
    const withMeeting = buildSeasonalCssVars({
      header: {
        decor_url: "/media/header.png",
        meeting_decor_url: "/media/meeting.png",
      },
    });
    expect(withMeeting["--seasonal-header-decor"]).toContain("header.png");
    expect(withMeeting["--seasonal-meeting-header-decor"]).toContain("meeting.png");

    const fallback = buildSeasonalCssVars({
      header: { decor_url: "/media/header.png" },
    });
    expect(fallback["--seasonal-meeting-header-decor"]).toContain("header.png");
  });

  it("normalizes strip pattern settings to full-page tiling", () => {
    const vars = buildSeasonalCssVars({
      background: {
        pattern_url: "/p.png",
        repeat: "repeat-x",
        position: "bottom",
        size: "100%",
      },
    });
    expect(vars["--seasonal-page-pattern-repeat"]).toBe("repeat");
    expect(vars["--seasonal-page-pattern-position"]).toBe("0 0");
    expect(vars["--seasonal-page-pattern-size"]).toBe("240px");
  });

  it("returns empty vars without theme", () => {
    expect(buildSeasonalCssVars(null)).toEqual({});
  });

  it("detects heavy routes for boards and meetings", () => {
    expect(isHeavyRoute("/cabinet/boards/abc")).toBe(true);
    expect(isHeavyRoute("/cabinet/meetings/uuid")).toBe(true);
    expect(isHeavyRoute("/lessons/slug/view")).toBe(true);
    expect(isHeavyRoute("/interesting/slug/view")).toBe(true);
    expect(isHeavyRoute("/cabinet")).toBe(false);
    expect(isHeavyRoute("/ege/inf/variant/1707")).toBe(true);
    expect(isHeavyRoute("/oge/math/variant/8")).toBe(true);
    expect(isHeavyRoute("/vpr/inf/variant/2096")).toBe(true);
    expect(isHeavyRoute("/variant-live/abc")).toBe(true);
    expect(isHeavyRoute("/ege/inf")).toBe(false);
    expect(isHeavyRoute("/variant-live")).toBe(true);
  });

  it("keeps the theme particle cap, including minimal snow at 18", () => {
    expect(resolveAnimationCount(18)).toBe(18);
    expect(resolveAnimationCount(0)).toBe(20);
    expect(resolveAnimationCount(500)).toBe(60);
  });

  it("uses light on-page tokens with WCAG AA contrast on #8E2632", () => {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), "../styles/tokens.css");
    const css = readFileSync(cssPath, "utf8");
    const block = css.split("html.seasonal-theme-active.seasonal-dark-bg")[1] || "";
    const pick = (name) => {
      const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
      return match ? match[1] : "";
    };
    const text = pick("--on-page-text");
    const secondary = pick("--on-page-text-secondary");
    const muted = pick("--on-page-text-muted");
    const link = pick("--on-page-link");
    const card = pick("--on-card-text");
    const cardLink = pick("--on-card-link");
    const onDark = "#8E2632";
    const onCream = "#FFF6EA";
    for (const color of [text, secondary, muted, link]) {
      expect(contrastRatio(color, onDark)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(card, onCream)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cardLink, onCream)).toBeGreaterThanOrEqual(4.5);
  });

  it("detects meeting and board chrome routes", () => {
    expect(isMeetingChromeRoute("/cabinet/meetings/uuid")).toBe(true);
    expect(isMeetingChromeRoute("/cabinet/boards/abc")).toBe(true);
    expect(isMeetingChromeRoute("/teacher/boards/abc")).toBe(true);
    expect(isMeetingChromeRoute("/lessons/slug/view")).toBe(false);
    expect(isMeetingChromeRoute("/cabinet")).toBe(false);
  });

  it("shows video_meeting decorations only on call and board routes", () => {
    const decor = { zone: "video_meeting" };
    expect(decorationAllowedOnRoute(decor, "/cabinet/meetings/1")).toBe(true);
    expect(decorationAllowedOnRoute(decor, "/cabinet/boards/1")).toBe(true);
    expect(decorationAllowedOnRoute(decor, "/cabinet")).toBe(false);
    expect(decorationAllowedOnRoute({ zone: "page_background" }, "/cabinet/meetings/1", { heavy: true })).toBe(false);
    expect(decorationAllowedOnRoute({ zone: "top_bar" }, "/cabinet/meetings/1", { heavy: true })).toBe(true);
  });

  it("forces minimal intensity on mobile", () => {
    expect(
      resolveDeviceIntensity("festive", {
        isMobile: true,
        prefersReducedMotion: false,
        animationsEnabled: true,
      }),
    ).toBe("minimal");
  });

  it("disables animation for reduced motion", () => {
    expect(
      resolveDeviceIntensity("normal", {
        isMobile: false,
        prefersReducedMotion: true,
        animationsEnabled: true,
      }),
    ).toBe("off");
  });

  it("respects animationsEnabled flag", () => {
    expect(
      resolveDeviceIntensity("normal", {
        isMobile: false,
        prefersReducedMotion: false,
        animationsEnabled: false,
      }),
    ).toBe("off");
  });

  it("applies include/exclude routes", () => {
    const theme = {
      include_routes: ["/cabinet"],
      exclude_routes: ["/cabinet/boards"],
    };
    expect(themeAppliesToRoute(theme, "/cabinet")).toBe(true);
    expect(themeAppliesToRoute(theme, "/cabinet/students")).toBe(true);
    expect(themeAppliesToRoute(theme, "/cabinet/boards/1")).toBe(false);
    expect(themeAppliesToRoute(theme, "/")).toBe(false);
  });

  it("applies everywhere when include empty", () => {
    expect(themeAppliesToRoute({ include_routes: [], exclude_routes: [] }, "/pricing")).toBe(true);
  });

  it("stores day override for 24h", () => {
    writeDayOverride({ mode: "default", selected_theme_id: null });
    const day = readDayOverride();
    expect(day?.mode).toBe("default");
    expect(day?.expires_at).toBeGreaterThan(Date.now());
    expect(day?.expires_at).toBeLessThanOrEqual(Date.now() + DAY_OVERRIDE_MS + 1000);
    clearDayOverride();
    expect(readDayOverride()).toBeNull();
  });

  it("hydrates seasonal theme from a fresh local cache", () => {
    const payload = { mode: "auto", theme: { slug: "medovyj-spas" } };
    writeCachedThemePayload(payload);
    expect(readCachedThemePayload()?.theme?.slug).toBe("medovyj-spas");
  });

  it("ignores expired seasonal theme cache", () => {
    writeCachedThemePayload({ mode: "auto", theme: { slug: "old" } });
    const raw = JSON.parse(localStorage.getItem("seasonal_theme_current_cache_v1"));
    raw.saved_at = Date.now() - CURRENT_CACHE_TTL_MS - 1000;
    localStorage.setItem("seasonal_theme_current_cache_v1", JSON.stringify(raw));
    expect(readCachedThemePayload()).toBeNull();
  });
});

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const h = hex.replace("#", "");
  const r = channel(parseInt(h.slice(0, 2), 16));
  const g = channel(parseInt(h.slice(2, 4), 16));
  const b = channel(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}
