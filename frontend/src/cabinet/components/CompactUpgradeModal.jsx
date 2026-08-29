/**
 * CompactUpgradeModal — компактное окно выбора тарифа.
 *
 * Показывает основные тарифы. Клик по карточке делает её активной и показывает цену.
 * Props:
 *   currentPlan  — { name, slug, limits: { students, groups } }
 *   plans        — полный список тарифов из API
 *   recommendedSlug — slug рекомендуемого тарифа
 *   onSelectPlan(slug) — callback при выборе тарифа
 *   onCompareAll — callback для перехода на /cabinet/upgrade
 *   onClose
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { validatePromoCode } from "../../utils/cabinetAuth";
import { formatStorageLabel } from "../../utils/planHighlights";

function isContactPlan(plan) {
  return plan?.cta_type === "contact" || plan?.slug === "school";
}

function formatRub(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`;
}

function resolvePlanPromo(promoDiscount, planSlug) {
  if (!promoDiscount?.valid) return null;
  const entry = promoDiscount.by_plan?.[planSlug];
  if (entry) {
    if (entry.valid === false) return null;
    return { ...promoDiscount, ...entry, valid: true };
  }
  if (promoDiscount.plan_slug === planSlug) return promoDiscount;
  return null;
}

function PlanCard({ plan, isCurrent, isSelected, onSelect, onActivate, promoDiscount }) {
  const l = plan.limits || {};
  const storage = formatStorageLabel(l.storage_mb);
  const summary = [
    l.students != null ? `${l.students} учеников` : null,
    l.groups != null ? `${l.groups} групп` : l.groups === null ? "группы без лимита" : null,
    storage ? `${storage} хранилища` : null,
  ].filter(Boolean).join(" · ");

  const offer = plan.promotion?.can_redeem ? plan.promotion : null;
  const planPromo = resolvePlanPromo(promoDiscount, plan.slug);
  const bonusDays = Number(planPromo?.bonus_days || 0);
  const promoFinal = planPromo?.final_amount != null ? Number(planPromo.final_amount) : null;
  const basePrice = Number(plan.price_month);
  const hasPromoPriceCut =
    Boolean(planPromo) && promoFinal != null && Number.isFinite(promoFinal) && promoFinal + 0.005 < basePrice;
  const promoApplies = Boolean(planPromo) && (hasPromoPriceCut || bonusDays > 0);
  let price =
    Number(plan.price_month) === 0
      ? "Бесплатно"
      : `${Number(plan.price_month).toLocaleString("ru-RU")} ₽/мес`;
  let priceNote = summary;
  if (hasPromoPriceCut) {
    price = `${formatRub(planPromo.final_amount)} сейчас`;
    priceNote = [
      planPromo.renewal_price ? `далее ${formatRub(planPromo.renewal_price)}/мес` : "с учётом скидки",
      bonusDays > 0 ? `+${bonusDays} дн.` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  } else if (promoApplies && bonusDays > 0) {
    priceNote = `${summary ? `${summary} · ` : ""}+${bonusDays} дн. к подписке`;
  } else if (offer?.benefit_type === "free_period") {
    price = `${offer.free_months} мес. бесплатно`;
    priceNote = offer.pricing?.renewal
      ? `далее ${formatRub(offer.pricing.renewal)}/мес`
      : summary;
  } else if (offer?.pricing?.current != null) {
    price = `${formatRub(offer.pricing.current)} сейчас`;
    priceNote = offer.pricing.renewal
      ? `далее ${formatRub(offer.pricing.renewal)}/мес`
      : summary;
  }

  return (
    <div
      className={`cum-plan-card${isCurrent ? " cum-plan-card--current" : ""}${isSelected ? " cum-plan-card--selected" : ""}`}
      aria-selected={isSelected}
      onClick={() => onActivate?.(plan.slug)}
    >
      {plan.is_recommended && <span className="cum-badge">Оптимально</span>}
      {isCurrent && <span className="cum-badge cum-badge--current">Текущий</span>}
      {offer || promoApplies ? <span className="cum-badge">Акция</span> : null}
      <div className="cum-plan-name">{plan.name}</div>
      <div className="cum-plan-price">{price}</div>
      <div className="cum-plan-summary">
        {promoApplies && planPromo.base_price && hasPromoPriceCut ? (
          <s>{formatRub(planPromo.base_price)}</s>
        ) : offer?.pricing?.original && offer.benefit_type !== "free_period" ? (
          <s>{formatRub(offer.pricing.original)}</s>
        ) : null}
        {((promoApplies && planPromo.base_price && hasPromoPriceCut) ||
          (offer?.pricing?.original && offer.benefit_type !== "free_period")) &&
        priceNote
          ? " · "
          : null}
        {priceNote}
      </div>
      {!isCurrent && (
        <button
          type="button"
          className="cum-plan-btn"
          onClick={(e) => {
            e.stopPropagation();
            onActivate?.(plan.slug);
            onSelect(plan.slug);
          }}
        >
          {offer?.button_text || `Перейти на ${plan.name}`}
        </button>
      )}
    </div>
  );
}

export default function CompactUpgradeModal({
  currentPlan,
  plans = [],
  recommendedSlug,
  onSelectPlan,
  onCompareAll: _onCompareAll,
  onClose,
}) {
  const currentSlug = currentPlan?.slug;
  const [promoInput, setPromoInput] = useState("");
  const [promoState, setPromoState] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState(recommendedSlug || currentSlug || null);

  const visiblePlans = useMemo(() => {
    const checkout = (plans || []).filter((p) => !isContactPlan(p));
    if (checkout.length) return checkout;
    return plans.filter((p) => p.slug === currentSlug || p.slug === recommendedSlug);
  }, [plans, currentSlug, recommendedSlug]);

  useEffect(() => {
    if (!visiblePlans.length) return;
    setSelectedSlug((prev) => {
      if (prev && visiblePlans.some((p) => p.slug === prev)) return prev;
      if (recommendedSlug && visiblePlans.some((p) => p.slug === recommendedSlug)) {
        return recommendedSlug;
      }
      return visiblePlans[0]?.slug || prev;
    });
  }, [visiblePlans, recommendedSlug]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handlePromoCheck = async () => {
    const code = promoInput.trim();
    if (!code) return;
    setPromoLoading(true);
    setPromoState(null);
    try {
      const data = await validatePromoCode(code, selectedSlug);
      const bonus = Number(data.bonus_days || 0);
      setPromoState({
        valid: true,
        ...data,
        message: bonus > 0 ? `Промокод применён · +${bonus} дн.` : "Промокод применён",
      });
    } catch (err) {
      setPromoState({ valid: false, message: err.data?.message || "Промокод не найден" });
    } finally {
      setPromoLoading(false);
    }
  };

  return (
    <div className="upm-backdrop cum-backdrop" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="upm-sheet cum-sheet">
        <button type="button" className="upm-close" onClick={onClose} aria-label="Закрыть">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <h2 className="upm-title cum-title">Увеличить лимит</h2>
        <p className="upm-text cum-subtitle">Нажмите на тариф, чтобы увидеть цену. Затем подтвердите переход.</p>

        <div className="cum-plans">
          {visiblePlans.map((p) => (
            <PlanCard
              key={p.slug}
              plan={p}
              isCurrent={p.slug === currentSlug}
              isSelected={p.slug === selectedSlug}
              onSelect={onSelectPlan}
              onActivate={setSelectedSlug}
              promoDiscount={promoState}
            />
          ))}
        </div>

        <div className="cum-promo">
          <div className="cum-promo__row">
            <input
              type="text"
              className="cum-promo__input"
              placeholder="Промокод"
              value={promoInput}
              onChange={(e) => { setPromoInput(e.target.value); setPromoState(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handlePromoCheck(); }}
              aria-label="Промокод"
            />
            <button
              type="button"
              className="cum-promo__btn"
              onClick={handlePromoCheck}
              disabled={promoLoading || !promoInput.trim()}
            >
              {promoLoading ? "…" : "Применить"}
            </button>
          </div>
          {promoState && (
            <p className={`cum-promo__msg${promoState.valid ? " cum-promo__msg--ok" : " cum-promo__msg--err"}`}>
              {promoState.valid ? "✓ " : "✕ "}{promoState.message}
            </p>
          )}
        </div>

        <div className="cum-footer">
          <Link
            to="/cabinet/upgrade"
            className="cum-compare-link"
            onClick={onClose}
          >
            Сравнить все тарифы
          </Link>
        </div>
      </div>
    </div>
  );
}
