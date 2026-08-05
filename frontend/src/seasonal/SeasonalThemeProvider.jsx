import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import {
  buildSeasonalCssVars,
  clearGuestPreference,
  consumeDayOverrideExpiredFlag,
  fetchSeasonalThemeCurrent,
  isHeavyRoute,
  readDayOverride,
  readGuestPreference,
  resolveDeviceIntensity,
  themeAppliesToRoute,
  updateSeasonalThemePreference,
  writeDayOverride,
  writeGuestPreference,
  stopSeasonalThemePreview,
} from "./seasonalThemeApi";
import SeasonalThemeEffects from "./SeasonalThemeEffects";
import SeasonalThemeDecorations from "./SeasonalThemeDecorations";
import SeasonalPreviewBanner from "./SeasonalPreviewBanner";
import SeasonalAppearanceFab from "./SeasonalAppearanceFab";
import "./seasonal-theme.css";

const SeasonalThemeContext = createContext(null);

function detectMobile() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 768px)").matches;
}

function detectReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function detectLowEnd() {
  if (typeof navigator === "undefined") return false;
  const mem = navigator.deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if (typeof mem === "number" && mem > 0 && mem <= 2) return true;
  if (typeof cores === "number" && cores > 0 && cores <= 2) return true;
  return false;
}

function applyCssVars(vars) {
  const root = document.documentElement;
  const keys = Object.keys(vars);
  keys.forEach((key) => {
    root.style.setProperty(key, vars[key]);
  });
  return () => {
    keys.forEach((key) => root.style.removeProperty(key));
  };
}

function resolveSelectedThemeId(patch, payload) {
  if (Object.prototype.hasOwnProperty.call(patch, "selected_theme_id")) {
    return patch.selected_theme_id ?? null;
  }
  return payload?.theme?.id ?? readGuestPreference()?.selected_theme_id ?? null;
}

function themeLabelFromPayload(payload) {
  const name =
    payload?.theme?.name
    || payload?.available_themes?.[0]?.name
    || null;
  return name;
}

