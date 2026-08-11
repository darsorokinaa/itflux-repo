import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import CabinetIcon from "../CabinetIcons";
import { getSupportContacts } from "../../config/supportContacts";
import "../../components/SupportFab.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function ContactRow({ label, value, actionLabel, href, external, icon }) {
  if (!href && !value) return null;

  const action = href ? (
    <a
      href={href}
      className="cb-support-row__action"
      {...(external
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
    >
      {actionLabel}
    </a>
  ) : null;

  return (
    <div className="cb-support-row">
      <div className="cb-support-row__main">
        <span className="cb-support-row__icon" aria-hidden="true">
          <CabinetIcon name={icon} />
        </span>
        <div className="cb-support-row__text">
          <span className="cb-support-row__label">{label}</span>
          {value ? (
            <span className="cb-support-row__value">{value}</span>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );
}

/**
 * Единый popup поддержки. Открывается из меню и вторичных ссылок.
 * Не меняет URL.
 */
export default function SupportModal({ open, onClose }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFirst = () => {
      const root = dialogRef.current;
      if (!root) return;
      const preferred = closeBtnRef.current;
      if (preferred) {
        preferred.focus();
        return;
      }
      const first = root.querySelector(FOCUSABLE);
      if (first instanceof HTMLElement) first.focus();
    };

    const id = window.requestAnimationFrame(focusFirst);

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const nodes = Array.from(root.querySelectorAll(FOCUSABLE)).filter(
        (el) => el instanceof HTMLElement && !el.hasAttribute("disabled"),
      );
      if (!nodes.length) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      const restore = previouslyFocused.current;
      if (restore && typeof restore.focus === "function") {
        window.requestAnimationFrame(() => restore.focus());
      }
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const contacts = getSupportContacts();
  const hasContacts =
    contacts.telegram || contacts.email || contacts.vk || contacts.social.length > 0;

  return createPortal(
    <div
      className="cb-modal-backdrop cb-support-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="cb-modal cb-support-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cb-modal__head">
          <h2 id={titleId} className="cb-modal__title">
            Нужна помощь?
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="cb-modal__close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <CabinetIcon name="close" />
          </button>
        </div>
        <div className="cb-modal__body cb-support-modal__body">
          <p className="cb-support-modal__intro">
            Если что-то не работает или появился вопрос по платформе, напишите мне
            удобным способом.
          </p>

          {hasContacts ? (
            <div className="cb-support-list">
              {contacts.telegram ? (
                <ContactRow
                  label="Telegram"
                  value={contacts.telegram.display}
                  actionLabel="Написать"
                  href={contacts.telegram.url}
                  external
                  icon="message"
                />
              ) : null}

              {contacts.email ? (
                <ContactRow
                  label="Email"
                  value={contacts.email}
                  actionLabel="Написать"
                  href={`mailto:${contacts.email}`}
                  icon="mail"
                />
              ) : null}

              {contacts.vk ? (
                <ContactRow
                  label="VK"
                  actionLabel="Открыть"
                  href={contacts.vk.url}
                  external
                  icon="users"
                />
              ) : null}

              {contacts.social.length > 0 ? (
                <div className="cb-support-social">
                  <span className="cb-support-social__label">Социальные сети</span>
                  <div className="cb-support-social__links">
                    {contacts.social.map((item) => (
                      <a
                        key={item.id}
                        href={item.url}
                        className="cb-support-social__link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.label}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="cb-support-modal__empty">
              Контакты поддержки скоро появятся здесь.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
