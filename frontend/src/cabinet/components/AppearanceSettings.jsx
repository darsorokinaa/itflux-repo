import { useState } from "react";
import {
  backgroundPreviewStyle,
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
} from "../interactiveAppearance";
import {
  INTERACTIVE_SOUND_EVENTS,
  previewInteractiveSound,
  readInteractiveSoundFile,
} from "../interactiveSounds";
import "../styles/interactive-appearance.css";

function BackgroundOption({ item, selected, onSelect }) {
  const style = backgroundPreviewStyle(item);

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

function SoundFileRow({ event, value, onUpload, onRemove, onPreview }) {
  const inputId = `ix-sound-${event.id}`;

  return (
    <div className="ix-appearance__sound-file">
      <div className="ix-appearance__sound-file__meta">
        <label className="ix-appearance__sound-file__label" htmlFor={inputId}>
          {event.label}
        </label>
        {value ? (
          <span className="ix-appearance__sound-file__status">Файл загружен</span>
        ) : (
          <span className="ix-appearance__sound-file__status ix-appearance__sound-file__status--empty">
            Синтез пакета
          </span>
        )}
      </div>
      <div className="ix-appearance__sound-file__actions">
        <input
          id={inputId}
          type="file"
          accept="audio/mpeg,audio/wav,audio/ogg,audio/webm,.mp3,.wav,.ogg,.webm"
          className="ix-bg-upload-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload?.(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="cb-btn cb-btn--outline cb-btn--sm"
          onClick={() => document.getElementById(inputId)?.click()}
        >
          {value ? "Заменить" : "Файл"}
        </button>
        {value ? (
          <>
            <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={onPreview}>
              ▶
            </button>
            <button type="button" className="cb-btn cb-btn--ghost cb-btn--sm" onClick={onRemove}>
              Убрать
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function AppearanceSettings({ data, onChange, compact = false }) {
  const { catalog } = useInteractiveAppearanceCatalog();
  const appearance = resolveInteractiveAppearance(data, catalog);
  const [soundError, setSoundError] = useState("");

  const setSlug = (field, slug) => onChange(field, slug);

  const handleSoundPack = (slug) => {
    onChange("soundPackSlug", slug);
    const pack = catalog.sound_packs.find((item) => item.slug === slug);
    previewInteractiveSound(pack, "flip");
  };

  const customSounds = data.customSounds || {};

  const setCustomSound = (eventId, url) => {
    onChange("customSounds", { ...customSounds, [eventId]: url });
  };

  const removeCustomSound = (eventId) => {
    const next = { ...customSounds };
    delete next[eventId];
    onChange("customSounds", next);
  };

  const handleSoundUpload = async (eventId, file) => {
    try {
      setSoundError("");
      const dataUrl = await readInteractiveSoundFile(file);
      setCustomSound(eventId, dataUrl);
    } catch (err) {
      setSoundError(err?.message || "Не удалось загрузить звук");
    }
  };

  const previewCustomSound = (eventId) => {
    if (!customSounds[eventId]) return;
    previewInteractiveSound({
      soundEnabled: true,
      soundPack: { slug: "custom", sounds: {}, config: {} },
      customSounds: { [eventId]: customSounds[eventId] },
    }, eventId);
  };

  return (
    <div className={`ix-appearance${compact ? " ix-appearance--compact" : " cb-interactive-editor__common"}`}>
      {!compact ? (
        <h2 className="cb-interactive-editor__section-title">Оформление и звук</h2>
      ) : (
        <h3 className="ix-appearance__section-title ix-appearance__section-title--lead">Оформление и звук</h3>
      )}

      <section>
        <h3 className="ix-appearance__section-title">Фон</h3>
        {catalog.backgrounds.length === 0 ? (
          <p className="ix-bg-upload-hint">Нет фонов в каталоге. Добавьте их в админке.</p>
        ) : (
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
        )}
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
        <h3 className="ix-appearance__section-title">Звуковой пакет</h3>
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
              {item.sounds && Object.keys(item.sounds).length > 0 ? (
                <small> · файлы</small>
              ) : null}
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

      <section>
        <h3 className="ix-appearance__section-title">Свои звуки</h3>
        <p className="ix-appearance__sound-hint">
          mp3, wav, ogg — до 600 КБ. Перекрывают звук пакета для этого интерактива.
        </p>
        {soundError ? <p className="ix-appearance__sound-file__error">{soundError}</p> : null}
        <div className="ix-appearance__sound-files">
          {INTERACTIVE_SOUND_EVENTS.map((event) => (
            <SoundFileRow
              key={event.id}
              event={event}
              value={customSounds[event.id]}
              onUpload={(file) => handleSoundUpload(event.id, file)}
              onRemove={() => removeCustomSound(event.id)}
              onPreview={() => previewCustomSound(event.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
