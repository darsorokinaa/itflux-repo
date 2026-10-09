import { useCallback, useEffect, useId, useState } from "react";
import { fetchAvailableVariantThemes } from "./variantThemeApi";
import { TravelMiniMap } from "./TravelMarks";
import "./variant-themes.css";

const HINT_KEY = "itflux.variant-theme.hint.v1";

function hintWasDismissed() {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

function persistHintDismissed() {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* ignore */
  }
}

function sameThemeId(left, right) {
  if (left == null || right == null || left === "") return false;
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && a === b;
}

function ThemeCardPreview({ theme }) {
  const slug = String(theme.slug || theme.layout_type || "");
  if (slug === "travel" || theme.layout_type === "route") {
    return (
      <span className="variant-theme-selector__preview variant-theme-selector__preview--travel">
        <TravelMiniMap />
      </span>
    );
  }
  if (theme.preview_image_url) {
    return <img className="variant-theme-selector__preview" src={theme.preview_image_url} alt="" />;
  }
  return <span className="variant-theme-selector__preview" />;
}

export default function VariantThemeSelector({
  value = null,
  onChange,
  disabled = false,
  compact = false,
  showHint = false,
}) {
  const radioName = useId();
  const [themes, setThemes] = useState([]);
  const [canSelect, setCanSelect] = useState(false);
  const [mode, setMode] = useState(value ? "thematic" : "classic");
  const [hintDismissed, setHintDismissed] = useState(() => hintWasDismissed());

  useEffect(() => {
    let cancelled = false;
    fetchAvailableVariantThemes()
      .then((data) => {
        if (cancelled) return;
        setCanSelect(Boolean(data?.can_select_variant_theme));
        setThemes(Array.isArray(data?.themes) ? data.themes : []);
      })
      .catch(() => {
        if (!cancelled) {
          setCanSelect(false);
          setThemes([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMode(value ? "thematic" : "classic");
  }, [value]);

  const dismissHint = useCallback(() => {
    persistHintDismissed();
    setHintDismissed(true);
  }, []);

  const hintOpen = Boolean(showHint && canSelect && !hintDismissed);

  if (!canSelect) return null;

  const selectedId = value == null || value === "" ? null : Number(value);
  const pickTheme = (themeId, theme = null) => {
    dismissHint();
    onChange?.(themeId, theme);
  };

  return (
    <section
      className={`variant-theme-selector${compact ? " variant-theme-selector--compact" : ""}${hintOpen ? " is-hinting" : ""}`}
    >
      <div className="variant-theme-selector__head">
        <h2 className="variant-theme-selector__legend">Оформление</h2>
        <div className="variant-theme-selector__switch" role="radiogroup" aria-label="Оформление варианта">
          <label className={`variant-theme-selector__pill${mode === "classic" ? " is-active" : ""}`}>
            <input
              type="radio"
              name={radioName}
              checked={mode === "classic"}
              disabled={disabled}
              onChange={() => {
                setMode("classic");
                pickTheme(null, null);
              }}
            />
            Классическое
          </label>
          <label className={`variant-theme-selector__pill${mode === "thematic" ? " is-active" : ""}`}>
            <input
              type="radio"
              name={radioName}
              checked={mode === "thematic"}
              disabled={disabled}
              onChange={() => {
                setMode("thematic");
                if (!Number.isFinite(selectedId) && themes[0]) pickTheme(themes[0].id, themes[0]);
                else dismissHint();
              }}
            />
            Тематическое
          </label>
        </div>
      </div>
      {hintOpen ? (
        <div className="variant-theme-selector__hint" role="status">
          <p className="variant-theme-selector__hint-text">
            Можно выбрать оформление — классическое или тематическое.
          </p>
          <button
            type="button"
            className="variant-theme-selector__hint-close"
            onClick={dismissHint}
          >
            Понятно
          </button>
        </div>
      ) : null}
      {mode === "thematic" ? (
        <div className="variant-theme-selector__grid">
          {themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`variant-theme-selector__card${sameThemeId(selectedId, theme.id) ? " is-selected" : ""}`}
              aria-pressed={sameThemeId(selectedId, theme.id)}
              onClick={(event) => {
                event.stopPropagation();
                pickTheme(theme.id, theme);
              }}
              disabled={disabled}
            >
              <ThemeCardPreview theme={theme} />
              <span className="variant-theme-selector__name">{theme.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
