/**
 * /cabinet/upgrade — «Подписка и оплата».
 *
 * Тарифы и цены — из API. Стартовая акция показывается как статус подписки,
 * а не как отдельная карточка тарифа.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { TEACHERS_TELEGRAM_URL } from "../../config/teacherLinks";
import {
  changePlan,
  confirmMockSubscriptionPayment,
  createPayment,
  createReferralLink,
  fetchSubscriptionPlans,
  manageSubscription,
  syncSubscriptionPayment,
  validatePromoCode,
} from "../../utils/cabinetAuth";

function isLocalFrontendHost() {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}

/** Локально банк часто уводит SuccessURL на прод — ждём оплату через GetState. */
async function pollLocalPaymentUntilPaid(paymentId, { attempts = 45, intervalMs = 2000 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await syncSubscriptionPayment(paymentId);
    if (last?.is_paid) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}
import { CabinetPageHeader, CabinetPageShell } from "../CabinetSectionUi";

const MAIN_SLUGS = ["start", "teacher", "pro", "premium"];
const SCHOOL_SLUG = "school";

const FAQ_ITEMS = [
  {
    q: "Что будет после окончания стартовой акции?",
    a: "После окончания акции вы сможете выбрать платный тариф или перейти на «Старт». Автоматического списания нет, если автопродление не включено.",
  },
  {
    q: "Сохранятся ли мои данные?",
    a: "Да. Ученики, группы, материалы и журнал сохраняются при смене тарифа. Могут измениться только лимиты на добавление новых объектов.",
  },
  {
    q: "Можно ли изменить тариф?",
    a: "Да. Выберите другой тариф на этой странице. При переходе на платный план откроется оплата; на «Старт» можно перейти без оплаты.",
  },
  {
    q: "Как работает годовая подписка?",
    a: "Переключите период на «За год» — цена и экономия считаются по данным тарифа из базы. Оплата проходит одним платежом за выбранный период.",
  },
  {
    q: "Какие материалы доступны на «Старт»?",
    a: "Только бесплатные материалы раздела «Бесплатно». Платные уроки, симуляторы и расширенная библиотека на «Старте» недоступны.",
  },
  {
    q: "Что означает «не менее 5 новых материалов»?",
    a: "На тарифах с ежемесячным обновлением библиотеки мы публикуем не меньше пяти новых готовых материалов каждый месяц. Это минимум, а не потолок.",
  },
  {
    q: "Какие симуляторы доступны на «Профи»?",
    a: "На «Профи» и выше симуляторы и интерактивы в приоритете: новые тренажёры и интерактивные уроки появляются там в первую очередь.",
  },
  {
    q: "Как применить промокод?",
    a: "Введите код в поле «Промокод» и нажмите «Применить». Скидка пересчитается на сервере и учтётся при оплате выбранного тарифа.",
  },
  {
    q: "Как работает реферальная программа?",
    a: "Поделитесь своей ссылкой. Приглашённый получает бонус при регистрации, а вы — награду после его первой успешной оплаты. Условия берутся из настроек программы.",
  },
  {
    q: "Как получить чек?",
    a: "После успешной оплаты чек формируется автоматически и доступен в истории платежей / на email, указанный при регистрации.",
  },
];

const COMPARE_ROWS = [
  { key: "students", label: "Количество учеников", type: "limit", field: "students" },
  { key: "groups", label: "Группы", type: "limit", field: "groups" },
  { key: "schedule", label: "Расписание", type: "rank", min: 1 },
  { key: "journal", label: "Журнал", type: "feature", field: "analytics", altMin: 1 },
  { key: "homework", label: "Домашние задания", type: "feature", field: "homework" },
  { key: "review", label: "Проверка работ", type: "feature", field: "review" },
  { key: "video", label: "Видеоконференции", type: "rank", min: 1 },
  { key: "variants", label: "Генератор вариантов", type: "limit", field: "variants_monthly" },
  { key: "workbooks", label: "Рабочие тетради", type: "limit", field: "workbooks_monthly" },
  { key: "free_lib", label: "Бесплатные материалы", type: "always" },
  { key: "teacher_lib", label: "Материалы уровня Teacher", type: "rank", min: 1 },
  { key: "pro_lib", label: "Основная библиотека", type: "rank", min: 2 },
  { key: "interactives", label: "Интерактивы", type: "limit", field: "interactives" },
  { key: "simulators", label: "Симуляторы", type: "feature", field: "simulators" },
  { key: "premium_lib", label: "Premium-материалы", type: "rank", min: 3 },
  { key: "monthly_new", label: "Новые материалы ежемесячно", type: "promise" },
  { key: "analytics", label: "Аналитика", type: "feature", field: "analytics" },
  { key: "mass", label: "Массовые действия", type: "feature", field: "mass_actions" },
  { key: "storage", label: "Хранилище", type: "storage" },
  { key: "support", label: "Поддержка", type: "support" },
];

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7l3.5 3.5L12 3.5" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`;
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function daysWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

function monthsWord(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "месяцев";
  if (last === 1) return "месяц";
  if (last >= 2 && last <= 4) return "месяца";
  return "месяцев";
}

function ctaLabel(plan, isCurrent) {
  if (isCurrent) return "Текущий тариф";
  if (plan.cta_type === "contact" || plan.slug === SCHOOL_SLUG) return "Оставить заявку";
  if (plan.slug === "pro") return "Перейти на Профи";
  if (plan.slug === "start") return "Выбрать Старт";
  if (plan.slug === "teacher") return "Выбрать Учитель";
  if (plan.slug === "premium") return "Выбрать Премиум";
  return `Выбрать ${plan.name}`;
}

/** Ключевые пункты карточки — лимиты из API, формулировки по тарифу. */
function buildHighlights(plan) {
  const l = plan.limits || {};
  const f = plan.features || {};
  const students = l.students != null ? `до ${l.students} активных учеников` : null;
  const groups = l.groups != null ? `до ${l.groups} групп` : null;
  const variants =
    l.variants_monthly == null
      ? "Генератор вариантов без лимита"
      : `Генератор вариантов: до ${l.variants_monthly}/мес`;
  const workbooks =
    l.workbooks_monthly == null
      ? "Рабочие тетради без лимита"
      : `Рабочие тетради: до ${l.workbooks_monthly}/мес`;

  if (plan.slug === "start") {
    return [
      students && students.replace("активных ", ""),
      groups,
      f.homework && "Базовые домашние задания",
      f.review && "Проверка работ",
      variants.replace("Генератор вариантов: ", "Ограниченный генератор: "),
      workbooks.replace("Рабочие тетради: ", "Ограниченное создание тетрадей: "),
      { text: "Только бесплатные материалы", accent: true },
    ].filter(Boolean);
  }

  if (plan.slug === "teacher") {
    return [
      students,
      "Расписание и журнал",
      f.homework && "Домашние задания",
      f.review && "Проверка работ",
      "Видеоконференции",
      variants,
      "Материалы уровня «Учитель»",
      plan.monthly_library_promise && {
        text: "Не менее 5 новых готовых материалов каждый месяц",
        accent: true,
      },
    ].filter(Boolean);
  }

  if (plan.slug === "pro") {
    return [
      students ? `Большое количество учеников: ${students}` : "Большое количество учеников",
      "Все функции кабинета",
      f.analytics && "Журнал и расширенная аналитика",
      "Видеоконференции",
      variants,
      workbooks,
      "Полная основная библиотека",
      {
        text: "Симуляторы и интерактивы — в приоритете",
        accent: true,
        hint: "Новые тренажёры, симуляторы и интерактивные уроки в первую очередь появляются на тарифе «Профи» и выше",
      },
      plan.monthly_library_promise && "Не менее 5 новых материалов ежемесячно",
    ].filter(Boolean);
  }

  if (plan.slug === "premium") {
    return [
      "Всё из «Профи»",
      { text: "Полная библиотека и эксклюзивные материалы", accent: true },
      "Премиальные интерактивы",
      "Межпредметные проекты",
      "Авторские методические подборки",
      workbooks,
      "Ранний доступ к отдельным материалам",
      f.priority_support && "Приоритетная поддержка",
      plan.monthly_library_promise && "Не менее 5 новых материалов ежемесячно",
    ].filter(Boolean);
  }

  if (plan.slug === SCHOOL_SLUG) {
    return [
      f.multi_teacher && "Несколько преподавателей",
      "Единый кабинет организации",
      "Управление лицензиями",
      f.analytics && "Общая аналитика",
      "Администратор организации",
      "Индивидуальные лимиты",
      f.priority_support && "Корпоративная поддержка",
    ].filter(Boolean);
  }

  return [
    students,
    groups,
    f.homework && "Домашние задания",
    f.review && "Проверка работ",
    f.simulators && "Симуляторы",
    plan.monthly_library_promise && "Не менее 5 новых материалов ежемесячно",
  ].filter(Boolean);
}

function compareCell(plan, row) {
  const l = plan.limits || {};
  const f = plan.features || {};
  const rank = plan.content_access_rank ?? 0;

  if (plan.slug === SCHOOL_SLUG && row.type === "limit") {
    if (row.field === "students" || row.field === "groups") return "Индивидуально";
  }

  switch (row.type) {
    case "limit": {
      const v = l[row.field];
      if (v == null) return "Без лимита";
      return String(v);
    }
    case "feature":
      if (row.altMin != null && rank >= row.altMin) return "Да";
      return f[row.field] ? "Да" : "—";
    case "rank":
      return rank >= row.min ? "Да" : "—";
    case "always":
      return "Да";
    case "promise":
      return plan.monthly_library_promise ? "Не менее 5" : "—";
    case "storage": {
      const mb = l.storage_mb;
      if (mb == null) return "—";
      if (mb >= 1024) return `${Math.round(mb / 1024)} ГБ`;
      return `${mb} МБ`;
    }
    case "support":
      if (f.priority_support) return "Приоритетная";
      if (rank >= 1) return "Стандартная";
      return "Базовая";
    default:
      return "—";
  }
}

function SubscriptionStatusCard({
  subscription,
  currentPlan,
  registrationPromo,
  onChoosePlan,
  onPromoDetails,
  onSetAutoRenew,
  onCancelSubscription,
  managing,
}) {
  if (!subscription) return null;

  const {
    launch_promo_active: launchPromo,
    status,
    started_at: startedAt,
    expires_at: expiresAt,
    promo_ends_at: promoEndsAt,
    days_remaining: daysRemaining,
    auto_renew: autoRenew,
    cancelled_at: cancelledAt,
    latest_payment: payment,
    plan_name: planName,
  } = subscription;

  const endDate = promoEndsAt || expiresAt;
  const isExpired = status === "expired" || (!subscription.is_valid && status !== "pending");
  const isPastDue = status === "past_due";
  const isPending = status === "pending" || payment?.status === "pending";
  const paymentFailed = payment?.status === "failed" || isPastDue;
  const isCancelled = Boolean(cancelledAt) || status === "cancelled";
  const autoRenewOn = Boolean(autoRenew) && !cancelledAt;
  const canToggleAutoRenew = !isExpired && status !== "suspended";
  const showCancel = !isExpired && !isCancelled && status !== "suspended";

  if (launchPromo) {
    return (
      <section className="upg-status upg-status--promo" aria-labelledby="upg-status-title">
        <div className="upg-status__body">
          <h2 id="upg-status-title" className="upg-status__title">
            Сейчас у вас тариф «{planName || "Профи"}» по стартовой акции
          </h2>
          <ul className="upg-status__meta">
            {startedAt ? <li>Начало: {formatDate(startedAt)}</li> : null}
            {endDate ? <li>Окончание: {formatDate(endDate)}</li> : null}
            {daysRemaining != null ? (
              <li>
                Осталось: {daysRemaining} {daysWord(daysRemaining)}
              </li>
            ) : null}
          </ul>
          <p className="upg-status__text">
            Доступ предоставлен на {registrationPromo?.months || 3} месяца с даты регистрации.
          </p>
          <p className="upg-status__text">
            После окончания вы сможете выбрать платный тариф или перейти на «Старт».
          </p>
          {!autoRenew ? (
            <p className="upg-status__note">Автоматическое списание не включено.</p>
          ) : null}
        </div>
        <div className="upg-status__actions">
          <button type="button" className="upg-btn upg-btn--primary" onClick={onChoosePlan}>
            Выбрать тариф заранее
          </button>
          <button type="button" className="upg-btn upg-btn--ghost" onClick={onPromoDetails}>
            Подробнее об акции
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className={[
        "upg-status",
        isExpired || paymentFailed ? "upg-status--warn" : "",
        isPending ? "upg-status--pending" : "",
        isCancelled ? "upg-status--warn" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby="upg-status-title"
    >
      <div className="upg-status__body">
        <h2 id="upg-status-title" className="upg-status__title">
          Текущая подписка
        </h2>
        <ul className="upg-status__meta">
          <li>Тариф: {planName || currentPlan?.name || "—"}</li>
          <li>Начало: {startedAt ? formatDate(startedAt) : "—"}</li>
          <li>Конец: {expiresAt ? formatDate(expiresAt) : "—"}</li>
          <li className="upg-status__auto">
            <span>Автопродление:</span>
            <div className="upg-auto-toggle" role="group" aria-label="Автопродление">
              <button
                type="button"
                className={autoRenewOn ? "is-active" : ""}
                disabled={!canToggleAutoRenew || managing || autoRenewOn}
                onClick={() => onSetAutoRenew(true)}
              >
                {managing === "enable_auto_renew" ? "…" : "вкл"}
              </button>
              <button
                type="button"
                className={!autoRenewOn ? "is-active" : ""}
                disabled={!canToggleAutoRenew || managing || !autoRenewOn}
                onClick={() => onSetAutoRenew(false)}
              >
                {managing === "disable_auto_renew" ? "…" : "выкл"}
              </button>
            </div>
          </li>
        </ul>
        {isCancelled && expiresAt ? (
          <p className="upg-status__note">
            Подписка отменена. Доступ сохранится до {formatDate(expiresAt)}.
          </p>
        ) : null}
        {isPending ? (
          <p className="upg-status__note">Оплата ожидается. Завершите платёж, чтобы активировать тариф.</p>
        ) : null}
        {paymentFailed ? (
          <p className="upg-status__note upg-status__note--err">
            Оплата не прошла{payment?.plan_name ? ` для тарифа «${payment.plan_name}»` : ""}.
            Попробуйте выбрать тариф снова.
          </p>
        ) : null}
        {isExpired ? (
          <p className="upg-status__note">Подписка истекла. Выберите тариф, чтобы продолжить работу.</p>
        ) : null}
      </div>
      <div className="upg-status__actions">
        {showCancel ? (
          <button
            type="button"
            className="upg-btn upg-btn--danger"
            onClick={onCancelSubscription}
            disabled={managing}
          >
            {managing === "cancel" ? "…" : "Отменить подписку"}
          </button>
        ) : null}
        <button type="button" className="upg-btn upg-btn--primary" onClick={onChoosePlan}>
          Управление подпиской
        </button>
      </div>
    </section>
  );
}

function PlanCard({
  plan,
  isCurrent,
  period,
  promoDiscount,
  onSelect,
  selecting,
  expanded,
  onToggleFeatures,
  paymentsEnabled = true,
}) {
  const highlights = buildHighlights(plan).slice(0, 8);
  const priceMonth = Number(plan.price_month);
  const priceYear = Number(plan.price_year);
  const isContact = plan.cta_type === "contact" || plan.slug === SCHOOL_SLUG;
  const isFree = Boolean(plan.is_free) && !isContact;
  const paymentBlocked = !paymentsEnabled && !isFree && !isContact;

  let priceMain;
  let priceSub = null;
  if (isContact) {
    priceMain = "По запросу";
    priceSub = "Стоимость рассчитывается индивидуально";
  } else if (isFree || priceMonth === 0) {
    priceMain = "Бесплатно";
  } else if (period === "year" && priceYear > 0) {
    priceMain = formatMoney(priceYear);
    priceSub = "за год";
    const perMonth = priceYear / 12;
    if (Number.isFinite(perMonth) && perMonth > 0) {
      priceSub = `${formatMoney(perMonth)}/мес при оплате за год`;
    }
  } else {
    priceMain = formatMoney(priceMonth);
    priceSub = "в месяц";
  }

  const showPromoPrice =
    promoDiscount?.valid &&
    promoDiscount.plan_slug === plan.slug &&
    promoDiscount.final_amount != null &&
    !isContact &&
    !isFree;

  return (
    <article
      className={[
        "upg-card",
        isCurrent ? "upg-card--current" : "",
        plan.is_recommended || plan.is_featured ? "upg-card--recommended" : "",
        plan.slug === "premium" ? "upg-card--premium" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="upg-card__badges">
        {(plan.badge_text || plan.is_recommended) && plan.slug === "pro" ? (
          <span className="upg-card__badge">{plan.badge_text || "Рекомендуем"}</span>
        ) : plan.is_recommended ? (
          <span className="upg-card__badge">{plan.badge_text || "Рекомендуем"}</span>
        ) : null}
        {isCurrent ? <span className="upg-card__badge upg-card__badge--current">Текущий</span> : null}
      </div>

      <div className="upg-card__head">
        <h3 className="upg-card__name">{plan.name}</h3>
        <p className="upg-card__desc">{plan.short_description || plan.description}</p>
      </div>

      <div className="upg-card__price-block">
        <div className="upg-card__price">{priceMain}</div>
        {priceSub ? <div className="upg-card__price-sub">{priceSub}</div> : null}
        {showPromoPrice ? (
          <div className="upg-card__promo-price">
            С промокодом: {formatMoney(promoDiscount.final_amount)}
          </div>
        ) : null}
      </div>

      <ul className="upg-card__features">
        {highlights.map((item) => {
          const text = typeof item === "string" ? item : item.text;
          const accent = typeof item === "object" && item.accent;
          const hint = typeof item === "object" ? item.hint : null;
          return (
            <li key={text} className={accent ? "upg-card__feature--accent" : undefined}>
              <CheckIcon />
              <span>
                {text}
                {hint ? <span className="upg-card__hint">{hint}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>

      <button type="button" className="upg-card__more" onClick={onToggleFeatures}>
        {expanded ? "Скрыть сравнение" : "Все возможности"}
      </button>

      <div className="upg-card__footer">
        {isContact ? (
          <a
            href={TEACHERS_TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
            className="upg-card__btn upg-card__btn--outline"
          >
            {ctaLabel(plan, false)}
          </a>
        ) : isCurrent ? (
          <div className="upg-card__current-label" aria-disabled="true">
            Текущий тариф
          </div>
        ) : paymentBlocked ? (
          <div className="upg-card__current-label" aria-disabled="true">
            Оплата временно недоступна
          </div>
        ) : (
          <button
            type="button"
            className="upg-card__btn"
            onClick={() => onSelect(plan)}
            disabled={selecting === plan.slug}
          >
            {selecting === plan.slug ? "Подождите…" : ctaLabel(plan, false)}
          </button>
        )}
      </div>
    </article>
  );
}

function CompareSection({ plans, open, onOpenChange }) {
  const [openKey, setOpenKey] = useState(null);
  const mainPlans = plans.filter((p) => MAIN_SLUGS.includes(p.slug));

  if (!mainPlans.length) return null;

  return (
    <section className="upg-compare" aria-labelledby="upg-compare-title">
      <button
        type="button"
        className="upg-compare__toggle"
        id="upg-compare-title"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span>Сравнить тарифы</span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      {open ? (
        <>
          <div className="upg-compare__desktop">
            <table className="upg-compare__table">
              <thead>
                <tr>
                  <th scope="col">Возможность</th>
                  {mainPlans.map((p) => (
                    <th key={p.slug} scope="col">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    {mainPlans.map((p) => (
                      <td key={p.slug}>{compareCell(p, row)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="upg-compare__mobile">
            {COMPARE_ROWS.map((row) => {
              const isOpen = openKey === row.key;
              return (
                <div key={row.key} className="upg-compare__acc">
                  <button
                    type="button"
                    className="upg-compare__acc-btn"
                    aria-expanded={isOpen}
                    onClick={() => setOpenKey(isOpen ? null : row.key)}
                  >
                    {row.label}
                    <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
                  </button>
                  {isOpen ? (
                    <ul className="upg-compare__acc-list">
                      {mainPlans.map((p) => (
                        <li key={p.slug}>
                          <span>{p.name}</span>
                          <strong>{compareCell(p, row)}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

function FaqSection() {
  const [open, setOpen] = useState(null);
  return (
    <section className="upg-faq" aria-labelledby="upg-faq-title">
      <h2 id="upg-faq-title" className="upg-section-title">
        Вопросы и ответы
      </h2>
      <div className="upg-faq__list">
        {FAQ_ITEMS.map((item, idx) => {
          const isOpen = open === idx;
          return (
            <div key={item.q} className="upg-faq__item">
              <button
                type="button"
                className="upg-faq__q"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : idx)}
              >
                {item.q}
                <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen ? <p className="upg-faq__a">{item.a}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function CabinetUpgradePage() {
  const [plansData, setPlansData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(null);
  const [notice, setNotice] = useState("");
  const [period, setPeriod] = useState("month");
  const [promoInput, setPromoInput] = useState("");
  const [promoState, setPromoState] = useState(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [promoDetailsOpen, setPromoDetailsOpen] = useState(false);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralLink, setReferralLink] = useState(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [managing, setManaging] = useState(null);
  const plansRef = useRef(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const qp = searchParams.get("period");
    if (qp === "year" || qp === "month") setPeriod(qp);
  }, [searchParams]);

  useEffect(() => {
    fetchSubscriptionPlans()
      .then((data) => {
        setPlansData(data);
        if (data?.referral?.my_link) setReferralLink(data.referral.my_link);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Возврат с оплаты: не верь URL — проверяем статус платежа в API
  useEffect(() => {
    const status = (searchParams.get("status") || "").toLowerCase();
    const paymentId = searchParams.get("payment_id");
    if (!status || !paymentId) return undefined;

    let cancelled = false;
    const finish = async () => {
      navigate("/cabinet/upgrade", { replace: true });
      try {
        const refreshed = await fetchSubscriptionPlans();
        if (!cancelled) {
          setPlansData(refreshed);
          if (refreshed?.referral?.my_link) setReferralLink(refreshed.referral.my_link);
        }
      } catch {
        /* ignore */
      }
    };

    const applyReturn = async () => {
      if (status === "fail" || status === "failed" || status === "cancelled") {
        if (!cancelled) {
          setNotice("Оплата не завершена. Можно выбрать тариф и попробовать снова.");
        }
        await finish();
        return;
      }

      try {
        let payment;
        if (status === "mock") {
          payment = await confirmMockSubscriptionPayment(paymentId);
        } else {
          // Webhook мог уйти на другой хост — спрашиваем банк GetState и активируем тариф
          payment = await syncSubscriptionPayment(paymentId);
        }

        if (cancelled) return;

        if (payment.is_paid) {
          setNotice(
            payment.plan_name
              ? `Оплата прошла успешно. Тариф «${payment.plan_name}» активирован.`
              : "Оплата прошла успешно. Тариф обновлён.",
          );
        } else if (status === "success") {
          setNotice(
            "Платёж ещё обрабатывается банком. Обновите страницу через минуту.",
          );
        } else {
          setNotice(
            "Открылась тестовая страница без формы банка. Перезапустите Django с PAYMENT_PROVIDER=tbank.",
          );
        }
      } catch (err) {
        if (!cancelled) {
          setNotice(
            err?.data?.detail ||
              "Не удалось проверить оплату. Если вы платили — обновите страницу позже.",
          );
        }
      }
      await finish();
    };

    applyReturn();
    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate]);

  const plans = plansData?.plans || [];
  const mainPlans = useMemo(
    () => MAIN_SLUGS.map((slug) => plans.find((p) => p.slug === slug)).filter(Boolean),
    [plans],
  );
  const schoolPlan = plans.find((p) => p.slug === SCHOOL_SLUG);
  const currentSlug = plansData?.current_slug;
  const subscription = plansData?.subscription;
  const registrationPromo = plansData?.registration_promo;
  const anonymous = plansData?.anonymous;
  const referral = plansData?.referral;
  const billing = plansData?.billing;
  const currentPlan = plans.find((p) => p.slug === currentSlug);
  const paymentsEnabled = plansData?.payments_enabled !== false;

  const yearSavingsLabel = billing?.year_savings_label;
  const showYearSavings = Boolean(yearSavingsLabel) && period === "year";

  const scrollToPlans = () => {
    plansRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const refreshPlans = async () => {
    const refreshed = await fetchSubscriptionPlans();
    setPlansData(refreshed);
    if (refreshed?.referral?.my_link) setReferralLink(refreshed.referral.my_link);
    return refreshed;
  };

  const handleSetAutoRenew = async (enabled) => {
    if (!enabled) {
      if (
        !window.confirm(
          "Отключить автопродление? Подписка останется активной до конца оплаченного периода.",
        )
      ) {
        return;
      }
    }
    setManaging(enabled ? "enable_auto_renew" : "disable_auto_renew");
    setNotice("");
    try {
      const result = await manageSubscription("set_auto_renew", { enabled });
      await refreshPlans();
      setNotice(
        result.message || (enabled ? "Автопродление включено." : "Автопродление отключено."),
      );
    } catch (err) {
      setNotice(
        err.data?.detail ||
          err.data?.message ||
          (enabled ? "Не удалось включить автопродление." : "Не удалось отключить автопродление."),
      );
    } finally {
      setManaging(null);
    }
  };

  const handleCancelSubscription = async () => {
    if (
      !window.confirm(
        "Отменить подписку? Автопродление будет выключено. Доступ сохранится до конца текущего периода.",
      )
    ) {
      return;
    }
    setManaging("cancel");
    setNotice("");
    try {
      const result = await manageSubscription("cancel");
      await refreshPlans();
      setNotice(result.message || "Подписка отменена.");
    } catch (err) {
      setNotice(err.data?.detail || err.data?.message || "Не удалось отменить подписку.");
    } finally {
      setManaging(null);
    }
  };

  const handlePromoCheck = async () => {
    const code = promoInput.trim();
    if (!code) return;
    setPromoLoading(true);
    setPromoState(null);
    try {
      const targetSlug =
        searchParams.get("plan") ||
        plans.find((p) => p.is_recommended)?.slug ||
        "pro";
      const data = await validatePromoCode(code, targetSlug, period);
      setPromoState({
        valid: true,
        message:
          data.discount_type === "bonus_days"
            ? `+${data.bonus_days || data.discount_value} бонусных дней`
            : `Скидка −${formatMoney(data.discount)} · итого ${formatMoney(data.final_amount)}`,
        ...data,
      });
    } catch (err) {
      setPromoState({
        valid: false,
        message: err.data?.message || err.data?.detail || "Промокод не найден",
      });
    } finally {
      setPromoLoading(false);
    }
  };

  const handleSelect = async (plan) => {
    if (!plan || plan.slug === currentSlug) return;
    if (plan.cta_type === "contact" || plan.slug === SCHOOL_SLUG) return;

    const isFree = Boolean(plan.is_free);
    if (!paymentsEnabled && !isFree) {
      setNotice("Оплата временно недоступна. Попробуйте позже.");
      return;
    }

    setSelecting(plan.slug);
    setNotice("");
    try {
      const result = await changePlan(plan.slug, period);
      if (result.requires_payment) {
        if (!paymentsEnabled) {
          setNotice("Оплата временно недоступна. Попробуйте позже.");
          return;
        }
        const promoCode = promoState?.valid ? promoInput.trim() : null;
        const payment = await createPayment(plan.slug, period, promoCode);
        const url = (payment.payment_url || "").trim();
        if (!url) {
          setNotice("Не удалось получить ссылку на оплату.");
          return;
        }
        // Относительный mock-URL — формы Т-Банка нет (сервер не на tbank или не перезапущен)
        const isMockReturn =
          url.includes("status=mock") || payment.provider === "mock";
        if (isMockReturn && !url.startsWith("http")) {
          setNotice(
            "Сервер вернул тестовый mock вместо формы Т-Банка. Проверьте PAYMENT_PROVIDER=tbank в Generator/.env и перезапустите Django.",
          );
          window.location.href = url;
          return;
        }

        // Локально: банк часто редиректит Success на прод из настроек терминала.
        // Остаёмся на этой вкладке, форму открываем рядом, тариф ждём через GetState.
        if (
          isLocalFrontendHost() &&
          payment.provider === "tbank" &&
          payment.payment_id &&
          /^https?:\/\//i.test(url)
        ) {
          const bankWin = window.open(url, "_blank", "noopener,noreferrer");
          if (!bankWin) {
            setNotice(
              "Разрешите всплывающие окна и нажмите тариф снова — форма банка откроется в новой вкладке.",
            );
            return;
          }
          setNotice(
            "Оплатите в вкладке банка. Эта страница сама обновит тариф после оплаты…",
          );
          const paid = await pollLocalPaymentUntilPaid(payment.payment_id);
          if (paid?.is_paid) {
            setNotice(
              paid.plan_name
                ? `Оплата прошла успешно. Тариф «${paid.plan_name}» активирован.`
                : "Оплата прошла успешно. Тариф обновлён.",
            );
            const refreshed = await fetchSubscriptionPlans();
            setPlansData(refreshed);
            if (refreshed?.referral?.my_link) setReferralLink(refreshed.referral.my_link);
          } else {
            setNotice(
              "Платёж ещё не подтверждён. Если вы уже оплатили — обновите страницу через минуту.",
            );
          }
          return;
        }

        window.location.href = url;
        return;
      } else {
        setNotice("Тариф обновлён.");
        const refreshed = await fetchSubscriptionPlans();
        setPlansData(refreshed);
        setTimeout(() => navigate("/cabinet"), 1200);
      }
    } catch (err) {
      setNotice(
        err?.data?.detail ||
          err?.message ||
          "Не удалось изменить тариф. Попробуйте позже.",
      );
    } finally {
      setSelecting(null);
    }
  };

  const handleReferral = async () => {
    setReferralBusy(true);
    setReferralCopied(false);
    try {
      const data = referralLink || (await createReferralLink());
      setReferralLink(data);
      const absolute = `${window.location.origin}${data.url}`;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absolute);
        setReferralCopied(true);
      } else {
        window.prompt("Скопируйте ссылку:", absolute);
      }
    } catch {
      setNotice("Не удалось получить реферальную ссылку.");
    } finally {
      setReferralBusy(false);
    }
  };

  return (
    <CabinetPageShell className="upg-shell">
      <div className="upg-back-row">
        <Link to="/cabinet" className="upg-back">
          ← Назад
        </Link>
      </div>

      <CabinetPageHeader
        title="Подписка и оплата"
        subtitle="Выберите подходящий формат работы с учениками и материалами платформы"
      />

      {notice ? (
        <div className="cb-soon-toast" role="status">
          {notice}
        </div>
      ) : null}

      {!loading && !paymentsEnabled ? (
        <div className="cb-soon-toast" role="status">
          Оплата временно недоступна. Выбрать платный тариф пока нельзя.
        </div>
      ) : null}

      {loading ? (
        <p className="st-loading">Загрузка тарифов…</p>
      ) : (
        <>
          <SubscriptionStatusCard
            subscription={subscription}
            currentPlan={currentPlan}
            registrationPromo={registrationPromo}
            onChoosePlan={scrollToPlans}
            onPromoDetails={() => setPromoDetailsOpen((v) => !v)}
            onSetAutoRenew={handleSetAutoRenew}
            onCancelSubscription={handleCancelSubscription}
            managing={managing}
          />

          {promoDetailsOpen && registrationPromo ? (
            <div className="upg-promo-details" role="region" aria-label="Подробнее об акции">
              <strong>{registrationPromo.title || "Стартовая акция"}</strong>
              <p>
                {registrationPromo.message ||
                  "Всем зарегистрировавшимся — тариф «Профи» на 3 месяца с даты регистрации."}
              </p>
              {registrationPromo.until_label ? (
                <p className="upg-promo-details__meta">
                  Регистрация по акции до {registrationPromo.until_label}
                </p>
              ) : null}
            </div>
          ) : null}

          {anonymous ? (
            <aside className="upg-anon" aria-label={anonymous.title}>
              <div className="upg-anon__text">
                <strong>{anonymous.title}</strong>
                <p>
                  до {anonymous.limits?.variants ?? 5} вариантов с одного устройства · до{" "}
                  {anonymous.limits?.workbooks ?? 3} рабочих тетрадей · только бесплатные материалы ·
                  без личного кабинета
                </p>
              </div>
              <Link to="/" className="upg-btn upg-btn--ghost">
                Попробовать
              </Link>
            </aside>
          ) : null}

          <div className="upg-toolbar" ref={plansRef}>
            <div className="upg-period" role="group" aria-label="Период оплаты">
              <button
                type="button"
                className={period === "month" ? "is-active" : ""}
                onClick={() => {
                  setPeriod("month");
                  setPromoState(null);
                }}
              >
                Ежемесячно
              </button>
              <button
                type="button"
                className={period === "year" ? "is-active" : ""}
                onClick={() => {
                  setPeriod("year");
                  setPromoState(null);
                }}
              >
                За год
              </button>
            </div>

            <div className="upg-promo">
              <input
                type="text"
                className="upg-promo__input"
                placeholder="Введите промокод"
                value={promoInput}
                onChange={(e) => {
                  setPromoInput(e.target.value);
                  setPromoState(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePromoCheck();
                }}
                aria-label="Промокод"
              />
              <button
                type="button"
                className="upg-promo__btn"
                onClick={handlePromoCheck}
                disabled={promoLoading || !promoInput.trim()}
              >
                {promoLoading ? "…" : "Применить"}
              </button>
            </div>
          </div>

          {showYearSavings ? (
            <p className="upg-year-hint">{yearSavingsLabel}</p>
          ) : null}

          {promoState ? (
            <p
              className={`upg-promo__msg${
                promoState.valid ? " upg-promo__msg--ok" : " upg-promo__msg--err"
              }`}
              role="status"
            >
              {promoState.valid ? "✓ " : "✕ "}
              {promoState.message}
            </p>
          ) : null}

          <div className="upg-grid">
            {mainPlans.map((plan) => (
              <PlanCard
                key={plan.slug}
                plan={plan}
                isCurrent={plan.slug === currentSlug}
                period={period}
                promoDiscount={promoState}
                onSelect={handleSelect}
                selecting={selecting}
                expanded={compareOpen}
                onToggleFeatures={() => setCompareOpen((v) => !v)}
                paymentsEnabled={paymentsEnabled}
              />
            ))}
          </div>

          {schoolPlan ? (
            <section className="upg-school" aria-labelledby="upg-school-title">
              <div className="upg-school__main">
                <div className="upg-school__badges">
                  {schoolPlan.badge_text ? (
                    <span className="upg-card__badge upg-card__badge--muted">{schoolPlan.badge_text}</span>
                  ) : null}
                  {schoolPlan.slug === currentSlug ? (
                    <span className="upg-card__badge upg-card__badge--current">Текущий</span>
                  ) : null}
                </div>
                <h2 id="upg-school-title" className="upg-school__title">
                  {schoolPlan.name}
                </h2>
                <p className="upg-school__price">Стоимость рассчитывается индивидуально</p>
                <p className="upg-school__desc">
                  {schoolPlan.short_description || schoolPlan.description}
                </p>
                <ul className="upg-card__features upg-school__features">
                  {buildHighlights(schoolPlan).map((item) => {
                    const text = typeof item === "string" ? item : item.text;
                    return (
                      <li key={text}>
                        <CheckIcon />
                        <span>{text}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="upg-school__cta">
                {schoolPlan.slug === currentSlug ? (
                  <div className="upg-card__current-label">Текущий тариф</div>
                ) : (
                  <a
                    href={TEACHERS_TELEGRAM_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="upg-card__btn"
                  >
                    Оставить заявку
                  </a>
                )}
              </div>
            </section>
          ) : null}

          <CompareSection
            plans={mainPlans}
            open={compareOpen}
            onOpenChange={setCompareOpen}
          />

          {referral?.enabled ? (
            <section className="upg-referral" aria-labelledby="upg-referral-title">
              <h2 id="upg-referral-title" className="upg-section-title">
                Приглашайте коллег и получайте бонусы
              </h2>
              <p className="upg-referral__desc">{referral.description}</p>
              <ul className="upg-referral__list">
                {referral.invitee?.plan_name ? (
                  <li>
                    Приглашённому: {referral.invitee.months}{" "}
                    {monthsWord(referral.invitee.months)} тарифа «{referral.invitee.plan_name}»
                  </li>
                ) : null}
                {referral.referrer?.plan_name ? (
                  <li>
                    Вам после оплаты коллеги: {referral.referrer.months}{" "}
                    {monthsWord(referral.referrer.months)} тарифа «{referral.referrer.plan_name}»
                  </li>
                ) : null}
              </ul>
              <button
                type="button"
                className="upg-btn upg-btn--primary"
                onClick={handleReferral}
                disabled={referralBusy}
              >
                {referralBusy
                  ? "…"
                  : referralCopied
                    ? "Ссылка скопирована"
                    : "Моя реферальная ссылка"}
              </button>
              {referralLink?.url ? (
                <p className="upg-referral__url">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}${referralLink.url}`
                    : referralLink.url}
                </p>
              ) : null}
            </section>
          ) : null}

          <FaqSection />
        </>
      )}
    </CabinetPageShell>
  );
}
