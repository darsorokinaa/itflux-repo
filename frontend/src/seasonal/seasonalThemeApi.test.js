import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  buildSeasonalCssVars,
  isHeavyRoute,
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
