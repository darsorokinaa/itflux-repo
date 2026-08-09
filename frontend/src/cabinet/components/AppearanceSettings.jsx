import { useEffect, useId, useState } from "react";
import {
  backgroundPreviewStyle,
  compressBackgroundImage,
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
} from "../interactiveAppearance";
import {
  INTERACTIVE_SOUND_EVENTS,
  isInteractiveSoundPreviewPlaying,
  previewInteractiveSound,
  readInteractiveSoundFile,
  stopInteractiveSoundPreview,
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
      title={item.name}
    >
      <span className="ix-appearance__swatch" style={style}>
        {selected ? <span className="ix-appearance__check" aria-hidden="true">✓</span> : null}
      </span>
      <span className="ix-appearance__label">{item.name}</span>
    </button>
  );
}

function CustomBackgroundOption({ selected, imageUrl, inputId }) {
  return (
    <button
      type="button"
      className={`ix-appearance__option ix-appearance__option--custom${selected ? " is-selected" : ""}`}
      onClick={() => document.getElementById(inputId)?.click()}
      aria-pressed={selected}
      title="Свой фон"
    >
      <span
        className="ix-appearance__swatch ix-appearance__swatch--custom"
        style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
      >
        {!imageUrl ? <span className="ix-appearance__swatch-plus">+</span> : null}
        {selected ? <span className="ix-appearance__check" aria-hidden="true">✓</span> : null}
      </span>
      <span className="ix-appearance__label">Свой фон</span>
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
      title={item.name}
    >
      <span className={`ix-appearance__card-preview ${item.css_class}`}>
        {selected ? <span className="ix-appearance__check" aria-hidden="true">✓</span> : "Aa"}
      </span>
    </button>
  );
}

