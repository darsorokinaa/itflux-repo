import { useMemo, useState } from "react";
import {
  appearancePageClass,
  appearancePageStyle,
  resolveInteractiveAppearance,
} from "../interactiveAppearance";
import { QuizStudentPreview } from "./QuizPlayer";
import WheelVisual from "./WheelVisual";
import { computeInteractiveFillProgress } from "../interactivesEditorUtils";
import "../styles/interactive-wheel.css";

function PreviewImage({ src, alt, className }) {
  const value = String(src || "").trim();
  if (!value) return null;
  return <img src={value} alt={alt} className={className} loading="lazy" />;
}

function FlashcardStudentPreview({ cards, appearance }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const list = cards.filter((c) => (c.front || "").trim() || (c.back || "").trim());
  const total = list.length || 1;
  const card = list[index] || { front: "", back: "", hint: "" };
  const cardClass = appearance?.cardStyle?.css_class || "";

  const goPrev = () => {
    setFlipped(false);
    setIndex((i) => (i - 1 + total) % total);
  };
  const goNext = () => {
    setFlipped(false);
    setIndex((i) => (i + 1) % total);
  };

  return (
    <>
      <div className={`ix-ed-preview-card ${cardClass}${flipped ? " is-flipped" : ""}`}>
        <div className="ix-ed-preview-card__inner">
          <p className="ix-ed-preview-card__label">{flipped ? "Ответ" : "Термин"}</p>
          <p className="ix-ed-preview-card__text">
            {flipped ? (card.back || "—") : (card.front || "—")}
          </p>
          <PreviewImage
            src={flipped ? card.back_image_url : card.front_image_url}
            alt={flipped ? "Изображение ответа" : "Изображение термина"}
            className="ix-ed-preview-media"
          />
          {!flipped && card.hint ? (
            <p className="ix-ed-preview-card__hint">Подсказка: {card.hint}</p>
          ) : null}
        </div>
      </div>
      <div className="ix-ed-preview-nav">
        <button type="button" className="ix-ed-preview-nav__btn" onClick={goPrev}>Назад</button>
        <span className="ix-ed-preview-nav__count">{Math.min(index + 1, total)} / {total}</span>
        <button
          type="button"
          className="ix-ed-preview-nav__btn ix-ed-preview-nav__btn--primary"
          onClick={() => setFlipped((v) => !v)}
        >
          {flipped ? "Термин" : "Ответ"}
        </button>
        <button type="button" className="ix-ed-preview-nav__btn" onClick={goNext}>Далее</button>
      </div>
    </>
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
  const list = (steps || []).filter((s) => s.text).slice(0, 3);
  return (
    <ol className="ix-ed-preview-steps">
      {(list.length ? list : [{ text: "—", position: 1 }]).map((step, i) => (
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
  const appearance = useMemo(
    () => resolveInteractiveAppearance(data, catalog),
    [data, catalog],
  );
  const progress = useMemo(() => computeInteractiveFillProgress(data), [data]);

  return (
    <aside className="ix-ed-preview">
      <header className="ix-ed-preview__head">
        <h2 className="ix-ed-preview__title">Предпросмотр</h2>
        <p className="ix-ed-preview__hint">Так карточку увидит ученик</p>
      </header>

      <div
        className={`ix-ed-preview__stage ${appearancePageClass(appearance)}`}
        style={appearancePageStyle(appearance)}
      >
        {data.type === "flashcards" ? (
          <FlashcardStudentPreview cards={data.cards || []} appearance={appearance} />
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
          <WheelVisual
            interactive={data}
            appearance={appearance}
            settings={data.wheelSettings}
            preview
            compact
          />
        ) : null}
      </div>

      <div className="ix-ed-progress">
        <div className="ix-ed-progress__head">
          <span>Заполнено</span>
          <strong>{progress.percent}%</strong>
        </div>
        <div className="ix-ed-progress__bar" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress.percent}%` }} />
        </div>
      </div>

      <div className="ix-ed-summary">
        <h3 className="ix-ed-summary__title">Сводка</h3>
        <ul className="ix-ed-summary__list">
          {progress.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
