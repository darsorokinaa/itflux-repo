import { useState } from "react";
import { useSeasonalTheme } from "./SeasonalThemeProvider";

/**
 * Плавающая кнопка оформления: подсказка при наведении, по клику — вкл/выкл темы на сутки.
 */
export default function SeasonalAppearanceFab({ hidden = false }) {
  const {
    toggleAppearance,
    appearanceTooltip,
    seasonalEnabled,
    loading,
    hasSeasonalAppearance,
    rawTheme,
    theme,
  } = useSeasonalTheme();
  const [busy, setBusy] = useState(false);

  if (hidden || loading || !hasSeasonalAppearance) return null;

  const fabTheme = rawTheme || theme;
  const iconUrl = fabTheme?.button_icon_url || null;
  const emoji = (fabTheme?.button_emoji || "✦").trim() || "✦";
  const tip = appearanceTooltip || "Оформление";

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await toggleAppearance();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`seasonal-appearance-fab${seasonalEnabled ? " seasonal-appearance-fab--on" : " seasonal-appearance-fab--off"}`}
      onClick={onClick}
      disabled={busy}
      aria-label={tip}
      aria-pressed={seasonalEnabled}
      data-tooltip={tip}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="seasonal-appearance-fab__img" draggable={false} />
      ) : (
        <span className="seasonal-appearance-fab__fallback" aria-hidden="true">{emoji}</span>
      )}
    </button>
  );
}
