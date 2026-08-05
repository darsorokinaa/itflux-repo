import { useState } from "react";
import { useSeasonalTheme } from "./SeasonalThemeProvider";

/**
 * Плавающие кнопки оформления: по одной на каждую тему текущего периода.
 * Подсказка при наведении; клик — вкл/выкл (или переключение) темы на сутки.
 */
export default function SeasonalAppearanceFab({ hidden = false }) {
  const {
    toggleAppearance,
    loading,
    hasSeasonalAppearance,
    periodThemes,
    availableThemes,
    rawTheme,
    theme,
    seasonalEnabled,
  } = useSeasonalTheme();
  const [busyId, setBusyId] = useState(null);

  if (hidden || loading || !hasSeasonalAppearance) return null;

  const current = rawTheme || theme;
  let fabThemes = Array.isArray(periodThemes) ? periodThemes : [];
  if (!fabThemes.length && Array.isArray(availableThemes) && availableThemes.length) {
    fabThemes = availableThemes;
  }
  if (!fabThemes.length && current) {
    fabThemes = [
      {
        id: current.id,
        name: current.name,
        slug: current.slug,
        button_icon_url: current.button_icon_url,
        button_emoji: current.button_emoji,
        allow_user_disable: true,
      },
    ];
  }
  if (!fabThemes.length) return null;

  const activeId =
    seasonalEnabled && current?.id != null ? Number(current.id) : null;

  const onClick = async (item) => {
    if (busyId != null) return;
    setBusyId(item.id);
    try {
      await toggleAppearance(item.id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="seasonal-appearance-fab-dock" role="group" aria-label="Сезонное оформление">
      {fabThemes.map((item) => {
        const isOn = activeId != null && Number(item.id) === activeId;
        const iconUrl = item.button_icon_url || null;
        const emoji = (item.button_emoji || "✦").trim() || "✦";
        const tip = isOn
          ? (item.name ? `Тема: ${item.name}` : "Сезонное оформление")
          : (item.name ? `Включить: ${item.name}` : "Сезонное оформление");
        const busy = busyId === item.id;

        return (
          <button
            key={item.id}
            type="button"
            className={`seasonal-appearance-fab${isOn ? " seasonal-appearance-fab--on" : " seasonal-appearance-fab--off"}`}
            onClick={() => onClick(item)}
            disabled={busyId != null}
            aria-label={tip}
            aria-pressed={isOn}
            data-tooltip={tip}
          >
            {iconUrl ? (
              <img src={iconUrl} alt="" className="seasonal-appearance-fab__img" draggable={false} />
            ) : (
              <span className="seasonal-appearance-fab__fallback" aria-hidden="true">{emoji}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
