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
  fetchSeasonalThemeCurrent,
  isHeavyRoute,
  readGuestPreference,
  resolveDeviceIntensity,
  themeAppliesToRoute,
  updateSeasonalThemePreference,
  writeGuestPreference,
  stopSeasonalThemePreview,
} from "./seasonalThemeApi";
import SeasonalThemeEffects from "./SeasonalThemeEffects";
import SeasonalThemeDecorations from "./SeasonalThemeDecorations";
import SeasonalAppearancePanel from "./SeasonalAppearancePanel";
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

export function SeasonalThemeProvider({ children }) {
  const { pathname } = useLocation();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => detectMobile());
  const [reducedMotion, setReducedMotion] = useState(() => detectReducedMotion());
  const [isLowEnd, setIsLowEnd] = useState(() => detectLowEnd());
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const syncedGuestRef = useRef(false);
  const abortRef = useRef(null);

  const refresh = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const guestPref = readGuestPreference();
      const data = await fetchSeasonalThemeCurrent(guestPref);
      if (ctrl.signal.aborted) return data;
      setPayload(data);
      setError(null);
      return data;
    } catch (err) {
      if (ctrl.signal.aborted) return null;
      setError(err);
      // Fallback: не ломаем UI — просто без темы
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

  // Синхронизация guest localStorage → сервер после авторизации
  useEffect(() => {
    if (syncedGuestRef.current) return;
    if (!payload) return;
    // Если API вернул preference_mode и пользователь авторизован — guest уже не нужен.
    // Пытаемся один раз запушить guest prefs, если они отличаются от auto.
    const guest = readGuestPreference();
    if (!guest) {
      syncedGuestRef.current = true;
      return;
    }
    const serverMode = payload.preference_mode || payload.mode;
    if (serverMode === "auto" && guest.mode === "auto" && guest.animations_enabled !== false) {
      syncedGuestRef.current = true;
      return;
    }
    // Если текущий ответ уже отражает guest (гость) — ок
    if (payload.mode === guest.mode && !payload.preference_mode) {
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
        // Не авторизован — оставляем guest
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
  const applies = themeAppliesToRoute(theme, pathname);
  const heavy = isHeavyRoute(pathname);
  const effectiveTheme = applies ? theme : null;
  const availableThemes = payload?.available_themes || [];
  /** Есть что выбирать / отключать — иначе кнопку оформления не показываем. */
  const hasSeasonalAppearance =
    !loading
    && (availableThemes.length > 0 || Boolean(effectiveTheme) || Boolean(preview?.active));

  const intensity = resolveDeviceIntensity(effectiveTheme?.animation?.intensity, {
    isMobile,
    prefersReducedMotion: reducedMotion,
    animationsEnabled: animationsEnabled && !heavy && pageVisible,
  });

  const allowBackgroundPattern =
    Boolean(effectiveTheme?.background?.pattern_url)
    && !(isLowEnd && effectiveTheme?.background?.disable_on_low_end);

  useEffect(() => {
    const root = document.documentElement;
    if (!effectiveTheme) {
      root.classList.remove("seasonal-theme-active");
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
    root.setAttribute("data-seasonal-theme", effectiveTheme.slug || "");
    return () => {
      cleanup();
      root.classList.remove("seasonal-theme-active");
      root.removeAttribute("data-seasonal-theme");
    };
  }, [effectiveTheme, allowBackgroundPattern]);

  const setPreference = useCallback(async (patch) => {
    writeGuestPreference({
      mode: patch.mode ?? payload?.preference_mode ?? payload?.mode ?? "auto",
      selected_theme_id: patch.selected_theme_id ?? null,
      animations_enabled:
        patch.animations_enabled !== undefined
          ? patch.animations_enabled
          : payload?.animations_enabled !== false,
    });
    try {
      const next = await updateSeasonalThemePreference(patch);
      setPayload(next);
      clearGuestPreference();
      return next;
    } catch (err) {
      // Гость или сеть: сохраняем localStorage и перезапрашиваем current с query
      if (err?.status === 401 || err?.status === 403) {
        const guest = {
          mode: patch.mode ?? payload?.preference_mode ?? payload?.mode ?? "auto",
          selected_theme_id: patch.selected_theme_id ?? null,
          animations_enabled:
            patch.animations_enabled !== undefined
              ? patch.animations_enabled
              : payload?.animations_enabled !== false,
        };
        writeGuestPreference(guest);
        const next = await fetchSeasonalThemeCurrent(guest);
        if (next) setPayload(next);
        return next;
      }
      throw err;
    }
  }, [payload, refresh]);

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
      preferenceMode: payload?.preference_mode || payload?.mode || "auto",
      animationsEnabled,
      intensity,
      userCanDisable: payload?.user_can_disable !== false,
      availableThemes,
      hasSeasonalAppearance,
      preview,
      isHeavyRoute: heavy,
      isMobile,
      reducedMotion,
      pageVisible,
      panelOpen,
      openAppearancePanel: () => setPanelOpen(true),
      closeAppearancePanel: () => setPanelOpen(false),
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
      animationsEnabled,
      intensity,
      preview,
      availableThemes,
      hasSeasonalAppearance,
      heavy,
      isMobile,
      reducedMotion,
      pageVisible,
      panelOpen,
      setPreference,
      refresh,
      stopPreview,
    ],
  );

  const showEffects =
    Boolean(effectiveTheme)
    && intensity !== "off"
    && pageVisible
    && !heavy
    && !reducedMotion;

  return (
    <SeasonalThemeContext.Provider value={value}>
      {allowBackgroundPattern ? (
        <div className="seasonal-page-pattern-layer" aria-hidden="true" />
      ) : null}
      {children}
      {showEffects ? (
        <SeasonalThemeEffects
          theme={effectiveTheme}
          intensity={intensity}
          isMobile={isMobile}
        />
      ) : null}
      {effectiveTheme && !heavy ? (
        <SeasonalThemeDecorations
          decorations={effectiveTheme.decorations || []}
          intensity={intensity}
          isMobile={isMobile}
          animationsEnabled={showEffects}
          pathname={pathname}
        />
      ) : null}
      {preview?.active ? (
        <SeasonalPreviewBanner
          themeName={preview.theme_name || effectiveTheme?.name || "тема"}
          onStop={stopPreview}
        />
      ) : null}
      {!heavy && !panelOpen && hasSeasonalAppearance ? <SeasonalAppearanceFab /> : null}
      {panelOpen && hasSeasonalAppearance ? (
        <SeasonalAppearancePanel onClose={() => setPanelOpen(false)} />
      ) : null}
    </SeasonalThemeContext.Provider>
  );
}

export function useSeasonalTheme() {
  const ctx = useContext(SeasonalThemeContext);
  if (!ctx) {
    return {
      loading: false,
      theme: null,
      mode: "auto",
      animationsEnabled: true,
      openAppearancePanel: () => {},
      closeAppearancePanel: () => {},
      setPreference: async () => null,
      availableThemes: [],
      hasSeasonalAppearance: false,
      preview: { active: false },
      userCanDisable: true,
    };
  }
  return ctx;
}

export default SeasonalThemeProvider;