function SoundPackCard({
  item,
  selected,
  playing,
  onSelect,
  onTogglePreview,
}) {
  const hasBackgroundTrack = Boolean(item?.sounds?.background);
  return (
    <div className={`ix-appearance__sound-card${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className="ix-appearance__sound-card__main"
        onClick={onSelect}
        aria-pressed={selected}
      >
        <span className="ix-appearance__sound-card__title">{item.name}</span>
        {item.description ? (
          <span className="ix-appearance__sound-card__desc">{item.description}</span>
        ) : null}
        {hasBackgroundTrack ? (
          <span className="ix-appearance__sound-card__badge">Трек с сервера</span>
        ) : (
          <span className="ix-appearance__sound-card__badge ix-appearance__sound-card__badge--synth">
            Синтез эффектов
          </span>
        )}
      </button>
      <button
        type="button"
        className="ix-appearance__sound-card__play"
        aria-label={playing ? "Пауза" : "Прослушать"}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePreview();
        }}
      >
        {playing ? "❚❚" : "▶"}
      </button>
    </div>
  );
}

function SoundFileRow({ event, value, onUpload, onRemove, onPreview }) {
  const inputId = useId();

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

export default function AppearanceSettings({
  data,
  onChange,
  compact = false,
  showTitle = true,
  showBackground = true,
  showCardStyles = true,
  showSounds = true,
  catalog: catalogProp = null,
  catalogLoading = false,
}) {
  const hook = useInteractiveAppearanceCatalog();
  const catalog = catalogProp || hook.catalog;
  const loading = catalogProp ? catalogLoading : hook.loading;
  const appearance = resolveInteractiveAppearance(data, catalog);
  const [soundError, setSoundError] = useState("");
  const [bgError, setBgError] = useState("");
  const [previewSlug, setPreviewSlug] = useState("");
  const customBgInputId = useId();
  const hasCustomBg = Boolean(data.backgroundImage);

  useEffect(() => () => stopInteractiveSoundPreview(), []);

  const setSlug = (field, slug) => onChange(field, slug);

  const handleLibraryBackground = (slug) => {
    setSlug("backgroundSlug", slug);
    if (data.backgroundImage) onChange("backgroundImage", null);
  };

  const handleCustomBackground = async (file) => {
    try {
      setBgError("");
      const dataUrl = await compressBackgroundImage(file);
      onChange("backgroundImage", dataUrl);
      onChange("backgroundImageTone", data.backgroundImageTone || "light");
    } catch (err) {
      setBgError(err?.message || "Не удалось загрузить фон");
    }
  };

  const soundPacks = (catalog.sound_packs || []).filter((item) => item.slug !== "silent");

  const selectSoundPack = (slug) => {
    onChange("soundEnabled", true);
    onChange("soundPackSlug", slug);
  };

  const togglePackPreview = (pack) => {
    const eventName = pack?.sounds?.background ? "background" : "flip";
    const result = previewInteractiveSound(pack, eventName);
    if (result === "playing") setPreviewSlug(pack.slug);
    else if (result === "paused") setPreviewSlug("");
    else {
      setPreviewSlug(pack.slug);
      window.setTimeout(() => {
        setPreviewSlug((cur) => (cur === pack.slug ? "" : cur));
      }, 400);
    }
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
      {showTitle ? (
        !compact ? (
          <h2 className="cb-interactive-editor__section-title">Оформление и звук</h2>
        ) : (
          <h3 className="ix-appearance__section-title ix-appearance__section-title--lead">Оформление и звук</h3>
        )
      ) : null}

      {showBackground ? (
        <section>
          <h3 className="ix-appearance__section-title">Фон</h3>
          {loading ? <p className="ix-bg-upload-hint">Загрузка фонов с сервера…</p> : null}
          {!loading && catalog.backgrounds.length === 0 && !hasCustomBg ? (
            <p className="ix-bg-upload-hint">Нет фонов в каталоге. Добавьте их в админке или загрузите свой.</p>
          ) : null}
          <div className="ix-appearance__grid ix-appearance__grid--tiles">
            {catalog.backgrounds.map((item) => (
              <BackgroundOption
                key={item.slug}
                item={item}
                selected={!hasCustomBg && appearance.background?.slug === item.slug}
                onSelect={handleLibraryBackground}
              />
            ))}
            <CustomBackgroundOption
              selected={hasCustomBg}
              imageUrl={data.backgroundImage}
              inputId={customBgInputId}
            />
          </div>
          <input
            id={customBgInputId}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="ix-bg-upload-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCustomBackground(file);
              e.target.value = "";
            }}
          />
          {hasCustomBg ? (
            <div className="ix-appearance__custom-bg-tools">
              <label className="ix-ed-field ix-ed-field--inline">
                <span>Тон текста на фоне</span>
                <select
                  value={data.backgroundImageTone || "light"}
                  onChange={(e) => onChange("backgroundImageTone", e.target.value)}
                >
                  <option value="light">Светлый текст</option>
                  <option value="dark">Тёмный текст</option>
                </select>
              </label>
              <button
                type="button"
                className="cb-btn cb-btn--ghost cb-btn--sm"
                onClick={() => onChange("backgroundImage", null)}
              >
                Убрать свой фон
              </button>
            </div>
          ) : null}
          <label className="ix-appearance__toggle">
            <input
              type="checkbox"
              checked={data.params?.autoTextBackdrop !== false}
              onChange={(e) => onChange("params", {
                ...(data.params || {}),
                autoTextBackdrop: e.target.checked,
              })}
            />
            <span>Автоматическая подложка для текста</span>
          </label>
          {data.params?.autoTextBackdrop === false ? (
            <p className="ix-appearance__sound-hint ix-appearance__contrast-hint">
              Подложка отключена. При слабом контрасте текст может сливаться с фоном — проверьте предпросмотр.
            </p>
          ) : null}
          {bgError ? <p className="ix-appearance__sound-file__error">{bgError}</p> : null}
        </section>
      ) : null}

      {showCardStyles ? (
        <section>
          <h3 className="ix-appearance__section-title">Цвет карточки</h3>
          <div className="ix-appearance__grid ix-appearance__grid--swatches">
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
      ) : null}

      {showSounds ? (
        <>
          <section>
            <h3 className="ix-appearance__section-title">Фоновая музыка и звуки</h3>
            <p className="ix-appearance__sound-hint">
              Пакеты из каталога сервера. ▶ — только прослушивание, без автозапуска в редакторе.
            </p>
            {loading ? <p className="ix-bg-upload-hint">Загрузка звуков с сервера…</p> : null}
            <div className="ix-appearance__sound-row">
              <button
                type="button"
                className={`ix-appearance__sound-btn${data.soundEnabled === false ? " is-selected" : ""}`}
                onClick={() => {
                  stopInteractiveSoundPreview();
                  setPreviewSlug("");
                  onChange("soundEnabled", false);
                }}
              >
                Без музыки
              </button>
              {soundPacks.map((item) => (
                <SoundPackCard
                  key={item.slug}
                  item={item}
                  selected={data.soundEnabled !== false && appearance.soundPack?.slug === item.slug}
                  playing={
                    previewSlug === item.slug
                    || isInteractiveSoundPreviewPlaying(item?.sounds?.background)
                  }
                  onSelect={() => selectSoundPack(item.slug)}
                  onTogglePreview={() => togglePackPreview(item)}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="ix-appearance__section-title">Свои звуки</h3>
            <p className="ix-appearance__sound-hint">
              mp3, wav, ogg — до 600 КБ. Перекрывают звук пакета. Можно загрузить свой фоновый трек.
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
        </>
      ) : null}
    </div>
  );
}
