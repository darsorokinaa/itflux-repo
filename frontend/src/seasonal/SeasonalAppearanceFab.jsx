import { useSeasonalTheme } from "./SeasonalThemeProvider";

/**
 * Плавающая кнопка «Оформление» в левом нижнем углу.
 * Иконка берётся из темы (button_icon), иначе — запасная ★.
 */
export default function SeasonalAppearanceFab({ hidden = false }) {
  const { openAppearancePanel, theme, loading, hasSeasonalAppearance } = useSeasonalTheme();

  if (hidden || loading || !hasSeasonalAppearance) return null;

  const iconUrl = theme?.button_icon_url || null;
  const emoji = (theme?.button_emoji || "✦").trim() || "✦";
  const label = "Оформление";

  return (
    <button
      type="button"
      className="seasonal-appearance-fab"
      onClick={openAppearancePanel}
      aria-label={label}
      title={label}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="seasonal-appearance-fab__img" draggable={false} />
      ) : (
        <span className="seasonal-appearance-fab__fallback" aria-hidden="true">{emoji}</span>
      )}
    </button>
  );
}
