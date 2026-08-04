import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { TEMPLATE_SWITCHER, getInteractiveDisplayTitle, getTypeMeta } from "../interactivesData";
import { appearancePageClass, appearancePageStyle, resolvePageTextTone } from "../interactiveAppearance";
import { isAutoTextBackdropEnabled } from "../interactiveContrast";
import {
  getInteractiveLaunchMeta,
  interactiveHasPlayableContent,
} from "../interactivesEditorUtils";
import InteractivePlayer from "./InteractivePlayer";
import ContrastingText from "./ContrastingText";
import ConfirmActionModal from "./ConfirmActionModal";

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
  onRestart,
  fullscreenHref,
  editHref,
  showToolbar = true,
}) {
  const [soundOn, setSoundOn] = useState(appearance?.soundEnabled !== false);
  const [sessionKey, setSessionKey] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [hasProgress, setHasProgress] = useState(false);
  const typeMeta = getTypeMeta(interactive.type);
  const metaLine = getInteractiveLaunchMeta(interactive);
  const hasContent = interactiveHasPlayableContent(interactive);
  const textTone = resolvePageTextTone(appearance);
  const textColor = textTone === "light" ? "#ffffff" : "#0f172a";
  const autoBackdrop = isAutoTextBackdropEnabled(interactive);

  const frameClass = [
    "ix-launch-hero",
    appearancePageClass(appearance),
    started ? "ix-launch-hero--playing" : "",
    !hasContent ? " ix-launch-hero--empty" : "",
  ].filter(Boolean).join(" ");

  const requestRestart = useCallback(() => {
    if (started && hasProgress) {
      setConfirmRestart(true);
      return;
    }
    setHasProgress(false);
    setSessionKey((k) => k + 1);
    onRestart?.();
    onStart?.();
  }, [started, hasProgress, onRestart, onStart]);

  const confirmDoRestart = () => {
    setConfirmRestart(false);
    setHasProgress(false);
    setSessionKey((k) => k + 1);
    onRestart?.();
    onStart?.();
  };

  return (
    <div className={frameClass} style={appearancePageStyle(appearance)}>
      {!hasContent ? (
        <div className="ix-launch-hero__intro ix-launch-hero__intro--empty">
          <p className="ix-launch-hero__type">{typeMeta.shortLabel}</p>
          <ContrastingText
            as="h2"
            className="ix-launch-hero__title"
            color={textColor}
            autoBackdrop={autoBackdrop}
          >
            {getInteractiveDisplayTitle(interactive)}
          </ContrastingText>
          <ContrastingText
            as="p"
            className="ix-launch-hero__instruction"
            color={textColor}
            autoBackdrop={autoBackdrop}
          >
            {EMPTY_HELP[interactive.type] || "Добавьте содержимое, чтобы запустить интерактив"}
          </ContrastingText>
          {editHref ? (
            <Link to={editHref} className="cb-btn cb-btn--primary cb-btn--pill ix-launch-hero__edit-link">
              Редактировать
            </Link>
          ) : null}
        </div>
      ) : !started ? (
        <div className="ix-launch-hero__intro">
          <p className="ix-launch-hero__type">{typeMeta.shortLabel}</p>
          <ContrastingText
            as="h2"
            className="ix-launch-hero__title"
            color={textColor}
            autoBackdrop={autoBackdrop}
          >
            {getInteractiveDisplayTitle(interactive)}
          </ContrastingText>
          {metaLine ? (
            <ContrastingText
              as="p"
              className="ix-launch-hero__meta"
              color={textColor}
              autoBackdrop={autoBackdrop}
            >
              {metaLine}
            </ContrastingText>
          ) : null}
          <div className="ix-launch-hero__intro-actions">
            <button type="button" className="ix-launch-hero__start" onClick={onStart}>
              <span className="ix-launch-hero__start-icon" aria-hidden="true">▶</span>
              Начать
            </button>
            {editHref ? (
              <Link to={editHref} className="cb-btn cb-btn--outline cb-btn--pill ix-launch-hero__edit-btn">
                Редактировать
              </Link>
            ) : null}
          </div>
          <p className="ix-launch-hero__help-text" title={TYPE_HELP[interactive.type] || ""}>
            {TYPE_HELP[interactive.type]}
          </p>
        </div>
      ) : (
        <div
          className="ix-launch-hero__player"
          onPointerDown={() => setHasProgress(true)}
        >
          <InteractivePlayer
            key={sessionKey}
            interactive={interactive}
            appearance={{ ...appearance, soundEnabled: soundOn }}
            playing
            sessionKey={sessionKey}
            onProgress={() => setHasProgress(true)}
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
          {started ? (
            <button
              type="button"
              className="ix-launch-hero__tool"
              onClick={requestRestart}
              aria-label="Начать заново"
              title="Начать заново"
            >
              ↻
            </button>
          ) : null}
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

      <ConfirmActionModal
        open={confirmRestart}
        title="Начать заново?"
        text="Текущий прогресс будет сброшен. Начать заново?"
        confirmLabel="Начать заново"
        onClose={() => setConfirmRestart(false)}
        onConfirm={confirmDoRestart}
      />
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
