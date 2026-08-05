import { useEffect, useId, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

function HoneyIcon({ accent = "#c4891a" }) {
  return (
    <svg
      className="seasonal-history-modal__icon-svg"
      viewBox="0 0 48 48"
      width="32"
      height="32"
      aria-hidden="true"
    >
      <ellipse cx="24" cy="38" rx="12" ry="4" fill={accent} opacity="0.35" />
      <rect x="14" y="16" width="20" height="20" rx="3" fill="#f0c040" stroke={accent} strokeWidth="1.5" />
      <rect x="16" y="12" width="16" height="6" rx="2" fill="#e8b030" stroke={accent} strokeWidth="1.2" />
      <path d="M18 22h12M18 27h12M18 32h8" stroke={accent} strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
      <circle cx="33" cy="14" r="3.5" fill="#f5d76e" stroke={accent} strokeWidth="1" />
    </svg>
  );
}

/**
 * Модалка «Историческая справка» — текст и оформление из сезонной темы (БД).
 */
export default function SeasonalHistoryModal({ open, onClose, history }) {
  const titleId = useId();
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handleKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const style = useMemo(() => {
    if (!history) return undefined;
    const vars = {
      ["--seasonal-history-bg"]: history.background_color || "#faf6ee",
      ["--seasonal-history-border"]: history.border_color || "#d4a24a",
      ["--seasonal-history-title"]: history.title_color || "#0f2f7f",
      ["--seasonal-history-text"]: history.text_color || "#3b2a16",
      ["--seasonal-history-btn"]: history.button_color || "#1d4ed8",
    };
    if (history.corner_image_url) {
      vars["--seasonal-history-corner"] = `url(${history.corner_image_url})`;
    }
    return vars;
  }, [history]);

  if (!open || !history || typeof document === "undefined") return null;

  const paragraphs = String(history.body || "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  const showCorners = history.show_corners !== false;
  const buttonLabel = history.button_label || "Понятно";
  const showIcon = Boolean(history.icon_url) || !history.image_url;

  return createPortal(
    <div
      className="seasonal-history-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className={[
          "seasonal-history-modal",
          history.corner_image_url ? "seasonal-history-modal--custom-corners" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={style}
        onClick={(event) => event.stopPropagation()}
      >
        {showCorners ? (
          <>
            <span className="seasonal-history-modal__honeycomb seasonal-history-modal__honeycomb--tl" aria-hidden="true" />
            <span className="seasonal-history-modal__honeycomb seasonal-history-modal__honeycomb--tr" aria-hidden="true" />
            <span className="seasonal-history-modal__honeycomb seasonal-history-modal__honeycomb--bl" aria-hidden="true" />
            <span className="seasonal-history-modal__honeycomb seasonal-history-modal__honeycomb--br" aria-hidden="true" />
          </>
        ) : null}

        <button
          ref={closeRef}
          type="button"
          className="seasonal-history-modal__close"
          onClick={onClose}
          aria-label="Закрыть"
        >
          ×
        </button>

        <header className="seasonal-history-modal__head">
          {showIcon ? (
            <div className="seasonal-history-modal__icon" aria-hidden="true">
              {history.icon_url ? (
                <img src={history.icon_url} alt="" />
              ) : (
                <HoneyIcon accent={history.border_color || "#c4891a"} />
              )}
            </div>
          ) : null}
          <h2 id={titleId} className="seasonal-history-modal__title">
            {history.title}
          </h2>
        </header>

        <div className="seasonal-history-modal__body">
          {history.image_url ? (
            <figure className="seasonal-history-modal__figure">
              <img
                className="seasonal-history-modal__image"
                src={history.image_url}
                alt=""
              />
            </figure>
          ) : null}
          {paragraphs.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </div>

        <footer className="seasonal-history-modal__footer">
          <button
            type="button"
            className="seasonal-history-modal__ok"
            onClick={onClose}
          >
            {buttonLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
