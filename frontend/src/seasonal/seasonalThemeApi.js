/** API и localStorage для сезонного оформления. */

import { ensureCsrfCookie } from "../utils/cabinetAuth";

const GUEST_PREF_KEY = "seasonal_theme_preference_v1";
const DAY_OVERRIDE_KEY = "seasonal_theme_day_override_v1";
const CURRENT_CACHE_KEY = "seasonal_theme_current_cache_v1";
export const DAY_OVERRIDE_MS = 24 * 60 * 60 * 1000;
export const CURRENT_CACHE_TTL_MS = 5 * 60 * 1000;

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function seasonalFetch(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    await ensureCsrfCookie();
  }
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const csrf = getCsrfToken();
  if (csrf && method !== "GET" && method !== "HEAD") {
    headers["X-CSRFToken"] = csrf;
  }
  const res = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.detail || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function normalizePref(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  return {
    mode: parsed.mode || "auto",
    selected_theme_id: parsed.selected_theme_id ?? null,
    animations_enabled: parsed.animations_enabled !== false,
  };
}

/** Дневной выбор (вкл/выкл темы) — действует 24 часа. */
export function readDayOverride() {
  try {
    const raw = localStorage.getItem(DAY_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const expiresAt = Number(parsed.expires_at) || 0;
    if (!expiresAt || Date.now() > expiresAt) {
      localStorage.removeItem(DAY_OVERRIDE_KEY);
      markDayOverrideExpired();
      return null;
    }
    return {
      ...normalizePref(parsed),
      expires_at: expiresAt,
    };
  } catch {
    return null;
  }
}

export function writeDayOverride(pref, { ttlMs = DAY_OVERRIDE_MS } = {}) {
  try {
    const expiresAt = Date.now() + Math.max(60_000, ttlMs);
    localStorage.setItem(
      DAY_OVERRIDE_KEY,
      JSON.stringify({
        mode: pref.mode || "auto",
        selected_theme_id: pref.selected_theme_id ?? null,
        animations_enabled: pref.animations_enabled !== false,
        expires_at: expiresAt,
        updated_at: Date.now(),
      }),
    );
    return expiresAt;
  } catch {
    return null;
  }
}

export function clearDayOverride() {
  try {
    localStorage.removeItem(DAY_OVERRIDE_KEY);
  } catch {
    /* ignore */
  }
}

const DAY_EXPIRED_RESET_KEY = "seasonal_theme_day_expired_reset_v1";

/** После истечения дневного выбора — один раз сбросить prefs на auto. */
export function consumeDayOverrideExpiredFlag() {
  try {
    if (!localStorage.getItem(DAY_EXPIRED_RESET_KEY)) return false;
    localStorage.removeItem(DAY_EXPIRED_RESET_KEY);
    return true;
  } catch {
    return false;
  }
}

function markDayOverrideExpired() {
  try {
    localStorage.setItem(DAY_EXPIRED_RESET_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function readGuestPreference() {
  try {
    const day = readDayOverride();
    if (day) {
      return {
        mode: day.mode,
        selected_theme_id: day.selected_theme_id,
        animations_enabled: day.animations_enabled,
      };
    }
    const raw = localStorage.getItem(GUEST_PREF_KEY);
    if (!raw) return null;
    return normalizePref(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeGuestPreference(pref) {
  try {
    localStorage.setItem(
      GUEST_PREF_KEY,
      JSON.stringify({
        mode: pref.mode || "auto",
        selected_theme_id: pref.selected_theme_id ?? null,
        animations_enabled: pref.animations_enabled !== false,
        updated_at: Date.now(),
      }),
    );
  } catch {
    /* private mode */
  }
}

export function clearGuestPreference() {
  try {
    localStorage.removeItem(GUEST_PREF_KEY);
  } catch {
    /* ignore */
  }
}

/** Последний успешный payload темы — чтобы оформление и анимация не ждали API. */
export function readCachedThemePayload() {
  try {
    const raw = localStorage.getItem(CURRENT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const savedAt = Number(parsed.saved_at) || 0;
    if (!savedAt || Date.now() - savedAt > CURRENT_CACHE_TTL_MS) {
      localStorage.removeItem(CURRENT_CACHE_KEY);
      return null;
    }
    const payload = parsed.payload;
    if (!payload || typeof payload !== "object") return null;
    return payload;
  } catch {
    return null;
  }
}

export function writeCachedThemePayload(payload) {
  try {
    if (!payload || typeof payload !== "object") {
      localStorage.removeItem(CURRENT_CACHE_KEY);
      return;
    }
    localStorage.setItem(
      CURRENT_CACHE_KEY,
      JSON.stringify({
        saved_at: Date.now(),
        payload,
      }),
    );
  } catch {
    /* private mode */
  }
}

export function fetchSeasonalThemeCurrent(guestPreference = null) {
  const qs = new URLSearchParams();
  if (guestPreference) {
    if (guestPreference.mode) qs.set("mode", guestPreference.mode);
    if (guestPreference.selected_theme_id) {
      qs.set("theme_id", String(guestPreference.selected_theme_id));
    }
    if (guestPreference.animations_enabled === false) {
      qs.set("animations_enabled", "false");
    }
  }
  const query = qs.toString();
  const path = query
    ? `/api/seasonal-theme/current/?${query}`
    : "/api/seasonal-theme/current/";
  return seasonalFetch(path, { method: "GET" });
}

export function updateSeasonalThemePreference(payload) {
  return seasonalFetch("/api/seasonal-theme/preference/", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function startSeasonalThemePreview(themeId) {
  return seasonalFetch("/api/seasonal-theme/preview/start/", {
    method: "POST",
    body: JSON.stringify({ theme_id: themeId }),
  });
}

export function stopSeasonalThemePreview() {
  return seasonalFetch("/api/seasonal-theme/preview/stop/", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/** Маршруты, где отключаются тяжёлые эффекты. */
export const HEAVY_ROUTE_PATTERNS = [
  /^\/cabinet\/boards(\/|$)/,
  /^\/teacher\/boards(\/|$)/,
  /^\/cabinet\/meetings(\/|$)/,
  /^\/lessons\/[^/]+\/view/,
  /^\/interesting\/[^/]+\/view/,
  /^\/cabinet\/interactives\/[^/]+\/play/,
  /^\/cabinet\/student\/interactives\/\d+\/play/,
  /^\/lesson\/join/,
];

export function isHeavyRoute(pathname) {
  const path = pathname || "";
  return HEAVY_ROUTE_PATTERNS.some((re) => re.test(path));
}

export function routeMatchesList(pathname, list) {
  if (!Array.isArray(list) || !list.length) return false;
  const path = pathname || "/";
  return list.some((item) => {
    const prefix = String(item || "").trim();
    if (!prefix) return false;
    if (prefix === "/") return path === "/" || path === "";
    return path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || path.startsWith(prefix);
  });
}

export function themeAppliesToRoute(theme, pathname) {
  if (!theme) return false;
  const exclude = theme.exclude_routes || [];
  const include = theme.include_routes || [];
  if (routeMatchesList(pathname, exclude)) return false;
  if (include.length && !routeMatchesList(pathname, include)) return false;
  return true;
}

export function resolveDeviceIntensity(themeIntensity, { isMobile, prefersReducedMotion, animationsEnabled }) {
  if (!animationsEnabled || prefersReducedMotion) return "off";
  const base = themeIntensity || "minimal";
  if (isMobile) {
    if (base === "off") return "off";
    return "minimal";
  }
  return base;
}

/** Page pattern must tile across the viewport; strip modes look like "only at the bottom". */
export function normalizePatternRepeat(repeat) {
  const value = String(repeat || "repeat").trim().toLowerCase();
  if (value === "repeat-y") return "repeat-y";
  return "repeat";
}

export function normalizePatternSize(size) {
  const raw = String(size || "240px").trim();
  if (!raw || /^(100%|100vw|100vh|cover|contain)$/i.test(raw)) return "240px";
  return raw;
}

export function normalizePatternPosition(position) {
  const raw = String(position || "0 0").trim().toLowerCase();
  if (!raw || raw === "center" || raw.includes("bottom") || raw.includes("top")) {
    return "0 0";
  }
  return position || "0 0";
}

export function buildSeasonalCssVars(theme) {
  if (!theme) return {};
  const bg = theme.background || {};
  const surfaces = theme.surfaces || {};
  const cards = theme.cards || {};
  const task = { ...cards, ...(surfaces.task_card || {}) };
  const lesson = surfaces.lesson_card || {};
  const accent = surfaces.accent || {};

  const vars = {};
  if (bg.color) vars["--seasonal-page-background"] = bg.color;
  if (bg.pattern_url) vars["--seasonal-page-pattern"] = `url(${bg.pattern_url})`;
  if (bg.pattern_mobile_url) vars["--seasonal-page-pattern-mobile"] = `url(${bg.pattern_mobile_url})`;
  vars["--seasonal-page-pattern-size"] = normalizePatternSize(bg.size);
  vars["--seasonal-page-pattern-position"] = normalizePatternPosition(bg.position);
  vars["--seasonal-page-pattern-repeat"] = normalizePatternRepeat(bg.repeat);
  if (bg.opacity != null) vars["--seasonal-page-pattern-opacity"] = String(bg.opacity);
  if (bg.overlay_color) vars["--seasonal-page-overlay"] = bg.overlay_color;
  if (bg.overlay_opacity != null) vars["--seasonal-page-overlay-opacity"] = String(bg.overlay_opacity);

  const menu = theme.menu || {};
  if (menu.background_url) vars["--seasonal-menu-background"] = `url(${menu.background_url})`;

  const header = theme.header || {};
  if (header.decor_url) vars["--seasonal-header-decor"] = `url(${header.decor_url})`;

  if (task.background_color) vars["--seasonal-card-background"] = task.background_color;
  if (task.pattern_url) vars["--seasonal-card-pattern"] = `url(${task.pattern_url})`;
  if (task.pattern_opacity != null) vars["--seasonal-card-pattern-opacity"] = String(task.pattern_opacity);
  if (task.border_color) vars["--seasonal-card-border"] = task.border_color;
  if (task.border_width) vars["--seasonal-card-border-width"] = task.border_width;
  if (task.border_radius) vars["--seasonal-card-radius"] = task.border_radius;
  if (task.shadow) vars["--seasonal-card-shadow"] = task.shadow;
  if (task.accent_color || accent.accent_color || cards.accent_color) {
    vars["--seasonal-accent"] = task.accent_color || accent.accent_color || cards.accent_color;
  }
  if (lesson.background_color) vars["--seasonal-lesson-card-background"] = lesson.background_color;
  if (lesson.border_color) vars["--seasonal-lesson-card-border"] = lesson.border_color;

  vars["--seasonal-decoration-opacity"] = "1";
  return vars;
}
