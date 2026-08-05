import { useState } from "react";
import { useSeasonalTheme } from "./SeasonalThemeProvider";

export default function SeasonalAppearancePanel({ onClose }) {
  const {
    preferenceMode,
    animationsEnabled,
    availableThemes,
    userCanDisable,
    setPreference,
    theme,
    rawTheme,
  } = useSeasonalTheme();
  const selectedTheme = rawTheme || theme;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const apply = async (patch) => {
    setBusy(true);
    setErr("");
    try {
      await setPreference(patch);
    } catch (e) {
      setErr(e?.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="seasonal-appearance-overlay" role="presentation" onClick={onClose}>
      <aside
        className="seasonal-appearance-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="seasonal-appearance-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="seasonal-appearance-panel__head">
          <h2 id="seasonal-appearance-title">Оформление</h2>
          <button type="button" className="seasonal-appearance-panel__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className="seasonal-appearance-panel__body">
          <p className="seasonal-appearance-panel__hint">
            Праздничные темы включаются автоматически по датам. Можно оставить авторежим,
            выбрать обычное оформление или доступную тему вручную.
          </p>

          <fieldset className="seasonal-appearance-fieldset" disabled={busy}>
            <legend>Тема</legend>
            <label className="seasonal-appearance-option">
              <input
                type="radio"
                name="seasonal-mode"
                checked={preferenceMode === "auto"}
                onChange={() => apply({ mode: "auto" })}
              />
              <span>
                Автоматически
                {selectedTheme && preferenceMode === "auto" ? (
                  <em className="seasonal-appearance-option__meta"> — {selectedTheme.name}</em>
                ) : null}
              </span>
            </label>
            {userCanDisable ? (
              <label className="seasonal-appearance-option">
                <input
                  type="radio"
                  name="seasonal-mode"
                  checked={preferenceMode === "default"}
                  onChange={() => apply({ mode: "default" })}
                />
                <span>Обычное оформление</span>
              </label>
            ) : null}
            {(availableThemes || []).map((item) => (
              <label key={item.id} className="seasonal-appearance-option">
                <input
                  type="radio"
                  name="seasonal-mode"
                  checked={preferenceMode === "manual" && selectedTheme?.id === item.id}
                  onChange={() =>
                    apply({ mode: "manual", selected_theme_id: item.id })
                  }
                />
                <span>{item.name}</span>
              </label>
            ))}
          </fieldset>

          <label className="seasonal-appearance-toggle">
            <input
              type="checkbox"
              checked={animationsEnabled}
              disabled={busy}
              onChange={(e) => apply({ animations_enabled: e.target.checked })}
            />
            <span>Показывать анимацию</span>
          </label>

          {err ? <p className="seasonal-appearance-error">{err}</p> : null}
        </div>
      </aside>
    </div>
  );
}
