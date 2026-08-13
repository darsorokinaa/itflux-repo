/**
 * CompactUpgradeModal — компактное окно выбора тарифа.
 *
 * Показывает текущий + рекомендуемый тариф.
 * Props:
 *   currentPlan  — { name, slug, limits: { students, groups, ai_requests } }
 *   plans        — полный список тарифов из API
 *   recommendedSlug — slug рекомендуемого тарифа
 *   onSelectPlan(slug) — callback при выборе тарифа
 *   onCompareAll — callback для перехода на /cabinet/upgrade
 *   onClose
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { validatePromoCode } from "../../utils/cabinetAuth";

function PlanCard({ plan, isCurrent, onSelect }) {
  const l = plan.limits || {};
  const summary = [
    l.students != null ? `${l.students} учеников` : null,
    l.groups != null ? `${l.groups} групп` : null,
    l.ai_requests != null ? `${l.ai_requests} ИИ` : null,
  ].filter(Boolean).join(" · ");

  const offer = plan.promotion?.can_redeem ? plan.promotion : null;
  let price =
    Number(plan.price_month) === 0
      ? "Бесплатно"
      : `${Number(plan.price_month).toLocaleString("ru-RU")} ₽/мес`;
  if (offer?.benefit_type === "free_period") {
    price = `${offer.free_months} мес. бесплатно`;
  } else if (offer?.pricing?.current != null) {
    price = `${Number(offer.pricing.current).toLocaleString("ru-RU")} ₽/мес`;
  }

  return (
    <div className={`cum-plan-card${isCurrent ? " cum-plan-card--current" : ""}${plan.is_recommended ? " cum-plan-card--recommended" : ""}`}>
      {plan.is_recommended && <span className="cum-badge">Оптимально</span>}
      {isCurrent && <span className="cum-badge cum-badge--current">Текущий</span>}
      {offer ? <span className="cum-badge">Акция</span> : null}
      <div className="cum-plan-name">{plan.name}</div>
      <div className="cum-plan-price">{price}</div>
      {offer?.pricing?.original && offer.benefit_type !== "free_period" ? (
        <div className="cum-plan-summary">
          <s>{Number(offer.pricing.original).toLocaleString("ru-RU")} ₽</s>
          {offer.pricing.renewal ? ` · далее ${Number(offer.pricing.renewal).toLocaleString("ru-RU")} ₽/мес` : ""}
        </div>
      ) : (
        <div className="cum-plan-summary">{summary}</div>
      )}
      {!isCurrent && (
        <button type="button" className="cum-plan-btn" onClick={() => onSelect(plan.slug)}>
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
  onCompareAll,
  onClose,
}) {
  const currentSlug = currentPlan?.slug;
  const [promoInput, setPromoInput] = useState("");
  const [promoState, setPromoState] = useState(null); // { valid, message, discount }
  const [promoLoading, setPromoLoading] = useState(false);

  // Показываем: текущий + рекомендуемый (если разные)
  const visiblePlans = plans.filter(
    (p) => p.slug === currentSlug || p.slug === recommendedSlug,
  );

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
      const data = await validatePromoCode(code, recommendedSlug);
      setPromoState({ valid: true, message: `−${data.discount} ₽`, discount: data });
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
        <p className="upm-text cum-subtitle">Выберите подходящий вариант.</p>

        <div className="cum-plans">
          {visiblePlans.map((p) => (
            <PlanCard
              key={p.slug}
              plan={p}
              isCurrent={p.slug === currentSlug}
              onSelect={onSelectPlan}
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
