import { createPortal } from "react-dom";
import CabinetIcon from "../CabinetIcons";

export default function CabinetModal({ title, onClose, children, wide, lesson, footer, hideHead }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="cb-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={[
          "cb-modal",
          wide ? "cb-modal--wide" : "",
          lesson ? "cb-modal--lesson" : "",
        ].filter(Boolean).join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hideHead ? undefined : "cb-modal-title"}
        onClick={(e) => e.stopPropagation()}
      >
        {!hideHead ? (
          <div className="cb-modal__head">
            <h2 id="cb-modal-title" className="cb-modal__title">{title}</h2>
            <button type="button" className="cb-modal__close" onClick={onClose} aria-label="Закрыть">
              <CabinetIcon name="close" />
            </button>
          </div>
        ) : null}
        <div className="cb-modal__body">{children}</div>
        {footer ? <div className="cb-modal__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
