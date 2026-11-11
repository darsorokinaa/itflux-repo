import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { rememberReturnPath, safeReturnPath } from "../accessGate/accessGate";
import { useCabinetAuthed } from "../hooks/useAccessGate";
import {
  fetchInterestingItem,
  purchaseInteresting,
  quoteInteresting,
  startInterestingDemo,
} from "../utils/cabinetAuth";
import CatalogEngagementBar from "./CatalogEngagementBar";
import CatalogPromoBox from "./CatalogPromoBox";

const PLAN_NAMES = {
  start: "Старт",
  teacher: "Репетитор",
  repetitor: "Репетитор",
  pro: "Профи",
  profi: "Профи",
  premium: "Профи",
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

function viewerUrl(slug) {
  return `/interesting/${encodeURIComponent(slug)}/view`;
}

function previewUrl(slug) {
  return `/interesting?preview=${encodeURIComponent(slug)}`;
}

function planName(slug) {
  const key = String(slug || "").toLowerCase();
  return PLAN_NAMES[key] || slug || "";
}

export default function InterestingPreviewModal({ open, slug, onClose }) {
  const navigate = useNavigate();
  const authed = useCabinetAuthed();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [promoCode, setPromoCode] = useState("");

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
  const locked = Boolean(item) && access.can_view !== true && (access.allowed === false || item.locked === true);
  const requiredPlan = planName(access.min_plan || access.required_plan);
  const priceNumber = access.pricing?.final_amount ?? access.standalone_price;
  const priceLabel = priceNumber != null && priceNumber !== ""
    ? `Купить за ${Number(priceNumber).toLocaleString("ru-RU")} ₽`
    : "";
  const canBuy = Boolean(authed && access.can_purchase && priceLabel);
  const canDemo = Boolean(authed && (access.can_start_demo || access.demo_active));
  const demoExpired = Boolean(access.demo_expired && !access.demo_active);

  const onBuy = async () => {
    if (!slug) return;
    setBusy(true);
    setError("");
    try {
      const result = await purchaseInteresting(slug, `int-${item?.id || slug}-${Date.now()}`, promoCode);
      if (result?.payment_url) {
        window.location.href = result.payment_url;
        return;
      }
      await load();
    } catch (err) {
      setError(err?.message || "Не удалось начать покупку");
    } finally {
      setBusy(false);
    }
  };

  const onDemo = async () => {
    if (!slug) return;
    if (access.demo_active) {
      onClose?.();
      navigate(viewerUrl(slug));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await startInterestingDemo(slug);
      onClose?.();
      navigate(viewerUrl(slug));
    } catch (err) {
      setError(err?.message || "Не удалось открыть демо");
    } finally {
      setBusy(false);
    }
  };

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
        ) : item ? (
          <div className={`material-preview material-preview--modal${item.cover_image_url ? "" : " material-preview--modal--no-cover"}`}>
            {item.cover_image_url ? (
              <div className="material-preview__cover-wrap">
                <img className="material-preview__cover" src={item.cover_image_url} alt="" />
              </div>
            ) : null}
            <div className="material-preview__body">
              <div className="material-preview__badges">
                {locked ? <span className="material-access-badge">Платный материал</span> : null}
              </div>
              <h1 id="interesting-preview-title" className="material-preview__title">{item.title}</h1>
              {item.tag ? <p className="material-preview__meta">{item.tag}</p> : null}
              {item.slug ? (
                <CatalogEngagementBar
                  kind="interesting"
                  slug={item.slug}
                  viewsCount={item.views_count}
                  likesCount={item.likes_count}
                  isLiked={item.is_liked}
                />
              ) : null}
              {item.short_description ? (
                <p className="material-preview__desc">{item.short_description}</p>
              ) : null}
              {requiredPlan && locked ? (
                <div className="material-preview__facts">
                  <div className="material-preview__fact">
                    <span className="material-preview__fact-label">По тарифу</span>
                    <strong>{requiredPlan}</strong>
                  </div>
                </div>
              ) : null}
              {locked ? <p className="material-paywall__message">{demoExpired ? "Демо этого тренажёра закончилось." : message}</p> : null}
              {access.pricing?.message ? (
                <p className="catalog-promo__msg catalog-promo__msg--ok">{access.pricing.message}</p>
              ) : null}
              {error ? <p className="material-viewer__error" role="alert">{error}</p> : null}
              {canBuy ? (
                <CatalogPromoBox
                  onApplied={setPromoCode}
                  onQuote={(code) => quoteInteresting(slug, code)}
                  disabled={busy}
                />
              ) : null}
              <div className="material-paywall__actions">
                {!locked ? (
                  <button
                    type="button"
                    className="material-access-btn material-access-btn--primary"
                    onClick={() => {
                      onClose?.();
                      navigate(viewerUrl(slug));
                    }}
                  >
                    Открыть
                  </button>
                ) : !authed ? (
                  <Link
                    className="material-access-btn material-access-btn--primary"
                    to={registerHref(returnUrl)}
                    onClick={() => rememberReturnPath(returnUrl)}
                  >
                    Создать аккаунт
                  </Link>
                ) : (
                  <>
                    {canBuy ? (
                      <button type="button" className="material-access-btn material-access-btn--primary" onClick={onBuy} disabled={busy}>
                        {priceLabel}
                      </button>
                    ) : null}
                    {canDemo ? (
                      <button type="button" className="material-access-btn" onClick={onDemo} disabled={busy}>
                        {access.demo_active ? "Продолжить демо" : "Демо 10 минут"}
                      </button>
                    ) : null}
                    <Link className="material-access-btn material-access-btn--ghost" to="/cabinet/upgrade">
                      Посмотреть тарифы
                    </Link>
                  </>
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
