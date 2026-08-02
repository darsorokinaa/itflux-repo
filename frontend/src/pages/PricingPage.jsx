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

function formatPrice(value) {
  const n = Number(value);
  if (!n) return "Бесплатно";
  return `${n.toLocaleString("ru-RU")} ₽`;
}

function PlanFeatures({ plan }) {
  const l = plan.limits || {};
  const f = plan.features || {};
  const rows = [
    l.students != null && `До ${l.students} учеников`,
    l.groups != null && `До ${l.groups} групп`,
    l.variants_monthly != null
      ? `Варианты: ${l.variants_monthly}/мес`
      : "Варианты без лимита",
    l.workbooks_monthly != null
      ? `Тетради: ${l.workbooks_monthly}/мес`
      : "Тетради без лимита",
    f.extended_library && "Расширенная библиотека",
    f.simulators && "Симуляторы",
    f.analytics && "Аналитика",
    f.priority_support && "Приоритетная поддержка",
    f.multi_teacher && "Несколько учителей",
    f.team_roles && "Роли в команде",
    plan.monthly_library_promise && "Не менее 5 новых материалов в месяц",
  ].filter(Boolean);

  return (
    <ul className="pricing-card__list">
      {rows.map((row) => (
        <li key={row}>{row}</li>
      ))}
    </ul>
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

  return (
    <div className="pricing-page">
      <header className="pricing-hero">
        <p className="pricing-hero__brand">Цифровой поток</p>
        <h1 className="pricing-hero__title">Тарифы для учителей</h1>
        <p className="pricing-hero__lead">
          Выберите уровень доступа к кабинету и библиотеке. Без ИИ-кредитов и скрытых лимитов на витрине.
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
          const rawPrice = period === "year" ? plan.price_year : plan.price_month;
          const price = isContact
            ? "По запросу"
            : formatPrice(rawPrice);
          const priceSuffix =
            !isContact && Number(rawPrice) > 0
              ? period === "year"
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
              {(plan.badge_text || plan.is_recommended) && (
                <div className="pricing-card__badge">
                  {plan.badge_text || "Рекомендуем"}
                </div>
              )}
              <h2 className="pricing-card__name">{plan.name}</h2>
              <p className="pricing-card__desc">
                {plan.short_description || plan.description}
              </p>
              <p className="pricing-card__price">
                {price}
                {priceSuffix ? <span>{priceSuffix}</span> : null}
                {isContact ? (
                  <span className="pricing-card__price-note"> индивидуально</span>
                ) : null}
              </p>
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
                <td>Ученики</td>
                {plans.map((p) => (
                  <td key={p.slug}>{p.limits?.students ?? "—"}</td>
                ))}
              </tr>
              <tr>
                <td>Группы</td>
                {plans.map((p) => (
                  <td key={p.slug}>{p.limits?.groups ?? "—"}</td>
                ))}
              </tr>
              <tr>
                <td>Библиотека</td>
                {plans.map((p) => (
                  <td key={p.slug}>
                    {["Free", "Учитель", "Профи", "Премиум", "Школа"][
                      p.content_access_rank ?? 0
                    ] || "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Несколько учителей</td>
                {plans.map((p) => (
                  <td key={p.slug}>{p.features?.multi_teacher ? "Да" : "—"}</td>
                ))}
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
