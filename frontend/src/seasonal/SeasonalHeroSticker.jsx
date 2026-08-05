import { useCallback, useEffect, useRef, useState } from "react";
import { useSeasonalTheme } from "./SeasonalThemeProvider";
import SeasonalHistoryModal from "./SeasonalHistoryModal";

const DISMISS_KEY = "seasonal_hero_sticker_dismissed_v1";

/** Старый ключ больше не используем — стикер снова показывается при включении оформления. */
function clearLegacyDismiss() {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Бумажка-стикер слева от синего hero (клик открывает историческую справку).
 * При каждом включении оформления показывается снова; × только скрывает до следующего включения.
 */
export default function SeasonalHeroSticker() {
  const { rawTheme, theme, preferenceMode, seasonalEnabled } = useSeasonalTheme();
  const active = rawTheme || theme;
  const [dismissed, setDismissed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const wasEnabledRef = useRef(false);

  useEffect(() => {
    clearLegacyDismiss();
  }, []);

  useEffect(() => {
    if (seasonalEnabled && !wasEnabledRef.current) {
      setDismissed(false);
      setHistoryOpen(false);
    }
    wasEnabledRef.current = Boolean(seasonalEnabled);
  }, [seasonalEnabled]);

  const onDismiss = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setDismissed(true);
    setHistoryOpen(false);
  }, []);

  const openHistory = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setHistoryOpen(true);
  }, []);

  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
  }, []);

  if (!active || preferenceMode === "default" || !seasonalEnabled || dismissed) {
    return null;
  }

  const sticker = active.hero_sticker;
  const history = active.hero_history;
  if (!sticker?.title || !sticker?.text) return null;

  const canOpenHistory = Boolean(history?.title && history?.body);
  const stickerStyle = {
    ["--seasonal-sticker-bg"]: sticker.background_color || "#fff6c8",
    ["--seasonal-sticker-title"]: sticker.title_color || "#5a3d0c",
    ["--seasonal-sticker-text"]: sticker.text_color || "#4a3a1a",
  };

  return (
    <div className="seasonal-hero-sticker-cluster">
      <aside
        className={[
          "seasonal-hero-sticker",
          canOpenHistory ? "seasonal-hero-sticker--interactive" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={stickerStyle}
        aria-label={
          canOpenHistory
            ? `${sticker.title}. Открыть историческую справку`
            : sticker.title
        }
        title={canOpenHistory ? history.link_label || "Узнать историю праздника" : undefined}
        {...(canOpenHistory
          ? {
              role: "button",
              tabIndex: 0,
              onClick: openHistory,
              onKeyDown: (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  openHistory(event);
                }
              },
            }
          : {})}
      >
        <div className="seasonal-hero-sticker__tape" aria-hidden="true" />
        <button
          type="button"
          className="seasonal-hero-sticker__close"
          onClick={onDismiss}
          aria-label="Закрыть стикер"
        >
          ×
        </button>
        <p className="seasonal-hero-sticker__title">{sticker.title}</p>
        <p className="seasonal-hero-sticker__text">{sticker.text}</p>
      </aside>

      <SeasonalHistoryModal
        open={historyOpen}
        onClose={closeHistory}
        history={history}
      />
    </div>
  );
}
