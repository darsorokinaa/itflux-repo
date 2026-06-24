import { useState } from "react";
import { Link } from "react-router-dom";
import { TEMPLATE_SWITCHER, getTypeMeta } from "../interactivesData";
import { appearancePageClass, appearancePageStyle } from "../interactiveAppearance";
import InteractivePlayer from "./InteractivePlayer";

const TYPE_HELP = {
  flashcards: "Переворачивайте карточки и отмечайте, что уже знаете.",
  matching: "Соедините пары: понятие и ответ.",
  sequence: "Расставьте элементы в правильном порядке.",
};

const DEFAULT_INSTRUCTION = "Нажмите «Начать», чтобы пройти задание.";

function LaunchDecor({ type }) {
  return (
    <div className="ix-launch-hero__decor" aria-hidden="true">
      <span className="ix-launch-hero__orb ix-launch-hero__orb--1" />
      <span className="ix-launch-hero__orb ix-launch-hero__orb--2" />
      {type === "flashcards" ? (
        <>
          <span className="ix-launch-hero__float-card">AND</span>
          <span className="ix-launch-hero__float-card ix-launch-hero__float-card--2">OR</span>
        </>
      ) : null}
      {type === "matching" ? (
        <span className="ix-launch-hero__float-pair">A ↔ B</span>
      ) : null}
      {type === "sequence" ? (
        <span className="ix-launch-hero__float-steps">1 · 2 · 3</span>
      ) : null}
      <span className="ix-launch-hero__grid" />
    </div>
  );
}

export default function InteractiveLaunchScreen({
  interactive,
  appearance,
  started,
  onStart,
  fullscreenHref,
  showToolbar = true,
}) {
  const [soundOn, setSoundOn] = useState(appearance?.soundEnabled !== false);
  const [helpOpen, setHelpOpen] = useState(false);
  const typeMeta = getTypeMeta(interactive.type);
  const instruction = interactive.instruction || DEFAULT_INSTRUCTION;

  const frameClass = [
    "ix-launch-hero",
    appearancePageClass(appearance),
    started ? "ix-launch-hero--playing" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={frameClass} style={appearancePageStyle(appearance)}>
      <LaunchDecor type={interactive.type} />

      {!started ? (
        <div className="ix-launch-hero__intro">
          <p className="ix-launch-hero__type">{typeMeta.shortLabel}</p>
          <h2 className="ix-launch-hero__title">{interactive.title || "Без названия"}</h2>
          <p className="ix-launch-hero__instruction">{instruction}</p>
          <div className="ix-launch-hero__intro-actions">
            <button type="button" className="ix-launch-hero__start" onClick={onStart}>
              <span className="ix-launch-hero__start-icon" aria-hidden="true">▶</span>
              Начать
            </button>
            <button
              type="button"
              className="ix-launch-hero__help"
              aria-label="Подсказка"
              title={TYPE_HELP[interactive.type] || ""}
              onClick={() => setHelpOpen((v) => !v)}
            >
              ?
            </button>
          </div>
          {helpOpen ? (
            <p className="ix-launch-hero__help-text" role="note">{TYPE_HELP[interactive.type]}</p>
          ) : null}
        </div>
      ) : (
        <div className="ix-launch-hero__player">
          <InteractivePlayer
            interactive={interactive}
            appearance={{ ...appearance, soundEnabled: soundOn }}
            playing
          />
        </div>
      )}

      {showToolbar ? (
        <div className="ix-launch-hero__toolbar">
          <button
            type="button"
            className={`ix-launch-hero__tool${soundOn ? "" : " is-muted"}`}
            onClick={() => setSoundOn((v) => !v)}
            aria-label={soundOn ? "Выключить звук" : "Включить звук"}
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
          {fullscreenHref ? (
            <Link
              to={fullscreenHref}
              className="ix-launch-hero__tool"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Полноэкранный режим"
            >
              ⛶
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TemplateSwitcher({ activeType, onSelect }) {
  return (
    <aside className="ix-template-switcher">
      <h3 className="ix-template-switcher__title">Шаблоны</h3>
      <ul className="ix-template-switcher__list">
        {TEMPLATE_SWITCHER.map((tpl) => {
          const isActive = tpl.type === activeType;
          const disabled = !tpl.available;
          return (
            <li key={tpl.id}>
              <button
                type="button"
                className={[
                  "ix-template-switcher__item",
                  isActive ? "ix-template-switcher__item--active" : "",
                  disabled ? "ix-template-switcher__item--soon" : "",
                ].filter(Boolean).join(" ")}
                disabled={disabled}
                onClick={() => tpl.type && onSelect?.(tpl.type)}
              >
                <span>{tpl.label}</span>
                {disabled ? <span className="ix-template-switcher__badge">скоро</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
