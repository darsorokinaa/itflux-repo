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

  it("detects heavy routes for boards, lessons, and meetings", () => {
    expect(isHeavyRoute("/cabinet/boards/abc")).toBe(true);
    expect(isHeavyRoute("/teacher/boards/abc")).toBe(true);
    expect(isHeavyRoute("/cabinet/meetings/uuid")).toBe(true);
    expect(isHeavyRoute("/lessons/slug/view")).toBe(true);
    expect(isHeavyRoute("/lesson/join")).toBe(true);
    expect(isHeavyRoute("/interesting/slug/view")).toBe(true);
    expect(isHeavyRoute("/cabinet")).toBe(false);
    expect(isHeavyRoute("/ege/inf/variant/1707")).toBe(false);
    expect(isHeavyRoute("/oge/math/variant/8")).toBe(false);
    expect(isHeavyRoute("/vpr/inf/variant/2096")).toBe(false);
    expect(isHeavyRoute("/ege/inf/variant/1707/")).toBe(false);
    expect(isHeavyRoute("/variant-live/abc")).toBe(false);
    expect(isHeavyRoute("/ege/inf")).toBe(false);
    expect(isHeavyRoute("/variant-live")).toBe(false);
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

  it("does not paint light seasonal text onto light header controls", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "seasonal-theme.css"), "utf8");
    const dark = css.split("html.seasonal-theme-active.seasonal-dark-bg").slice(1).join("\n");
    expect(dark).not.toMatch(/\.flux-help[\s,{][^}]*--on-page-text/);
    expect(dark).not.toMatch(/input,\s*textarea/);
    expect(dark).toMatch(/\.flux-nav-link:not\(:hover\):not\(\[aria-current="page"\]\)/);
    expect(dark).not.toMatch(/\.jg-hero__title/);
    expect(dark).not.toMatch(/\.seasonal-hero-sticker[^-]/);
  });

  it("keeps variant task cards and answer inputs dark on a light surface", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "seasonal-theme.css"), "utf8");
    const dark = css.split("html.seasonal-theme-active.seasonal-dark-bg").slice(1).join("\n");
    expect(dark).toMatch(/\.exam-task-card__text[\s\S]*?--on-card-text/);
    expect(dark).toMatch(/\.answer-input[\s\S]*?--on-card-text/);
    expect(dark).toMatch(/mjx-container[\s\S]*?--on-card-text/);
    expect(dark).not.toMatch(/\.exam-task-card__text[\s\S]{0,180}--on-page-text/);
    expect(dark).not.toMatch(/\.answer-input[\s\S]{0,180}--on-page-text/);
    expect(dark).not.toMatch(/mjx-container[\s\S]{0,180}--on-page-text/);
  });

  it("themes cabinet chrome on a dark seasonal background and keeps chips readable", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "seasonal-theme.css"), "utf8");
    const dark = css.split("html.seasonal-theme-active.seasonal-dark-bg").slice(1).join("\n");
    const beforeDark = css.split("html.seasonal-theme-active.seasonal-dark-bg")[0];

    expect(beforeDark).not.toMatch(/\.cabinet-sidebar-bottom/);
    expect(dark).toMatch(/\.cabinet-sidebar-bottom[\s\S]{0,180}background:\s*transparent\s*!important/);
    expect(dark).toMatch(/\.cb-layout \.cb-layout__sidebar[\s\S]{0,240}--seasonal-page-background/);
    expect(dark).toMatch(/\.cabinet-logout-btn:not\(:hover\)[\s\S]{0,160}--on-page-text/);
    expect(dark).toMatch(/\.cabinet-plan-chip__label[\s\S]{0,40}#1E3A8A/);
    expect(dark).toMatch(/\.cabinet-plan-chip__name[\s\S]{0,40}#1E40AF/);
    expect(dark).not.toMatch(/\.cabinet-plan-chip__label[\s\S]{0,80}--on-page-text/);
    expect(dark).toMatch(/\.st-page-header__title/);
    expect(dark).toMatch(/\.cb-section-title/);
    expect(dark).toMatch(/\.cb-page-hint[\s\S]{0,200}--on-page-text-secondary/);
    expect(dark).toMatch(/\.cb-mobile-nav, \.st-mobile-nav\)::before \{[^}]*--seasonal-page-background/);
    expect(dark).not.toMatch(/\.cb-widget[\s\S]{0,120}--on-page-text/);
    expect(dark).not.toMatch(/\.td-panel[\s\S]{0,80}--on-page-text/);

    expect(contrastRatio("#1E3A8A", "#EFF6FF")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#1E3A8A", "#F8FAFC")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#1E40AF", "#EFF6FF")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#1E40AF", "#F8FAFC")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#2563EB", "#F8FAFC")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", "#2563EB")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", "#0F172A")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#9F1239", "#FFF6EA")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", "#1550D8")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#1E3A8A", "#EFF6FF")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps snow click-through and behind the variant page shell", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "seasonal-theme.css"), "utf8");
    const canvas = css.match(/\.seasonal-fx-canvas\s*\{([^}]+)\}/);
    expect(canvas?.[1]).toMatch(/pointer-events:\s*none/);
    expect(css).toMatch(/html\.exam-variant-view \.seasonal-fx-canvas,[\s\S]*?\{[^}]*z-index:\s*1;[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/html\.exam-variant-view \.app-shell,[\s\S]*?\{[^}]*z-index:\s*2/);
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