export function SeasonalThemeProvider({ children }) {
  const { pathname } = useLocation();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMobile, setIsMobile] = useState(() => detectMobile());
  const [reducedMotion, setReducedMotion] = useState(() => detectReducedMotion());
  const [isLowEnd, setIsLowEnd] = useState(() => detectLowEnd());
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const syncedGuestRef = useRef(false);
  const dayResetDoneRef = useRef(false);
  const abortRef = useRef(null);

  const setPreference = useCallback(async (patch, { dayOverride = false } = {}) => {
    const nextGuest = {
      mode: patch.mode ?? payload?.preference_mode ?? payload?.mode ?? "auto",
      selected_theme_id: resolveSelectedThemeId(patch, payload),
      animations_enabled:
        patch.animations_enabled !== undefined
          ? patch.animations_enabled
          : payload?.animations_enabled !== false,
    };
    writeGuestPreference(nextGuest);
    if (dayOverride) {
      writeDayOverride(nextGuest);
    }
    try {
      const next = await updateSeasonalThemePreference(patch);
      setPayload(next);
      if (!dayOverride) clearGuestPreference();
      return next;
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        writeGuestPreference(nextGuest);
        const next = await fetchSeasonalThemeCurrent(nextGuest);
        if (next) setPayload(next);
        return next;
      }
      throw err;
    }
  }, [payload]);

  const refresh = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const day = readDayOverride();
      const guestPref = day || readGuestPreference();
      let data = await fetchSeasonalThemeCurrent(guestPref);
      if (ctrl.signal.aborted) return data;

      // После истечения суток — вернуть auto (один раз)
      if (!dayResetDoneRef.current && consumeDayOverrideExpiredFlag()) {
        dayResetDoneRef.current = true;
        try {
          data = await updateSeasonalThemePreference({ mode: "auto" });
        } catch (err) {
          if (err?.status === 401 || err?.status === 403) {
            writeGuestPreference({ mode: "auto", selected_theme_id: null, animations_enabled: true });
            data = await fetchSeasonalThemeCurrent({ mode: "auto" });
          } else {
            throw err;
          }
        }
      } else if (
        day
        && data?.preference_mode
        && data.preference_mode !== day.mode
      ) {
        // Авторизованный: API игнорирует query — подтягиваем дневной выбор на сервер
        try {
          data = await updateSeasonalThemePreference({
            mode: day.mode,
            selected_theme_id: day.selected_theme_id,
            animations_enabled: day.animations_enabled,
          });
        } catch {
          /* гость — current уже с query */
        }
      }

      if (ctrl.signal.aborted) return data;
      setPayload(data);
      setError(null);
      return data;
    } catch (err) {
      if (ctrl.signal.aborted) return null;
      setError(err);
      setPayload((prev) => prev || {
        mode: "auto",
        theme: null,
        animations_enabled: true,
        user_can_disable: true,
        available_themes: [],
        preview: { active: false },
      });
      return null;
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [refresh]);

  // Guest → server только если серверные prefs ещё «чистые»
  useEffect(() => {
    if (syncedGuestRef.current) return;
    if (!payload) return;
    if (readDayOverride()) {
      syncedGuestRef.current = true;
      return;
    }
    const guest = readGuestPreference();
    if (!guest) {
      syncedGuestRef.current = true;
      return;
    }
    if (!payload.preference_mode) {
      syncedGuestRef.current = true;
      return;
    }
    const serverMode = payload.preference_mode;
    const serverAnimationsOn = payload.animations_enabled !== false;
    const serverPristine = serverMode === "auto" && serverAnimationsOn;
    const guestDiffers =
      guest.mode !== "auto"
      || guest.animations_enabled === false
      || Boolean(guest.selected_theme_id);

    if (!serverPristine || !guestDiffers) {
      clearGuestPreference();
      syncedGuestRef.current = true;
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const next = await updateSeasonalThemePreference({
          mode: guest.mode,
          selected_theme_id: guest.selected_theme_id,
          animations_enabled: guest.animations_enabled,
        });
        if (!cancelled && next) {
          setPayload(next);
          clearGuestPreference();
        }
      } catch {
        /* не авторизован */
      } finally {
        syncedGuestRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payload]);

  useEffect(() => {
    const onResize = () => {
      setIsMobile(detectMobile());
      setIsLowEnd(detectLowEnd());
    };
    const mqMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => setReducedMotion(mqMotion.matches);
    const onVis = () => setPageVisible(document.visibilityState === "visible");
    window.addEventListener("resize", onResize);
    mqMotion.addEventListener?.("change", onMotion);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("resize", onResize);
      mqMotion.removeEventListener?.("change", onMotion);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const theme = payload?.theme || null;
  const animationsEnabled = payload?.animations_enabled !== false;
  const preview = payload?.preview || { active: false };
  const preferenceMode = payload?.preference_mode || payload?.mode || "auto";
  const applies = themeAppliesToRoute(theme, pathname);
  const heavy = isHeavyRoute(pathname);
  const effectiveTheme = applies ? theme : null;
  const availableThemes = payload?.available_themes || [];
  const hasSeasonalAppearance =
    !loading
    && (availableThemes.length > 0 || Boolean(theme) || Boolean(preview?.active));

  const seasonalEnabled = preferenceMode !== "default" && Boolean(theme);
  const labelName = themeLabelFromPayload(payload);
  const appearanceTooltip = seasonalEnabled
    ? (labelName ? `Тема: ${labelName}` : "Сезонное оформление")
    : (labelName ? `Включить: ${labelName}` : "Сезонное оформление");

  const intensity = resolveDeviceIntensity(effectiveTheme?.animation?.intensity, {
    isMobile,
    prefersReducedMotion: reducedMotion,
    animationsEnabled: animationsEnabled && !heavy && pageVisible,
  });

  // Для одноразового canvas не гасим интенсивность при скрытии вкладки браузера
  const effectIntensity = resolveDeviceIntensity(effectiveTheme?.animation?.intensity, {
    isMobile,
    prefersReducedMotion: reducedMotion,
    animationsEnabled: animationsEnabled && !heavy,
  });

  const allowBackgroundPattern =
    Boolean(effectiveTheme?.background?.pattern_url)
    && !(isLowEnd && effectiveTheme?.background?.disable_on_low_end);

  useEffect(() => {
    const root = document.documentElement;
    if (!effectiveTheme) {
      root.classList.remove("seasonal-theme-active", "seasonal-has-pattern");
      root.removeAttribute("data-seasonal-theme");
      return undefined;
    }
    const vars = buildSeasonalCssVars(effectiveTheme);
    if (!allowBackgroundPattern) {
      delete vars["--seasonal-page-pattern"];
      delete vars["--seasonal-page-pattern-mobile"];
    }
    const cleanup = applyCssVars(vars);
    root.classList.add("seasonal-theme-active");
    root.classList.toggle("seasonal-has-pattern", allowBackgroundPattern);
    root.setAttribute("data-seasonal-theme", effectiveTheme.slug || "");
    return () => {
      cleanup();
      root.classList.remove("seasonal-theme-active", "seasonal-has-pattern");
      root.removeAttribute("data-seasonal-theme");
    };
  }, [effectiveTheme, allowBackgroundPattern]);

  const toggleAppearance = useCallback(async () => {
    const userCanDisable = payload?.user_can_disable !== false;
    if (seasonalEnabled) {
      if (!userCanDisable) return payload;
      return setPreference({ mode: "default" }, { dayOverride: true });
    }
    const first = availableThemes[0];
    if (first?.id) {
      return setPreference(
        { mode: "manual", selected_theme_id: first.id },
        { dayOverride: true },
      );
    }
    return setPreference({ mode: "auto" }, { dayOverride: true });
  }, [payload, seasonalEnabled, availableThemes, setPreference]);

  const stopPreview = useCallback(async () => {
    try {
      const next = await stopSeasonalThemePreview();
      setPayload(next);
    } catch {
      await refresh();
    }
  }, [refresh]);

  const value = useMemo(
    () => ({
      loading,
      error,
      payload,
      theme: effectiveTheme,
      rawTheme: theme,
      mode: payload?.mode || "auto",
      preferenceMode,
      animationsEnabled,
      intensity,
      userCanDisable: payload?.user_can_disable !== false,
      availableThemes,
      hasSeasonalAppearance,
      seasonalEnabled,
      appearanceTooltip,
      preview,
      isHeavyRoute: heavy,
      isMobile,
      reducedMotion,
      pageVisible,
      panelOpen: false,
      openAppearancePanel: toggleAppearance,
      closeAppearancePanel: () => {},
      toggleAppearance,
      setPreference,
      refresh,
      stopPreview,
    }),
    [
      loading,
      error,
      payload,
      effectiveTheme,
      theme,
      preferenceMode,
      animationsEnabled,
      intensity,
      availableThemes,
      hasSeasonalAppearance,
      seasonalEnabled,
      appearanceTooltip,
      preview,
      heavy,
      isMobile,
      reducedMotion,
      pageVisible,
      toggleAppearance,
      setPreference,
      refresh,
      stopPreview,
    ],
  );

  // Одноразовый canvas при входе на страницу / смене вкладки приложения.
  const showEffects =
    Boolean(effectiveTheme)
    && effectIntensity !== "off"
    && !heavy
    && !reducedMotion;

  return (
    <SeasonalThemeContext.Provider value={value}>
      {children}
      {showEffects ? (
        <SeasonalThemeEffects
          theme={effectiveTheme}
          intensity={effectIntensity}
          isMobile={isMobile}
        />
      ) : null}
      {effectiveTheme && !heavy ? (
        <SeasonalThemeDecorations
          decorations={effectiveTheme.decorations || []}
          intensity={intensity}
          isMobile={isMobile}
          animationsEnabled={Boolean(effectiveTheme) && intensity !== "off" && pageVisible}
          pathname={pathname}
        />
      ) : null}
      {preview?.active ? (
        <SeasonalPreviewBanner
          themeName={preview.theme_name || theme?.name || "тема"}
          onStop={stopPreview}
        />
      ) : null}
      {!heavy && hasSeasonalAppearance ? <SeasonalAppearanceFab /> : null}
    </SeasonalThemeContext.Provider>
  );
}

export function useSeasonalTheme() {
  const ctx = useContext(SeasonalThemeContext);
  if (!ctx) {
    return {
      loading: false,
      theme: null,
      rawTheme: null,
      mode: "auto",
      animationsEnabled: true,
      openAppearancePanel: () => {},
      closeAppearancePanel: () => {},
      toggleAppearance: async () => null,
      setPreference: async () => null,
      availableThemes: [],
      hasSeasonalAppearance: false,
      seasonalEnabled: false,
      appearanceTooltip: "Оформление",
      preview: { active: false },
      userCanDisable: true,
    };
  }
  return ctx;
}

export default SeasonalThemeProvider;
