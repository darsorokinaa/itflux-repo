import {
  backgroundImageStyle,
  interactiveMediaUrl,
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
} from "../interactiveAppearance";
import { previewInteractiveSound } from "../interactiveSounds";
import "../styles/interactive-appearance.css";

function BackgroundOption({ item, selected, onSelect }) {
  const imageUrl = interactiveMediaUrl(item.background_image_url);
  const style = imageUrl
    ? backgroundImageStyle(item.background_image_url, item.text_tone === "light" ? "light" : "dark")
    : item.slug === "grid-blue"
      ? {
          background: item.css_background,
          backgroundSize: "16px 16px, 16px 16px, auto",
        }
      : { background: item.css_background };

  return (
    <button
      type="button"
      className={`ix-appearance__option${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(item.slug)}
      aria-pressed={selected}
    >
      <span className="ix-appearance__swatch" style={style} />
      <span className="ix-appearance__label">{item.name}</span>
    </button>
  );
}

function CardStyleOption({ item, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`ix-appearance__option${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(item.slug)}
      aria-pressed={selected}
    >
      <span className={`ix-appearance__card-preview ${item.css_class}`}>
        Aa
      </span>
      <span className="ix-appearance__label">{item.name}</span>
    </button>
  );
}

export default function AppearanceSettings({ data, onChange }) {
  const { catalog } = useInteractiveAppearanceCatalog();
  const appearance = resolveInteractiveAppearance(data, catalog);

  const setSlug = (field, slug) => onChange(field, slug);

  const handleSoundPack = (slug) => {
    onChange("soundPackSlug", slug);
    const pack = catalog.sound_packs.find((item) => item.slug === slug);
    previewInteractiveSound(pack);
  };

  return (
    <div className="ix-appearance cb-interactive-editor__common">
      <h2 className="cb-interactive-editor__section-title">Оформление и звук</h2>

      <section>
        <h3 className="ix-appearance__section-title">Фон</h3>
        <div className="ix-appearance__grid">
          {catalog.backgrounds.map((item) => (
            <BackgroundOption
              key={item.slug}
              item={item}
              selected={appearance.background?.slug === item.slug}
              onSelect={(slug) => setSlug("backgroundSlug", slug)}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="ix-appearance__section-title">Карточки и поля</h3>
        <div className="ix-appearance__grid">
          {catalog.card_styles.map((item) => (
            <CardStyleOption
              key={item.slug}
              item={item}
              selected={appearance.cardStyle?.slug === item.slug}
              onSelect={(slug) => setSlug("cardStyleSlug", slug)}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="ix-appearance__section-title">Звук</h3>
        <div className="ix-appearance__sound-row">
          {catalog.sound_packs.map((item) => (
            <button
              key={item.slug}
              type="button"
              className={`ix-appearance__sound-btn${
                appearance.soundPack?.slug === item.slug ? " is-selected" : ""
              }`}
              onClick={() => handleSoundPack(item.slug)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <label className="ix-appearance__toggle">
          <input
            type="checkbox"
            checked={data.soundEnabled !== false}
            onChange={(e) => onChange("soundEnabled", e.target.checked)}
          />
          <span>Звук</span>
        </label>
      </section>
    </div>
  );
}
