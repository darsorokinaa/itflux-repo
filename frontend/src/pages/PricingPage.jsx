/**
 * Публичная витрина тарифов /pricing (r50: Старт / Репетитор / Профи / Школа).
 * r56: лимиты и цены берутся из /api/cabinet/pricing/plans/ (TariffPlan в БД),
 * при недоступности API — запасные значения FALLBACK.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import "./pricing.css";
import "../r52/r52.css";
import { PROMO_UNTIL } from "../r52/consentTexts";
import SchoolRequestModal from "../components/SchoolRequestModal";
import TeacherQuotesBlock from "../components/TeacherQuotesBlock";
import { ensureCsrfCookie, getCsrfToken } from "../utils/cabinetAuth";

const fmt = (n) => Number(n).toLocaleString("ru-RU").replace(/\u00a0/g, " ");

/** r56: запасные значения на случай, если API недоступно. Совпадают с TariffPlan в БД на 16.10.2026. */
const FALLBACK = {
  start: { students: 5, variants: 10, workbooks: 3, interactives: 0, tokens: 30, aiDay: 20, storageMb: 512, tasks: 20, watermark: true },
  teacher: { students: 15, variants: 50, workbooks: 20, interactives: 10, tokens: 200, aiDay: 60, storageMb: 1024, tasks: 500, watermark: false, month: 990, year: 8316 },
  pro: { students: null, variants: null, workbooks: null, interactives: null, tokens: 1000, aiDay: 200, storageMb: 3072, tasks: 5000, watermark: false, month: 1990, year: 16716 },
  school: { students: null, variants: null, workbooks: null, interactives: null, tokens: 2000, aiDay: 500, storageMb: 102400, tasks: null, watermark: false },
};

/** Значения тарифа из ответа /api/cabinet/pricing/plans/ поверх запасных. null = без ограничений. */
function planValues(slug, apiPlans) {
  const fb = FALLBACK[slug] || {};
  const p = (apiPlans || []).find((x) => x.slug === slug);
  if (!p) return fb;
  const l = p.limits || {};
  const pick = (key, fallback) => (key in l ? l[key] : fallback);
  const num = (v, fallback) => {
    const n = Number(v);
    return v != null && Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    students: pick("students", fb.students),
    variants: pick("variants_monthly", fb.variants),
    workbooks: pick("workbooks_monthly", fb.workbooks),
    interactives: pick("interactives", fb.interactives),
    tokens: l.ai_tokens_monthly != null ? l.ai_tokens_monthly : fb.tokens,
    aiDay: l.ai_text_day != null && l.ai_text_day > 0 ? l.ai_text_day : fb.aiDay,
    storageMb: l.storage_mb != null && l.storage_mb > 0 ? l.storage_mb : fb.storageMb,
    tasks: pick("teacher_tasks", fb.tasks),
    watermark: p.ai_worksheet_watermark != null ? Boolean(p.ai_worksheet_watermark) : fb.watermark,
    month: num(p.price_month, fb.month || 0),
    year: num(p.price_year, fb.year),
  };
}

