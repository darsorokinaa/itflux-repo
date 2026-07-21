/**
 * /cabinet/upgrade — страница сравнения тарифов.
 *
 * Открывается только контекстно (из upgrade modal, профиля, ссылок «Сравнить тарифы»).
 * НЕ добавляется в sidebar.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TEACHERS_TELEGRAM_URL } from "../../config/teacherLinks";
import { changePlan, createPayment, fetchSubscriptionPlans, validatePromoCode } from "../../utils/cabinetAuth";
import { CabinetPageHeader, CabinetPageShell } from "../CabinetSectionUi";

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7l3.5 3.5L12 3.5" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlanCard({ plan, isCurrent, onSelect, selecting, promoActive }) {
  const l = plan.limits || {};
  const isProPromo = promoActive && plan.slug === "pro";
  const price =
    Number(plan.price_month) === 0
      ? "Бесплатно"
      : isProPromo
        ? "3 месяца в подарок"
        : `${Number(plan.price_month).toLocaleString("ru-RU")} ₽/мес`;

  const features = [
    l.students != null && `${l.students} учеников`,
    l.groups != null && `${l.groups} групп`,
    l.lessons != null && `${l.lessons} уроков`,
    l.interactives != null && `${l.interactives} интерактивов`,
    l.ai_requests != null && `${l.ai_requests} ИИ-запросов/мес`,
    plan.features?.homework && "Домашние задания",
    plan.features?.review && "Проверка работ",
    plan.features?.extended_library && "Расширенная библиотека",
    plan.features?.basic_notifications && "Уведомления",
    plan.features?.multi_teacher && "Несколько учителей",
    plan.features?.team_roles && "Роли в команде",
  ].filter(Boolean);

  return (
    <div className={[
      "upg-card",
      isCurrent ? "upg-card--current" : "",
      plan.is_recommended || isProPromo ? "upg-card--recommended" : "",
      isProPromo ? "upg-card--promo" : "",
    ].filter(Boolean).join(" ")}>
      {isProPromo ? (
        <div className="upg-card__badge upg-card__badge--promo">Акция до 1 октября</div>
      ) : plan.is_recommended ? (
        <div className="upg-card__badge">Оптимально</div>
      ) : null}
      {isCurrent && <div className="upg-card__badge upg-card__badge--current">Текущий</div>}

      <div className="upg-card__head">
        <span className="upg-card__name">{plan.name}</span>
        <span className="upg-card__price">
          {price}
          {isProPromo && Number(plan.price_month) > 0 ? (
            <span className="upg-card__price-old">
              {Number(plan.price_month).toLocaleString("ru-RU")} ₽/мес
            </span>
          ) : null}
        </span>
      </div>

      <ul className="upg-card__features">
        {features.map((f) => (
          <li key={f}><CheckIcon />{f}</li>
        ))}
      </ul>

      {plan.slug === "school" ? (
        <a
          href={TEACHERS_TELEGRAM_URL}
          target="_blank"
          rel="noreferrer"
          className="upg-card__btn upg-card__btn--outline"
        >
          Оставить заявку
        </a>
      ) : isCurrent ? (
        <div className="upg-card__current-label">Текущий тариф</div>
      ) : (
        <button
          type="button"
          className="upg-card__btn"
          onClick={() => onSelect(plan.slug)}
          disabled={selecting === plan.slug}
        >
          {selecting === plan.slug ? "Подождите…" : `Выбрать ${plan.name}`}
        </button>
      )}
    </div>
  );
}

export default function CabinetUpgradePage() {
  const [plansData, setPlansData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(null);
  const [notice, setNotice] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [promoState, setPromoState] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSubscriptionPlans()
      .then(setPlansData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handlePromoCheck = async (slug) => {
    const code = promoInput.trim();
    if (!code) return;
    setPromoLoading(true);
    setPromoState(null);
    try {
      const data = await validatePromoCode(code, slug || null);
      setPromoState({ valid: true, message: `Скидка −${data.discount} ₽`, discount: data });
    } catch (err) {
      setPromoState({ valid: false, message: err.data?.message || "Промокод не найден" });
    } finally {
      setPromoLoading(false);
    }
  };

  const handleSelect = async (slug) => {
    setSelecting(slug);
    try {
      const result = await changePlan(slug);
      if (result.requires_payment) {
        const promoCode = promoState?.valid ? promoInput.trim() : null;
        const payment = await createPayment(slug, "month", promoCode);
        if (payment.payment_url) {
          window.location.href = payment.payment_url;
          return;
        }
      }
      setNotice("Тариф обновлён.");
      setTimeout(() => navigate("/cabinet"), 1200);
    } catch {
      setNotice("Не удалось изменить тариф. Попробуйте позже.");
    } finally {
      setSelecting(null);
    }
  };

  const currentSlug = plansData?.current_slug;
  const plans = plansData?.plans || [];
  const registrationPromo = plansData?.registration_promo;
  const promoActive = Boolean(registrationPromo?.active);
  const expiresAt = plansData?.subscription?.expires_at;
  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    : "";

  return (
    <CabinetPageShell className="upg-shell">
      <div className="upg-back-row">
        <Link to="/cabinet" className="upg-back">
          ← Назад
        </Link>
      </div>

      <CabinetPageHeader title="Тарифы" />

      {notice && <div className="cb-soon-toast" role="status">{notice}</div>}

      {loading ? (
        <p className="st-loading">Загрузка тарифов…</p>
      ) : (
        <>
          {promoActive ? (
            <div className="upg-promo-banner" role="status">
              <strong>{registrationPromo.title || "Акция до 1 октября"}</strong>
              <p>
                {registrationPromo.message
                  || "Всем зарегистрировавшимся — тариф «Профи» на 3 месяца с даты регистрации."}
              </p>
              {currentSlug === "pro" && expiresLabel ? (
                <p className="upg-promo-banner__meta">
                  Ваш «Профи» действует до {expiresLabel}
                </p>
              ) : (
                <p className="upg-promo-banner__meta">
                  Тариф выдаётся автоматически при регистрации учителя.
                </p>
              )}
            </div>
          ) : null}

          <div className="upg-promo-row">
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
                onClick={() => handlePromoCheck()}
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

          <div className="upg-grid">
            {plans.map((plan) => (
              <PlanCard
                key={plan.slug}
                plan={plan}
                isCurrent={plan.slug === currentSlug}
                onSelect={handleSelect}
                selecting={selecting}
                promoActive={promoActive}
              />
            ))}
          </div>
        </>
      )}
    </CabinetPageShell>
  );
}
