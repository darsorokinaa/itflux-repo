import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { rememberReturnPath, safeReturnPath } from "../accessGate/accessGate";
import { useCabinetAuthed } from "../hooks/useAccessGate";
import { fetchInterestingItem } from "../utils/cabinetAuth";

const PLAN_NAMES = {
  start: "Старт",
  teacher: "Учитель",
  repetitor: "Учитель",
  pro: "Профи",
  profi: "Профи",
  premium: "Премиум",
  school: "Школа",
};

function registerHref(returnUrl) {
  const next = safeReturnPath(returnUrl) || "/interesting";
  return {
    pathname: "/cabinet/login",
    search: `?mode=register&next=${encodeURIComponent(next)}`,
    state: { from: next },
  };
}

function contentUrl(slug) {
  return `/api/interesting/${encodeURIComponent(slug)}/view/`;
}

function previewUrl(slug) {
  return `/interesting?preview=${encodeURIComponent(slug)}`;
}

function planName(slug) {
  const key = String(slug || "").toLowerCase();
  return PLAN_NAMES[key] || slug || "";
}

export default function InterestingPreviewModal({ open, slug, onClose }) {
  const authed = useCabinetAuthed();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const returnUrl = slug ? previewUrl(slug) : "/interesting";

  const load = useCallback(() => {
    if (!slug) return Promise.resolve();
    setLoading(true);
    setError("");
    return fetchInterestingItem(slug)
      .then((data) => {
        setItem(data);
        return data;
      })
      .catch((err) => {
        setItem(null);
        setError(err?.message || "Не удалось загрузить материал");
        return null;
      })
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!open || !slug) {
      setItem(null);
      setError("");
      return undefined;
    }
    load();
    return undefined;
  }, [open, slug, load]);

  const wasAuthedRef = useRef(authed);
  useEffect(() => {
    if (open && slug && authed && !wasAuthedRef.current) {
      load();
    }
    wasAuthedRef.current = authed;
  }, [open, slug, authed, load]);

  const access = item?.access || {};
  const locked = Boolean(item) && (access.allowed === false || item.locked === true);
  const requiredPlan = planName(access.min_plan || access.required_plan);

  useEffect(() => {
    if (!open || !item || locked || !slug) return;
    window.location.href = contentUrl(slug);
  }, [open, item, locked, slug]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !slug || typeof document === "undefined") return null;

  const message = !authed
    ? (requiredPlan && requiredPlan !== "Старт"
      ? `Материал доступен после регистрации и с тарифа «${requiredPlan}».`
      : "Материал доступен после регистрации.")
    : (requiredPlan
      ? `Материал доступен на тарифе «${requiredPlan}».`
      : "Материал доступен на более высоком тарифе.");

  return createPortal(
    <div
      className="lesson-preview-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className="lesson-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="interesting-preview-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="lesson-preview-modal__close"
          aria-label="Закрыть"
          onClick={onClose}
        >
          ×
        </button>

        {loading ? (
          <div className="lesson-preview-modal__loading">Загрузка материала…</div>
        ) : error && !item ? (
          <div className="lesson-preview-modal__loading">
            <p>{error}</p>
          </div>
        ) : item && !locked ? (
          <div className="lesson-preview-modal__loading">Открываем материал…</div>
        ) : item ? (
          <div className={`material-preview material-preview--modal${item.cover_image_url ? "" : " material-preview--modal--no-cover"}`}>
            {item.cover_image_url ? (
              <div className="material-preview__cover-wrap">
                <img className="material-preview__cover" src={item.cover_image_url} alt="" />
              </div>
            ) : null}
            <div className="material-preview__body">
              <div className="material-preview__badges">
                <span className="material-access-badge">Платный материал</span>
              </div>
              <h1 id="interesting-preview-title" className="material-preview__title">{item.title}</h1>
              {item.tag ? <p className="material-preview__meta">{item.tag}</p> : null}
              {item.short_description ? (
                <p className="material-preview__desc">{item.short_description}</p>
              ) : null}
              {requiredPlan ? (
                <div className="material-preview__facts">
                  <div className="material-preview__fact">
                    <span className="material-preview__fact-label">По тарифу</span>
                    <strong>{requiredPlan}</strong>
                  </div>
                </div>
              ) : null}
              <p className="material-paywall__message">{message}</p>
              <div className="material-paywall__actions">
                {!authed ? (
                  <Link
                    className="material-access-btn material-access-btn--primary"
                    to={registerHref(returnUrl)}
                    onClick={() => rememberReturnPath(returnUrl)}
                  >
                    Создать аккаунт
                  </Link>
                ) : (
                  <Link className="material-access-btn material-access-btn--primary" to="/cabinet/upgrade">
                    Посмотреть тарифы
                  </Link>
                )}
                <button type="button" className="material-access-btn material-access-btn--ghost" onClick={onClose}>
                  Не сейчас
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
