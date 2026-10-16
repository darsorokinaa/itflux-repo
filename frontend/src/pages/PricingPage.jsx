/**
 * Публичная витрина тарифов /pricing (r50: Старт / Репетитор / Профи / Школа).
 * Тексты — дословно из брифа владельца. Лимиты совпадают с TariffPlan в БД
 * и проверками в Cabinet/tariff_usage.py / subscription_access.py.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import "./pricing.css";
import "../r52/r52.css";
import { PROMO_UNTIL } from "../r52/consentTexts";
import SchoolRequestModal from "../components/SchoolRequestModal";
import { ensureCsrfCookie, getCsrfToken } from "../utils/cabinetAuth";

const fmt = (n) => Number(n).toLocaleString("ru-RU").replace(/\u00a0/g, " ");

const PLANS = [
  {
    slug: "start",
    name: "Старт",
    month: 0,
    lead: "Чтобы попробовать платформу с первыми учениками.",
    bullets: [
      "До 5 учеников",
      "Полный кабинет: расписание, журнал, видеоуроки, учёт оплат, проверка ДЗ",
      "Бесплатная библиотека материалов и банк ФИПИ",
      "10 вариантов и 3 рабочих листа в месяц",
      "ИИ-помощник «Цифрик»: 30 токенов в месяц",
    ],
  },
  {
    slug: "teacher",
    name: "Репетитор",
    month: 990,
    year: 8316,
    lead: "Для репетитора с постоянной группой учеников.",
    bullets: [
      "До 15 учеников",
      "Всё из тарифа «Старт»",
      "Расширенная библиотека материалов",
      "50 вариантов, 20 рабочих листов и 10 интерактивов в месяц",
      "Ссылка для самостоятельной записи учеников",
      "ИИ-помощник «Цифрик»: 200 токенов в месяц",
    ],
  },
  {
    slug: "pro",
    name: "Профи",
    month: 1990,
    year: 16716,
    badge: "Рекомендуем",
    lead: "Для тех, кто ведёт много учеников и групп.",
    bullets: [
      "Без ограничений по ученикам и группам",
      "Всё из тарифа «Репетитор»",
      "Полная библиотека: банк ФИПИ, генератор, тренажёры",
      "Без ограничений по вариантам, рабочим листам и интерактивам",
      "ИИ-помощник «Цифрик»: 1000 токенов в месяц",
      "Аналитика по ученикам",
    ],
  },
  {
    slug: "school",
    name: "Школа",
    contact: true,
    lead: "Для школ и учебных центров с несколькими преподавателями.",
    bullets: [
      "Всё из тарифа «Профи» для каждого преподавателя",
      "Количество преподавателей и учеников — по договорённости",
      "Условия подключения обсуждаем индивидуально",
    ],
  },
];

const ROWS = [
  ["Цена в месяц", "0 ₽", "990 ₽", "1 990 ₽", "по запросу"],
  ["Цена в год", "—", "8 316 ₽ (≈ 693 ₽/мес)", "16 716 ₽ (≈ 1 393 ₽/мес)", "по запросу"],
  ["Ученики", "до 5", "до 15", "без ограничений", "по договорённости"],
  ["Группы", "✓ (в пределах лимита учеников)", "✓ (в пределах лимита учеников)", "без ограничений", "без ограничений"],
  ["Расписание", "✓", "✓", "✓", "✓"],
  ["Журнал", "✓", "✓", "✓", "✓"],
  ["Видеоуроки", "✓", "✓", "✓", "✓"],
  ["Учёт оплат", "✓", "✓", "✓", "✓"],
  ["Проверка ДЗ", "✓", "✓", "✓", "✓"],
  ["Ссылка для записи учеников", "—", "✓", "✓", "✓"],
  ["Библиотека", "бесплатная", "расширенная", "полная", "полная"],
  ["Банк ФИПИ", "✓", "✓", "✓", "✓"],
  ["Генератор", "10/мес", "50/мес", "✓ без ограничений", "✓ без ограничений"],
  ["Тренажёры", "—", "—", "✓", "✓"],
  ["Варианты в месяц", "10", "50", "без ограничений", "без ограничений"],
  ["Рабочие листы в месяц", "3", "20", "без ограничений", "без ограничений"],
  ["Интерактивы в месяц", "—", "10", "без ограничений", "без ограничений"],
  ["ИИ-помощник «Цифрик»", "30 токенов/мес", "200 токенов/мес", "1000 токенов/мес", "по договорённости"],
  ["Аналитика", "—", "—", "✓", "✓"],
  ["Пробный период", "—", "—", "14 дней для новых преподавателей", "—"],
];

const FAQ = [
  {
    q: "Что такое токены и на что они тратятся?",
    a: (
      <>
        Токены — это внутренняя единица работы ИИ-помощника «Цифрик». Каждый месяц начисляется: «Старт» — 30
        токенов, «Репетитор» — 200, «Профи» — 1000, «Школа» — по договорённости. Токены расходуются на: ответ
        «Цифрика» — 1–3 токена (короткий, длинный или массовый запрос), разбор фото — 3, картинку — 10; в
        ИИ-конструкторе листов: переформулировка или адаптация задания под тему — 1, новое задание — 3, блок
        теории — 2, оформление — 5, картинка к заданию — 8. Сборка листа из банка заданий токены не тратит.
        Чем длиннее запрос и ответ, тем больше токенов уходит. Остаток видно в верхней панели сайта и кабинета
        (значок токенов рядом с профилем). Неизрасходованные токены переносятся на один месяц.
      </>
    ),
  },
  {
    q: "Как работает пробный период?",
    a: "Новые преподаватели получают 14 дней тарифа «Профи» бесплатно, со всеми возможностями. За 3 дня и в последний день придёт напоминание. Когда пробный период закончится, аккаунт перейдёт на «Старт». Все материалы и данные учеников сохранятся.",
  },
  {
    q: "Что будет, если я достигну лимита?",
    a: "Мы ничего не удалим и не заблокируем. Создать новый вариант, лист или интерактив сверх лимита не получится до начала следующего месяца или до перехода на тариф выше. Когда до лимита останется 20 %, появится предупреждение. Если учеников больше, чем позволяет тариф, добавить нового будет нельзя, а уже добавленные останутся. То же самое — при переходе на тариф ниже.",
  },
  {
    q: "Чем выгодна оплата за год?",
    a: "Она на 30 % дешевле помесячной: «Репетитор» стоит 8 316 ₽ вместо 11 880 ₽, «Профи» — 16 716 ₽ вместо 23 880 ₽. Оплата вносится сразу за 12 месяцев.",
  },
  {
    q: "Можно ли отменить подписку?",
    a: (
      <>
        Да, в любой момент в разделе «Кабинет → Подписка и оплата» (кнопка «Отключить автопродление»). Доступ к
        тарифу сохранится до конца оплаченного периода, после этого аккаунт перейдёт на «Старт». Данные
        сохранятся. Условия возврата — по <Link to="/offer">оферте</Link>.
      </>
    ),
  },
  {
    q: "У меня был бесплатный «Премиум» на 3 месяца. Что будет после него?",
    a: "За 7 и за 3 дня до окончания придёт напоминание с кнопкой оплаты и специальным предложением на продление. Если не продлить, аккаунт перейдёт на «Старт». Все данные сохранятся.",
  },
  {
    q: "Как подключить школу или учебный центр?",
    a: "Оставьте заявку в карточке «Школа». Мы свяжемся с вами и подберём условия под число преподавателей и учеников.",
  },
];

function formatHours(h) {
  const n = Number(h);
  if (!n) return "0";
  return Number.isInteger(n) ? fmt(n) : String(n).replace(".", ",");
}

export default function PricingPage() {
  const [period, setPeriod] = useState("year");
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cabinet/r50/pricing-me/", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setMe(d); })
      .catch(() => { if (!cancelled) setMe(null); });
    return () => { cancelled = true; };
  }, []);

  const teacher = !!(me && me.authenticated && me.is_teacher);
  const current = teacher ? me.current_plan : null;
  const trial = teacher ? me.trial || {} : {};

  const startTrial = async () => {
    setBusy(true);
    setNotice("");
    try {
      await ensureCsrfCookie();
      const res = await fetch("/api/cabinet/r50/trial/start/", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setNotice(data.detail || "Не удалось включить пробный период.");
        setBusy(false);
        return;
      }
      navigate("/cabinet?trial=started");
    } catch {
      setNotice("Нет связи с сервером. Попробуйте ещё раз.");
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.get("trial") === "1" && teacher && trial.available && !busy) startTrial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacher, trial.available]);

  const registerUrl = (next) => `/cabinet/login?mode=register&next=${encodeURIComponent(next)}`;

  const cta = (plan) => {
    if (plan.contact) {
      return (
        <button type="button" className="pricing-card__cta pricing-card__cta--outline" onClick={() => setSchoolOpen(true)}>
          Оставить заявку
        </button>
      );
    }
    if (current && current === plan.slug) {
      return <button type="button" className="pricing-card__cta pricing-card__cta--current" disabled>Ваш текущий тариф</button>;
    }
    if (plan.slug === "start") {
      return teacher ? (
        <Link className="pricing-card__cta pricing-card__cta--outline" to="/cabinet">Начать бесплатно</Link>
      ) : (
        <Link className="pricing-card__cta pricing-card__cta--outline" to={registerUrl("/cabinet")}>Начать бесплатно</Link>
      );
    }
    const upgrade = `/cabinet/upgrade?plan=${plan.slug}&period=${period}`;
    if (plan.slug === "pro") {
      if (!teacher) {
        return <Link className="pricing-card__cta" to={registerUrl("/pricing?trial=1")}>Попробовать 14 дней бесплатно</Link>;
      }
      if (trial.available) {
        return (
          <button type="button" className="pricing-card__cta" onClick={startTrial} disabled={busy}>
            {busy ? "Включаем…" : "Попробовать 14 дней бесплатно"}
          </button>
        );
      }
      return <Link className="pricing-card__cta" to={upgrade}>Перейти на «Профи»</Link>;
    }
    return teacher ? (
      <Link className="pricing-card__cta" to={upgrade}>Выбрать «Репетитор»</Link>
    ) : (
      <Link className="pricing-card__cta" to={registerUrl(upgrade)}>Выбрать «Репетитор»</Link>
    );
  };

  const saved = teacher && me.saved && Number(me.saved.hours) > 0 ? me.saved : null;
  const colIndex = useMemo(() => ({ start: 1, teacher: 2, pro: 3, school: 4 }), []);

  return (
    <div className="pricing-page pricing-page--r50">
      <header className="pricing-hero">
        <h1 className="pricing-hero__brand">Тарифы для репетиторов</h1>
        <p className="pricing-hero__lead">
          Расписание, журнал, учёт оплат и проверка ДЗ доступны на всех тарифах, даже на бесплатном. Тариф
          выбирайте по числу учеников и объёму материалов.
        </p>
        <div className="pricing-period" role="group" aria-label="Период оплаты">
          <button type="button" className={period === "month" ? "is-active" : ""} aria-pressed={period === "month"} onClick={() => setPeriod("month")}>
            Помесячно
          </button>
          <button type="button" className={period === "year" ? "is-active" : ""} aria-pressed={period === "year"} onClick={() => setPeriod("year")}>
            За год −30 %
          </button>
        </div>
      </header>

      {saved ? (
        <section className="pricing-saved" aria-label="Сэкономленное время">
          <p className="pricing-saved__title">
            Вы сэкономили ≈ {formatHours(saved.hours)} ч с «Цифровым потоком»
          </p>
          <p className="pricing-saved__text">
            Время, которое не пришлось тратить на подбор вариантов, проверку ДЗ и учёт оплат.
          </p>
          <p className="pricing-saved__note">
            По нашей оценке: вариант ≈ 15 мин, проверка ДЗ ≈ 10 мин, запись в журнале ≈ 5 мин, учёт оплаты ≈ 2 мин.
          </p>
        </section>
      ) : null}

      {Date.now() <= PROMO_UNTIL.getTime() ? (
        <p className="r52-promo">
          До 30 ноября: <b>−50 %</b> на первый месяц «Профи» по промокоду <b>potok1110</b> или <b>−40 %</b> на «Профи» за год по
          промокоду <b>potok1110y</b>.
        </p>
      ) : null}

      {notice ? <p className="pricing-status pricing-status--err" role="alert">{notice}</p> : null}

      <section className="pricing-grid pricing-grid--4" aria-label="Тарифы">
        {PLANS.map((plan) => {
          const yearly = period === "year" && plan.year;
          const perMonth = yearly ? Math.round(plan.year / 12) : plan.month;
          return (
            <article
              key={plan.slug}
              className={["pricing-card", plan.badge ? "pricing-card--featured" : ""].filter(Boolean).join(" ")}
            >
              {plan.badge ? <div className="pricing-card__badge">{plan.badge}</div> : null}
              <h2 className="pricing-card__name">{plan.name}</h2>
              <p className="pricing-card__price">
                {plan.contact ? (
                  "По запросу"
                ) : plan.month === 0 ? (
                  <>0 ₽ <span>навсегда</span></>
                ) : (
                  <>{fmt(perMonth)} ₽<span>/мес</span></>
                )}
              </p>
              {yearly ? (
                <div className="pricing-card__yearly">
                  <p className="pricing-card__now">{fmt(plan.year)} ₽ в год, оплата сразу</p>
                  <p className="pricing-card__save">
                    <s>{fmt(plan.month * 12)} ₽</s> · экономия {fmt(plan.month * 12 - plan.year)} ₽
                  </p>
                </div>
              ) : plan.year ? (
                <p className="pricing-card__now">или {fmt(Math.round(plan.year / 12))} ₽/мес при оплате за год</p>
              ) : null}
              <p className="pricing-card__desc">{plan.lead}</p>
              <ul className="pricing-card__list">
                {plan.bullets.map((b) => <li key={b}>{b}</li>)}
              </ul>
              <div className="pricing-card__actions">
                {cta(plan)}
                {plan.slug === "pro" ? (
                  <p className="pricing-card__fine">
                    Для новых преподавателей. После пробного периода — переход на «Старт», данные сохранятся.
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <section className="pricing-compare" aria-labelledby="pricing-compare-title">
        <h2 id="pricing-compare-title">Сравнение тарифов</h2>
        <div className="pricing-compare__scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Возможность</th>
                {PLANS.map((p) => (
                  <th scope="col" key={p.slug} className={current === p.slug ? "is-current" : ""}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row[0]}>
                  <th scope="row">{row[0]}</th>
                  {PLANS.map((p) => (
                    <td key={p.slug} className={current === p.slug ? "is-current" : ""}>{row[colIndex[p.slug]]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pricing-compare__hint">
          Не знаете, что выбрать? Начните со «Старта» — перейти на другой тариф можно в любой момент.
        </p>
      </section>

      <section className="pricing-faq" aria-labelledby="pricing-faq-title">
        <h2 id="pricing-faq-title">Вопросы и ответы</h2>
        <dl>
          {FAQ.map((item) => (
            <div key={item.q} className="pricing-faq__item">
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="pricing-legal">
        Оплачивая тариф, вы принимаете условия <Link to="/offer">публичной оферты</Link>. <Link to="/contacts">Контакты и реквизиты</Link>.
      </p>

      {schoolOpen ? <SchoolRequestModal onClose={() => setSchoolOpen(false)} /> : null}
    </div>
  );
}