function storageText(mb) {
  if (mb == null) return "—";
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : Math.round(gb * 10) / 10} ГБ`;
  }
  return `${mb} МБ`;
}

const lim = (v, unit = "") => (v == null ? "без ограничений" : `${fmt(v)}${unit}`);
const upTo = (v) => (v == null ? "без ограничений" : `до ${fmt(v)}`);
const monthly = (v) => (v == null ? "без ограничений" : v <= 0 ? "—" : fmt(v));

function buildPlans(apiPlans) {
  const s = planValues("start", apiPlans);
  const t = planValues("teacher", apiPlans);
  const p = planValues("pro", apiPlans);
  const sc = planValues("school", apiPlans);
  return [
    {
      slug: "start",
      name: "Старт",
      month: 0,
      v: s,
      lead: "Чтобы попробовать платформу с первыми учениками.",
      bullets: [
        `До ${fmt(s.students)} учеников`,
        "Полный кабинет: расписание, журнал, видеоуроки, учёт оплат, проверка ДЗ",
        "Бесплатная библиотека материалов, банк ФИПИ и бесплатные тренажёры",
        `${fmt(s.variants)} вариантов и ${fmt(s.workbooks)} рабочих листа в месяц`,
        `ИИ-помощник «Цифрик»: ${fmt(s.tokens)} токенов в месяц, до ${fmt(s.aiDay)} запросов в день`,
        `Хранилище ${storageText(s.storageMb)}`,
      ],
    },
    {
      slug: "teacher",
      name: "Репетитор",
      month: t.month,
      year: t.year,
      v: t,
      lead: "Для репетитора с постоянной группой учеников.",
      bullets: [
        `До ${fmt(t.students)} учеников`,
        "Всё из тарифа «Старт»",
        "Расширенная библиотека материалов",
        `${fmt(t.variants)} вариантов, ${fmt(t.workbooks)} рабочих листов и ${fmt(t.interactives)} интерактивов в месяц`,
        "Ссылка для самостоятельной записи учеников",
        `ИИ-помощник «Цифрик»: ${fmt(t.tokens)} токенов в месяц, до ${fmt(t.aiDay)} запросов в день`,
        `Хранилище ${storageText(t.storageMb)}`,
      ],
    },
    {
      slug: "pro",
      name: "Профи",
      month: p.month,
      year: p.year,
      v: p,
      badge: "Рекомендуем",
      lead: "Для тех, кто ведёт много учеников и групп.",
      bullets: [
        p.students == null ? "Без ограничений по ученикам и группам" : `До ${fmt(p.students)} учеников`,
        "Всё из тарифа «Репетитор»",
        "Без ограничений по вариантам, рабочим листам и интерактивам",
        `ИИ-помощник «Цифрик»: ${fmt(p.tokens)} токенов в месяц, до ${fmt(p.aiDay)} запросов в день`,
        `Хранилище ${storageText(p.storageMb)}, до ${fmt(p.tasks)} задач в личном банке`,
      ],
    },
    {
      slug: "school",
      name: "Школа",
      contact: true,
      v: sc,
      lead: "Для школ и учебных центров.",
      bullets: [
        "Подключаем каждого преподавателя школы на «Профи» с индивидуальными условиями",
        `ИИ-помощник «Цифрик»: от ${fmt(sc.tokens)} токенов в месяц`,
        "Условия подключения обсуждаем индивидуально",
      ],
    },
  ];
}

function buildRows(plans) {
  const [s, t, p, sc] = plans.map((x) => x.v);
  const price = (pl) => (pl.month ? `${fmt(pl.month)} ₽` : "0 ₽");
  const yearPrice = (pl) => (pl.year ? `${fmt(pl.year)} ₽ (≈ ${fmt(Math.round(pl.year / 12))} ₽/мес)` : "—");
  return [
    ["Цена в месяц", price(s), price(t), price(p), "по запросу"],
    ["Цена в год", "—", yearPrice(t), yearPrice(p), "по запросу"],
    ["Ученики", upTo(s.students), upTo(t.students), upTo(p.students), "по договорённости"],
    ["Группы", "✓ (в пределах лимита учеников)", "✓ (в пределах лимита учеников)", "без ограничений", "без ограничений"],
    ["Расписание", "✓", "✓", "✓", "✓"],
    ["Журнал", "✓", "✓", "✓", "✓"],
    ["Видеоуроки", "✓", "✓", "✓", "✓"],
    ["Учёт оплат", "✓", "✓", "✓", "✓"],
    ["Проверка ДЗ", "✓", "✓", "✓", "✓"],
    ["Ссылка для записи учеников", "—", "✓", "✓", "✓"],
    ["Библиотека", "бесплатная", "расширенная", "полная", "полная"],
    ["Банк ФИПИ", "✓", "✓", "✓", "✓"],
    ["Варианты в месяц", monthly(s.variants), monthly(t.variants), monthly(p.variants), monthly(sc.variants)],
    ["Рабочие листы в месяц", monthly(s.workbooks), monthly(t.workbooks), monthly(p.workbooks), monthly(sc.workbooks)],
    ["Интерактивы в месяц", monthly(s.interactives), monthly(t.interactives), monthly(p.interactives), monthly(sc.interactives)],
    ["Хранилище файлов", storageText(s.storageMb), storageText(t.storageMb), storageText(p.storageMb), storageText(sc.storageMb)],
    ["Личный банк задач", lim(s.tasks, " задач"), lim(t.tasks, " задач"), lim(p.tasks, " задач"), lim(sc.tasks, " задач")],
    ["ИИ-помощник «Цифрик»", `${fmt(s.tokens)} токенов/мес`, `${fmt(t.tokens)} токенов/мес`, `${fmt(p.tokens)} токенов/мес`, `от ${fmt(sc.tokens)} токенов/мес`],
    ["Запросы к «Цифрику» в день", `до ${fmt(s.aiDay)}`, `до ${fmt(t.aiDay)}`, `до ${fmt(p.aiDay)}`, `до ${fmt(sc.aiDay)}`],
    ["Водяной знак на ИИ-листах", ...[s, t, p, sc].map((v) => (v.watermark ? "есть" : "нет"))],
    ["Пробный период", "—", "—", "14 дней для новых преподавателей", "—"],
  ];
}

const FAQ = [
  {
    q: "Что такое токены и на что они тратятся?",
    a: (
      <>
        Токены — это внутренняя единица работы ИИ-помощника «Цифрик». Каждый месяц начисляется: «Старт» — 30
        токенов, «Репетитор» — 200, «Профи» — 1000, «Школа» — от 2000. Токены расходуются на: ответ
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
    q: "Кому доступен пробный период «Профи»?",
    a: "Пробный период можно включить один раз и только если у аккаунта раньше не было платных подписок или промо-подписок. Если у вас был бесплатный «Премиум» на 3 месяца, пробный «Профи» недоступен.",
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
    q: "Есть ли автопродление и как его отключить?",
    a: (
      <>
        Автопродление включается, только если при оплате вы отметили «Согласен на автоматическое продление
        подписки». Тогда карта привязывается, примерно за 3 дня до списания приходит уведомление, а в день
        окончания периода списывается полная цена тарифа без скидок по промокоду. Без отметки оплата разовая.
        Отключить автопродление или отвязать карту можно в любой момент в разделе «Кабинет → Подписка и
        оплата». Доступ сохранится до конца оплаченного периода, после этого аккаунт перейдёт на «Старт».
        Данные сохранятся. Подробности и условия возврата — в <Link to="/offer">оферте</Link>.
      </>
    ),
  },
  {
    q: "У меня был бесплатный «Премиум» на 3 месяца. Что будет после него?",
    a: "За 7 и за 3 дня до окончания придёт напоминание с кнопкой оплаты и специальным предложением на продление. Если не продлить, аккаунт перейдёт на «Старт». Все данные сохранятся.",
  },
  {
    q: "Как подключить школу или учебный центр?",
    a: "Оставьте заявку в карточке «Школа». Мы свяжемся с вами и подключим каждого преподавателя школы на «Профи» с индивидуальными условиями.",
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
  const [apiPlans, setApiPlans] = useState(null);
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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/cabinet/pricing/plans/", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && Array.isArray(d.plans)) setApiPlans(d.plans); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const PLANS = useMemo(() => buildPlans(apiPlans), [apiPlans]);
  const ROWS = useMemo(() => buildRows(PLANS), [PLANS]);

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

      <TeacherQuotesBlock headingId="pricing-teacher-quotes-heading" />

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
