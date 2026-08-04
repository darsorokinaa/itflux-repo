import { useSeasonalTheme } from "./SeasonalThemeProvider";

export default function SeasonalPreviewBanner({ themeName, onStop }) {
  return (
    <div className="seasonal-preview-banner" role="status">
      <span>Режим предпросмотра: {themeName}</span>
      <button type="button" className="seasonal-preview-banner__btn" onClick={onStop}>
        Завершить
      </button>
    </div>
  );
}

/** Кнопка открытия панели — для меню кабинета */
export function SeasonalAppearanceMenuItem({ onClick }) {
  const { openAppearancePanel } = useSeasonalTheme();
  return (
    <button
      type="button"
      role="menuitem"
      className="cabinet-header-more__item"
      onClick={() => {
        onClick?.();
        openAppearancePanel();
      }}
    >
      <span className="seasonal-appearance-menu-icon" aria-hidden="true">✦</span>
      <span>Оформление</span>
    </button>
  );
}
