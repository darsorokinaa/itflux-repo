/**
 * Публичная витрина тарифов /pricing/
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TEACHERS_TELEGRAM_URL } from "../config/teacherLinks";
import "./pricing.css";

const FAQ = [
  {
    q: "Можно ли пользоваться без регистрации?",
    a: "Да: собирать варианты и рабочие тетради в пределах лимита. Кабинет учителя, ученики и расширенная библиотека — после регистрации.",
  },
  {
    q: "Что будет с учениками при смене тарифа?",
    a: "Существующие ученики не удаляются. Если лимит стал ниже текущего числа, нельзя добавить новых, пока не освободите места или не повысите тариф.",
  },
  {
    q: "Есть ли годовая оплата?",
    a: "Да. На витрине можно переключить период «месяц / год» — годовая цена указана у каждого тарифа.",
  },
  {
    q: "Как оформить тариф «Школа»?",
    a: "Оставьте заявку — подключим индивидуально под вашу команду и роли.",
  },
];

function formatOfferUntil(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function formatPrice(value) {
  const n = Number(value);
  if (!n) return "Бесплатно";
  return `${n.toLocaleString("ru-RU")} ₽`;
}

function PlanFeatures({ plan }) {
  const l = plan.limits || {};
  const f = plan.features || {};

  let rows = [];
  let caveat = null;

  if (plan.slug === "start") {
    rows = [
      l.students != null && `до ${l.students} учеников`,
      "домашние задания и проверка",
      l.variants_monthly != null && `${l.variants_monthly} вариантов в месяц`,
      l.workbooks_monthly != null && `${l.workbooks_monthly} рабочих тетрадей в месяц`,
      "бесплатные материалы",
    ].filter(Boolean);
    caveat = "Без расписания, журнала и видеозанятий.";
  } else if (plan.slug === "teacher") {
    rows = [
      l.students != null && `до ${l.students} активных учеников`,
      "расписание и журнал",
      "видеозанятия прямо на платформе",
      "ДЗ и проверка",
      l.variants_monthly != null && `${l.variants_monthly} вариантов в месяц`,
      l.workbooks_monthly != null && `${l.workbooks_monthly} рабочих тетрадей`,
      "расширенная библиотека",
    ].filter(Boolean);
  } else if (plan.slug === "pro") {
    rows = [
      l.students != null && `до ${l.students} активных учеников`,
      "расписание, журнал и видеозанятия",
      l.variants_monthly == null ? "генератор вариантов без лимита" : `${l.variants_monthly} вариантов в месяц`,
      l.workbooks_monthly == null ? "рабочие тетради без лимита" : `${l.workbooks_monthly} тетрадей в месяц`,
      l.interactives == null ? "интерактивы без лимита" : `${l.interactives} интерактивов в месяц`,
      "полная основная библиотека",
      f.simulators && "симуляторы",
    ].filter(Boolean);
  } else if (plan.slug === "premium") {
    rows = [
      l.students != null && `до ${l.students} активных учеников`,
      "группы без лимита",
      "полная библиотека и Premium-материалы",
      "симуляторы и межпредметные проекты",
      "генератор и тетради без лимита",
      f.priority_support && "приоритетная поддержка",
    ].filter(Boolean);
  } else {
    rows = [
      l.students != null && `До ${l.students} учеников`,
      l.groups != null && `До ${l.groups} групп`,
      f.multi_teacher && "Несколько учителей",
      f.team_roles && "Роли в команде",
      f.priority_support && "Приоритетная поддержка",
    ].filter(Boolean);
  }

  return (
    <>
      <ul className="pricing-card__list">
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
      {caveat ? <p className="pricing-card__caveat">{caveat}</p> : null}
    </>
  );
}

export default function PricingPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cabinet/pricing/plans/", {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("Не удалось загрузить тарифы");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e.message || "Ошибка загрузки");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const plans = useMemo(() => data?.plans || [], [data]);
  const anon = data?.anonymous;
  const promo = data?.registration_promo;
  const promotions = data?.promotions || [];

  return (
    <div className="pricing-page">
      <header className="pricing-hero">
        <p className="pricing-hero__brand">Цифровой поток</p>
        <h1 className="pricing-hero__title">Тарифы для учителей</h1>
        <p className="pricing-hero__lead">
          «Старт» — чтобы познакомиться. «Учитель» — чтобы вести занятия. Дальше —
          больше лимитов и вся библиотека.
        </p>
        <div className="pricing-period" role="group" aria-label="Период оплаты">
          <button
            type="button"
            className={period === "month" ? "is-active" : ""}
            onClick={() => setPeriod("month")}
          >
            Месяц
          </button>
          <button
            type="button"
            className={period === "year" ? "is-active" : ""}
            onClick={() => setPeriod("year")}
          >
            Год
          </button>
        </div>
      </header>

      {loading && <p className="pricing-status">Загрузка…</p>}
      {error && <p className="pricing-status pricing-status--err">{error}</p>}

      {promo?.active ? (
        <div className="pricing-promo" role="status">
          <strong>{promo.title}</strong>
          <p>{promo.message}</p>
        </div>
      ) : null}

      {promotions.filter((o) => o.can_redeem || o.status === "ended" || !o.can_redeem && o.status === "active").length ? (
        <section className="pricing-offers" aria-label="Специальные предложения">
          {promotions.map((offer) => (
            <article key={offer.id} className="pricing-offer">
              <strong>{offer.title}</strong>
              {offer.short_description ? <p>{offer.short_description}</p> : null}
              <p className="pricing-offer__meta">
                {offer.plan?.name}
                {offer.ends_at ? ` · до ${formatOfferUntil(offer.ends_at)}` : ""}
              </p>
            </article>
          ))}
        </section>
      ) : null}

      {anon ? (
        <section className="pricing-anon" aria-labelledby="pricing-anon-title">
          <h2 id="pricing-anon-title">{anon.title}</h2>
          <p>{anon.description}</p>
          <p className="pricing-anon__limits">
            Лимиты: {anon.limits?.variants ?? 5} вариантов · {anon.limits?.workbooks ?? 3} тетради
          </p>
        </section>
      ) : null}

      <section className="pricing-grid" aria-label="Тарифы">
        {plans.map((plan) => {
          const isContact = plan.cta_type === "contact" || plan.slug === "school";
          const offer = plan.promotion;
          const offerLive =
            offer?.can_redeem &&
            !(period === "year" && offer.benefit_type === "fixed_price");
          const rawPrice = period === "year" ? plan.price_year : plan.price_month;
          let price = isContact
            ? "По запросу"
            : formatPrice(rawPrice);
          if (!isContact && offerLive && offer.benefit_type === "free_period") {
            price = "Бесплатно";
          } else if (!isContact && offerLive && offer.pricing?.current != null) {
            price = formatPrice(offer.pricing.current);
          }
          const priceSuffix =
            !isContact && (offerLive || Number(rawPrice) > 0)
              ? period === "year" && !offerLive
                ? "/год"
                : "/мес"
              : "";
          const cta = plan.cta_type || "checkout";
          return (
            <article
              key={plan.slug}
              className={[
                "pricing-card",
                plan.is_recommended || plan.is_featured ? "pricing-card--featured" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {(plan.badge_text || plan.is_recommended || offerLive) && (
                <div className="pricing-card__badge">
                  {offerLive ? "Специальное предложение" : plan.badge_text || "Рекомендуем"}
                </div>
              )}
              <h2 className="pricing-card__name">{plan.name}</h2>
              <p className="pricing-card__desc">
                {plan.short_description || plan.description}
              </p>
              <p className="pricing-card__price">
                {offerLive && offer.pricing?.original && offer.benefit_type !== "free_period" ? (
                  <s className="pricing-card__was">{formatPrice(offer.pricing.original)}</s>
                ) : null}
                {price}
                {priceSuffix ? <span>{priceSuffix}</span> : null}
                {isContact ? (
                  <span className="pricing-card__price-note"> индивидуально</span>
                ) : null}
              </p>
              {offerLive && offer.ends_at ? (
                <p className="pricing-card__caveat">
                  Доступно до {formatOfferUntil(offer.ends_at)}
                  {offer.pricing?.renewal && offer.benefit_type !== "free_period"
                    ? ` · далее ${formatPrice(offer.pricing.renewal)}/мес`
                    : ""}
                </p>
              ) : null}
              <PlanFeatures plan={plan} />
              {cta === "contact" ? (
                <a
                  className="pricing-card__cta pricing-card__cta--outline"
                  href={TEACHERS_TELEGRAM_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Оставить заявку
                </a>
              ) : cta === "register" || plan.is_free ? (
                <Link className="pricing-card__cta" to="/cabinet/login">
                  Начать бесплатно
                </Link>
              ) : (
                <Link
                  className="pricing-card__cta"
                  to={`/cabinet/upgrade?plan=${plan.slug}&period=${period}`}
                >
                  Выбрать
                </Link>
              )}
            </article>
          );
        })}
      </section>

      <section className="pricing-compare" aria-labelledby="pricing-compare-title">
        <h2 id="pricing-compare-title">Сравнение</h2>
        <div className="pricing-compare__scroll">
          <table>
            <thead>
              <tr>
                <th>Возможность</th>
                {plans.map((p) => (
                  <th key={p.slug}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Цена / мес</td>
                {plans.map((p) => (
                  <td key={p.slug}>
                    {p.cta_type === "contact" || p.slug === "school"
                      ? "По запросу"
                      : formatPrice(p.price_month)}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Активные ученики</td>
                {plans.map((p) => (
                  <td key={p.slug}>{p.limits?.students ?? "—"}</td>
                ))}
              </tr>
              <tr>
                <td>Группы</td>
                {plans.map((p) => (
                  <td key={p.slug}>
                    {p.limits?.groups == null ? "Без лимита" : p.limits.groups}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Генератор вариантов</td>
                {plans.map((p) => (
                  <td key={p.slug}>
                    {p.limits?.variants_monthly == null
                      ? "Без лимита"
                      : `${p.limits.variants_monthly}/мес`}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Рабочие тетради</td>
                {plans.map((p) => (
                  <td key={p.slug}>
                    {p.limits?.workbooks_monthly == null
                      ? "Без лимита"
                      : `${p.limits.workbooks_monthly}/мес`}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Интерактивы</td>
                {plans.map((p) => (
                  <td key={p.slug}>
                    {p.limits?.interactives == null
                      ? "Без лимита"
                      : `${p.limits.interactives}/мес`}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Расписание / журнал / видео</td>
                {plans.map((p) => (
                  <td key={p.slug}>{(p.content_access_rank ?? 0) >= 1 ? "✓" : "—"}</td>
                ))}
              </tr>
              <tr>
                <td>Библиотека</td>
                {plans.map((p) => {
                  const labels = [
                    "Бесплатные",
                    "Расширенная",
                    "Полная",
                    "Premium",
                    "Корпоративная",
                  ];
                  return (
                    <td key={p.slug}>
                      {labels[p.content_access_rank ?? 0] || "—"}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td>Хранилище</td>
                {plans.map((p) => {
                  const mb = p.limits?.storage_mb;
                  let label = "—";
                  if (mb != null) {
                    label = mb >= 1024 ? `${Math.round(mb / 1024)} ГБ` : `${mb} МБ`;
                  }
                  return <td key={p.slug}>{label}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="pricing-faq" aria-labelledby="pricing-faq-title">
        <h2 id="pricing-faq-title">Вопросы</h2>
        <dl>
          {FAQ.map((item) => (
            <div key={item.q} className="pricing-faq__item">
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
