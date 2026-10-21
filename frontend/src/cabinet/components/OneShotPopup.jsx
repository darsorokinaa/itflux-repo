/** Разовое всплывающее окно кабинета: показ один раз, факт показа/закрытия хранится на сервере. */
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureCsrfCookie, getCsrfToken } from "../../utils/cabinetAuth";
import "./OneShotPopup.css";

const API = "/api/cabinet/oneshot-popup/";

async function post(path, body) {
  await ensureCsrfCookie();
  return fetch(`${API}${path}`, {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: JSON.stringify(body || {}),
  });
}

export function OneShotPopupView({ popup, onClose, onButton }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="oneshot-popup__backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="oneshot-popup" role="dialog" aria-modal="true" aria-labelledby="oneshot-popup-title">
        <h2 id="oneshot-popup-title" className="oneshot-popup__title">{popup.title}</h2>
        <p className="oneshot-popup__text">{popup.message}</p>
        <p className="oneshot-popup__signature">{popup.signature}</p>
        <div className="oneshot-popup__actions">
          <a className="oneshot-popup__btn oneshot-popup__btn--primary" href={popup.button_url} onClick={onButton}>
            {popup.button_label}
          </a>
          <button ref={closeRef} type="button" className="oneshot-popup__btn" onClick={onClose}>
            {popup.close_label || "Закрыть"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OneShotPopup({ enabled = true }) {
  const [popup, setPopup] = useState(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetch(API, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.popup) return;
        setPopup(d.popup);
        post(`${d.popup.id}/seen/`).catch(() => {});
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [enabled]);

  const close = useCallback(() => {
    if (!popup) return;
    post(`${popup.id}/close/`, { action: "close" }).catch(() => {});
    setPopup(null);
  }, [popup]);

  const button = useCallback(async (e) => {
    if (!popup) return;
    e.preventDefault();
    const url = popup.button_url;
    try { await post(`${popup.id}/close/`, { action: "button" }); } catch { /* переход важнее */ }
    window.location.assign(url); // та же вкладка
  }, [popup]);

  if (!popup) return null;
  return <OneShotPopupView popup={popup} onClose={close} onButton={button} />;
}
