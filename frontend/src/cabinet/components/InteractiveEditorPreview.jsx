import { useMemo, useState } from "react";
import {
  appearancePageClass,
  appearancePageStyle,
  resolveInteractiveAppearance,
} from "../interactiveAppearance";
import { QuizStudentPreview } from "./QuizPlayer";
import WheelVisual from "./WheelVisual";
import { getInteractiveDisplayTitle, getItemCount, getTypeMeta } from "../interactivesData";
import { computeInteractiveFillProgress } from "../interactivesEditorUtils";
import "../styles/interactive-wheel.css";

function PreviewImage({ src, alt, className }) {
  const value = String(src || "").trim();
  if (!value) return null;
  return <img src={value} alt={alt} className={className} loading="lazy" />;
}

function FlashcardStudentPreview({ cards, appearance, title }) {
  const list = (cards || []).filter(
    (c) =>
      String(c.front || "").trim()
      || String(c.back || "").trim()
      || String(c.front_image_url || "").trim()
      || String(c.back_image_url || "").trim(),
  );
  const total = Math.max(list.length, 1);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const safeIndex = Math.min(index, total - 1);
  const card = list[safeIndex] || { front: "", back: "", hint: "" };
  const cardClass = appearance?.cardStyle?.css_class || "";
  const showFrontImage = Boolean(String(card.front_image_url || "").trim())
    && !String(card.front || "").trim();
  const showBackImage = Boolean(String(card.back_image_url || "").trim())
    && !String(card.back || "").trim();

  const goPrev = () => {
    setFlipped(false);
    setIndex((i) => {
      const current = Math.min(i, total - 1);
      return (current - 1 + total) % total;
    });
  };
  const goNext = () => {
    setFlipped(false);
    setIndex((i) => {
      const current = Math.min(i, total - 1);
      return (current + 1) % total;
    });
  };

  const progressPct = list.length ? ((safeIndex + 1) / total) * 100 : 0;

  return (
    <div className="ix-preview-flash">
      {title ? <p className="ix-preview-flash__title">{title}</p> : null}
      <p className="ix-preview-flash__counter">
        {list.length ? `${safeIndex + 1} из ${total}` : "Нет карточек"}
      </p>

      <button
        type="button"
        className={`ix-preview-flip${flipped ? " is-flipped" : ""}`}
        onClick={() => setFlipped((v) => !v)}
        aria-label={flipped ? "Показать лицевую сторону" : "Перевернуть карточку"}
      >
        <div className={`ix-preview-flip__inner ${cardClass}`}>
          <div className="ix-preview-flip__face ix-preview-flip__face--front">
            {showFrontImage ? (
              <PreviewImage
                src={card.front_image_url}
                alt="Лицевая сторона"
                className="ix-preview-flip__media"
              />
            ) : (
              <p className="ix-preview-flip__text">{card.front || "Текст лицевой стороны"}</p>
            )}
            {!showFrontImage && card.front_image_url ? (
              <PreviewImage
                src={card.front_image_url}
                alt=""
                className="ix-preview-flip__media ix-preview-flip__media--secondary"
              />
            ) : null}
          </div>
          <div className="ix-preview-flip__face ix-preview-flip__face--back">
            {showBackImage ? (
              <PreviewImage
                src={card.back_image_url}
                alt="Обратная сторона"
                className="ix-preview-flip__media"
              />
            ) : (
              <p className="ix-preview-flip__text">{card.back || "Текст обратной стороны"}</p>
            )}
            {!showBackImage && card.back_image_url ? (
              <PreviewImage
                src={card.back_image_url}
                alt=""
                className="ix-preview-flip__media ix-preview-flip__media--secondary"
              />
            ) : null}
          </div>
        </div>
      </button>

      <p className="ix-preview-flash__hint">Нажмите, чтобы перевернуть</p>

      <div className="ix-preview-flash__nav">
        <button type="button" className="ix-ed-preview-nav__btn" onClick={goPrev}>
          ← Назад
        </button>
        <button type="button" className="ix-ed-preview-nav__btn ix-ed-preview-nav__btn--primary" onClick={goNext}>
          Далее →
        </button>
      </div>

      <div className="ix-preview-flash__progress" aria-hidden="true">
        <span style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}

function MatchingStudentPreview({ pairs }) {
  const pair = (pairs || []).find((p) => p.left || p.right) || { left: "—", right: "—" };
  return (
    <div className="ix-ed-preview-match">
      <span className="ix-ed-preview-match__chip">
        <span>{pair.left || "—"}</span>
        <PreviewImage src={pair.left_image_url} alt="Изображение слева" className="ix-ed-preview-chip-media" />
      </span>
      <span className="ix-ed-preview-match__dash">↔</span>
      <span className="ix-ed-preview-match__chip">
        <span>{pair.right || "—"}</span>
        <PreviewImage src={pair.right_image_url} alt="Изображение справа" className="ix-ed-preview-chip-media" />
      </span>
    </div>
  );
}

function SequenceStudentPreview({ steps }) {
  const list = (steps || []).filter((s) => s.text).slice(0, 5);
  return (
    <ol className="ix-ed-preview-steps">
      {(list.length ? list : [{ text: "Добавьте шаги последовательности", position: 1 }]).map((step, i) => (
        <li key={i}>
          <span className="ix-ed-preview-steps__num">{step.position ?? i + 1}</span>
          <div className="ix-ed-preview-steps__content">
            <span>{step.text}</span>
            <PreviewImage src={step.image_url} alt="Изображение шага" className="ix-ed-preview-chip-media" />
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function InteractiveEditorPreview({ data, catalog }) {
  const [device, setDevice] = useState("desktop");
  const appearance = useMemo(
    () => resolveInteractiveAppearance(data, catalog),
    [data, catalog],
  );
  const progress = useMemo(() => computeInteractiveFillProgress(data), [data]);
  const typeMeta = getTypeMeta(data.type);
  const title = getInteractiveDisplayTitle(data);
  const count = getItemCount(data);
  const bgName = appearance?.background?.name || "—";
  const soundName = data.soundEnabled === false
    ? "Без звука"
    : (appearance?.soundPack?.name || "—");

  return (
    <aside className="ix-ed-preview">
      <header className="ix-ed-preview__head">
        <div>
          <h2 className="ix-ed-preview__title">Предпросмотр</h2>
          <p className="ix-ed-preview__hint">Так увидит ученик</p>
        </div>
        <div className="ix-ed-segmented ix-ed-segmented--sm" role="group" aria-label="Устройство">
          <button
            type="button"
            className={`ix-ed-segmented__btn${device === "desktop" ? " is-active" : ""}`}
            aria-pressed={device === "desktop"}
            onClick={() => setDevice("desktop")}
          >
            Desktop
          </button>
          <button
            type="button"
            className={`ix-ed-segmented__btn${device === "mobile" ? " is-active" : ""}`}
            aria-pressed={device === "mobile"}
            onClick={() => setDevice("mobile")}
          >
            Mobile
          </button>
        </div>
      </header>

      <div
        className={`ix-ed-preview__stage ix-ed-preview__stage--${device} ${appearancePageClass(appearance)}`}
        style={appearancePageStyle(appearance)}
      >
        <p className="ix-ed-preview__badge">{typeMeta.label}</p>
        {data.type === "flashcards" ? (
          <FlashcardStudentPreview
            cards={data.cards || []}
            appearance={appearance}
            title={title}
          />
        ) : null}
        {data.type === "matching" ? (
          <MatchingStudentPreview pairs={data.pairs} />
        ) : null}
        {data.type === "sequence" ? (
          <SequenceStudentPreview steps={data.steps} />
        ) : null}
        {data.type === "quiz" ? (
          <QuizStudentPreview questions={data.questions} params={data.params} />
        ) : null}
        {data.type === "wheel" ? (
          <div className="ix-preview-wheel">
            <WheelVisual
              interactive={data}
              appearance={appearance}
              settings={data.wheelSettings}
              preview
            />
          </div>
        ) : null}
      </div>

      <p className="ix-ed-preview__meta">
        {typeMeta.label}
        {" · "}
        {count} элем.
        {" · "}
        {bgName}
        {" · "}
        {soundName}
        {" · "}
        {progress.percent}%
      </p>
    </aside>
  );
}
