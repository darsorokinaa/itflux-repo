import { useState } from "react";
import { Link } from "react-router-dom";
import { TEMPLATE_SWITCHER, getInteractiveDisplayTitle, getTypeMeta } from "../interactivesData";
import { appearancePageClass, appearancePageStyle } from "../interactiveAppearance";
import {
  getInteractiveLaunchMeta,
  interactiveHasPlayableContent,
} from "../interactivesEditorUtils";
import InteractivePlayer from "./InteractivePlayer";

const TYPE_HELP = {
  flashcards: "Переворачивайте карточки и отмечайте, что уже знаете.",
  matching: "Соедините пары: понятие и ответ.",
  sequence: "Расставьте элементы в правильном порядке.",
  quiz: "Выберите правильный ответ и нажмите «Ответить».",
  wheel: "Нажмите «Крутить», чтобы выбрать сектор.",
};

const EMPTY_HELP = {
  flashcards: "Добавьте карточки, чтобы запустить интерактив",
  matching: "Добавьте пары, чтобы запустить интерактив",
  sequence: "Добавьте элементы, чтобы запустить интерактив",
  quiz: "Добавьте вопросы, чтобы запустить интерактив",
  wheel: "Добавьте сектора, чтобы запустить колесо",
};

export default function InteractiveLaunchScreen({
  interactive,
  appearance,
  started,
  onStart,
  fullscreenHref,
  editHref,
  showToolbar = true,
}) {
  const [soundOn, setSoundOn] = useState(appearance?.soundEnabled !== false);
  const typeMeta = getTypeMeta(interactive.type);
  const metaLine = getInteractiveLaunchMeta(interactive);
  const hasContent = interactiveHasPlayableContent(interactive);

  const frameClass = [
    "ix-launch-hero",
    appearancePageClass(appearance),
    started ? "ix-launch-hero--playing" : "",
    !hasContent ? " ix-launch-hero--empty" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={frameClass} style={appearancePageStyle(appearance)}>
      {!hasContent ? (
        <div className="ix-launch-hero__intro ix-launch-hero__intro--empty">
          <p className="ix-launch-hero__type">{typeMeta.shortLabel}</p>
          <h2 className="ix-launch-hero__title">{getInteractiveDisplayTitle(interactive)}</h2>
          <p className="ix-launch-hero__instruction">
            {EMPTY_HELP[interactive.type] || "Добавьте содержимое, чтобы запустить интерактив"}
          </p>
          {editHref ? (
            <Link to={editHref} className="cb-btn cb-btn--primary cb-btn--pill ix-launch-hero__edit-link">
              Редактировать
            </Link>
          ) : null}
        </div>
      ) : !started ? (
        <div className="ix-launch-hero__intro">
          <p className="ix-launch-hero__type">{typeMeta.shortLabel}</p>
          <h2 className="ix-launch-hero__title">{getInteractiveDisplayTitle(interactive)}</h2>
          {metaLine ? (
            <p className="ix-launch-hero__meta">{metaLine}</p>
          ) : null}
          <div className="ix-launch-hero__intro-actions">
            <button type="button" className="ix-launch-hero__start" onClick={onStart}>
              <span className="ix-launch-hero__start-icon" aria-hidden="true">▶</span>
              Начать
            </button>
          </div>
          <p className="ix-launch-hero__help-text" title={TYPE_HELP[interactive.type] || ""}>
            {TYPE_HELP[interactive.type]}
          </p>
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

      {showToolbar && hasContent ? (
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
    <aside className="ix-template-switcher ix-template-switcher--v2">
      <h3 className="ix-template-switcher__title">Шаблон</h3>
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
