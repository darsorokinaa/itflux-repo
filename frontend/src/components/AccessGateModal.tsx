import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { Lock } from "lucide-react";
import {
  accessGateCopy,
  planDisplayName,
  rememberReturnPath,
  safeReturnPath,
  type AccessGateContext,
} from "../accessGate/accessGate";
import { trackGoal } from "../utils/analytics";
import { authSearchWithNext, trackValueGoal } from "../utils/valuePath";

type AccessGateModalProps = AccessGateContext & {
  open: boolean;
  onClose: () => void;
  authenticated?: boolean;
};

type PricingPayload = {
  plans?: Array<{ slug?: string; name?: string }>;
  registration_promo?: { active?: boolean; message?: string };
  promotions?: Array<{
    can_redeem?: boolean;
    status?: string;
    short_description?: string;
    title?: string;
  }>;
};

export default function AccessGateModal({
  open,
  onClose,
  reason,
  resourceType,
  resourceName,
  resourceId,
  requiredPlan,
  currentPlan,
  sourcePage,
  returnUrl,
  limit,
  current,
  authenticated = false,
}: AccessGateModalProps) {
  const location = useLocation();
  const [pricing, setPricing] = useState<PricingPayload | null>(null);
  const from =
    safeReturnPath(returnUrl) ||
    `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    trackGoal("paywall_shown", {
      resource_type: resourceType,
      resource_id: resourceId || "",
      access_reason: reason,
      current_plan: currentPlan || "",
      required_plan: requiredPlan || "",
      source_page: sourcePage || location.pathname,
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [
    open,
    onClose,
    resourceType,
    resourceId,
    reason,
    currentPlan,
    requiredPlan,
    sourcePage,
    location.pathname,
  ]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    fetch("/api/cabinet/pricing/plans/", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setPricing(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const requiredPlanName = useMemo(() => {
    const fromApi = pricing?.plans?.find((plan) => plan.slug === requiredPlan)?.name;
    return planDisplayName(requiredPlan, fromApi);
  }, [pricing, requiredPlan]);

  const promoText = useMemo(() => {
    if (!pricing) return "";
    if (reason === "anonymous") {
      const promo = pricing.registration_promo;
      return promo?.active && promo?.message ? String(promo.message) : "";
    }
    const offer = (pricing.promotions || []).find(
      (item) => item.can_redeem && (item.short_description || item.title),
    );
    return offer ? String(offer.short_description || offer.title || "") : "";
  }, [pricing, reason]);

  const copy = accessGateCopy(
    { reason, resourceType, resourceName, requiredPlan, limit, current },
    { requiredPlanName, authenticated },
  );

  if (!open || typeof document === "undefined") return null;

  const isAnonymous = reason === "anonymous";
  const registerTo = {
    pathname: "/cabinet/login",
    search: authSearchWithNext(from),
  };
  const loginTo = {
    pathname: "/cabinet/login",
    search: authSearchWithNext(from, { mode: "" }),
  };
  const upgradeTo = authenticated ? "/cabinet/upgrade" : "/pricing";

  const remember = () => rememberReturnPath(from);

  return createPortal(
    <div
      className="access-gate-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          trackGoal("paywall_closed", { access_reason: reason, resource_type: resourceType });
          onClose();
        }
      }}
    >
      <div
        className="access-gate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-gate-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="access-gate-close"
          onClick={() => {
            trackGoal("paywall_closed", { access_reason: reason, resource_type: resourceType });
            onClose();
          }}
          aria-label="Закрыть"
        >
          ×
        </button>
        <div className="access-gate-icon" aria-hidden="true">
          <Lock size={18} strokeWidth={2.1} />
        </div>
        {copy.eyebrow ? <p className="access-gate-eyebrow">{copy.eyebrow}</p> : null}
        <h2 id="access-gate-title" className="access-gate-title">
          {copy.title}
        </h2>
        <p className="access-gate-text">{copy.text}</p>
        {promoText ? (
          <p className="access-gate-offer" role="status">
            {promoText}
          </p>
        ) : null}
        <div className="access-gate-actions">
          {isAnonymous ? (
            <>
              <Link
                className="access-gate-btn access-gate-btn--primary"
                to={registerTo}
                state={{ from }}
                onClick={() => {
                  remember();
                  trackGoal("paywall_register_clicked", {
                    access_reason: reason,
                    resource_type: resourceType,
                  });
                  if (resourceType === "variant" || resourceType === "workbook") {
                    trackValueGoal("signup_from_generator", { resource_type: resourceType });
                  }
                  onClose();
                }}
              >
                {copy.primary}
              </Link>
              <Link
                className="access-gate-btn access-gate-btn--ghost"
                to={loginTo}
                state={{ from }}
                onClick={() => {
                  remember();
                  trackGoal("paywall_login_clicked", {
                    access_reason: reason,
                    resource_type: resourceType,
                  });
                  onClose();
                }}
              >
                {copy.secondary}
              </Link>
            </>
          ) : (
            <>
              <Link
                className="access-gate-btn access-gate-btn--primary"
                to={upgradeTo}
                onClick={() => {
                  trackGoal("paywall_upgrade_clicked", {
                    access_reason: reason,
                    resource_type: resourceType,
                    required_plan: requiredPlan || "",
                  });
                  onClose();
                }}
              >
                {copy.primary}
              </Link>
              <button
                type="button"
                className="access-gate-later"
                onClick={() => {
                  trackGoal("paywall_closed", { access_reason: reason, resource_type: resourceType });
                  onClose();
                }}
              >
                {copy.secondary}
              </button>
            </>
          )}
        </div>
        {!isAnonymous ? (
          <Link className="access-gate-compare" to="/pricing" onClick={onClose}>
            Сравнить все тарифы
          </Link>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
