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
  cancelPendingPlanChange,
  confirmMockSubscriptionPayment,
  createPayment,
  createReferralLink,
  fetchSubscriptionPlans,
  manageSubscription,
  syncSubscriptionPayment,
  validatePromoCode,
} from "../../utils/cabinetAuth";
import { notifySubscriptionChanged } from "../hooks/useSubscription";
import SupportContactLink from "../components/SupportContactLink";
import { openSupport } from "../support";

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
    a: "«Старт» — ознакомительный тариф: только бесплатные материалы. Расписание, журнал и видеозанятия открываются с тарифа «Учитель».",
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
    a: "Поделитесь персональной ссылкой. Коллеге — 50% на первый месяц любого платного тарифа. Вам — 14 дней текущего тарифа после его первой успешной оплаты. Награда начисляется только после подтверждённой оплаты, не за регистрацию.",
  },
  {
    q: "Как получить чек?",
    a: "После успешной оплаты чек формируется автоматически и доступен в истории платежей / на email, указанный при регистрации.",
  },
];

const COMPARE_ROWS = [
  { key: "students", label: "Активные ученики", type: "limit", field: "students" },
  { key: "groups", label: "Группы", type: "limit", field: "groups" },
  { key: "homework", label: "Домашние задания", type: "feature", field: "homework" },
  { key: "review", label: "Проверка работ", type: "feature", field: "review" },
  { key: "variants", label: "Генератор вариантов", type: "limit_monthly", field: "variants_monthly" },
  { key: "workbooks", label: "Рабочие тетради", type: "limit_monthly", field: "workbooks_monthly" },
  { key: "interactives", label: "Создание интерактивов", type: "limit_monthly", field: "interactives" },
  { key: "schedule", label: "Расписание", type: "rank", min: 1 },
  { key: "journal", label: "Журнал", type: "rank", min: 1 },
  { key: "video", label: "Видеоконференции", type: "rank", min: 1 },
  { key: "analytics", label: "Аналитика", type: "analytics_level" },
  { key: "mass", label: "Массовые действия", type: "feature", field: "mass_actions" },
  { key: "free_lib", label: "Бесплатные материалы", type: "always" },
  { key: "teacher_lib", label: "Расширенная библиотека", type: "rank", min: 1 },
  { key: "pro_lib", label: "Полная библиотека", type: "rank", min: 2 },
  { key: "premium_lib", label: "Premium-материалы", type: "rank", min: 3 },
  { key: "simulators", label: "Симуляторы", type: "simulators_level" },
  { key: "cross_subject", label: "Межпредметные проекты", type: "cross_subject" },
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

function planRank(slug) {
  const map = { start: 0, teacher: 1, pro: 2, premium: 3, school: 4 };
  return map[slug] ?? 0;
}

function formatDateShort(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatOfferUntil(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function activeOffer(plan, period) {
  const offer = plan?.promotion;
  if (!offer) return null;
  if (period === "year" && offer.benefit_type === "fixed_price") return null;
  return offer;
}

function ctaLabel(plan, isCurrent, { expiresAt, currentSlug, period } = {}) {
  if (plan.cta_type === "contact" || plan.slug === SCHOOL_SLUG) return "Оставить заявку";
  const isFree = Boolean(plan.is_free) || plan.slug === "start";
  if (isCurrent && isFree) return "Текущий тариф";
  if (isCurrent) return period === "year" ? "Продлить на год" : "Продлить на месяц";
  const isDown = currentSlug && planRank(plan.slug) < planRank(currentSlug);
  if (isDown && expiresAt) {
    if (plan.slug === "start") return "Перейти на Старт после окончания подписки";
    return `Перейти с ${formatDateShort(expiresAt)}`;
  }
  if (plan.slug === "pro") return "Перейти на Профи";
  if (plan.slug === "start") return "Выбрать Старт";
  if (plan.slug === "teacher") return "Выбрать Учитель";
  if (plan.slug === "premium") return "Выбрать Премиум";
  return `Выбрать ${plan.name}`;
}

/** Ключевые пункты карточки — позиционирование тарифов, без «списка отсутствий». */
function buildHighlights(plan) {
  const l = plan.limits || {};
  const f = plan.features || {};
  const students =
    l.students != null ? `до ${l.students} активных учеников` : null;
  const variants =
    l.variants_monthly == null
      ? "Генератор вариантов без лимита"
      : `${l.variants_monthly} вариантов в месяц`;
  const workbooks =
    l.workbooks_monthly == null
      ? "Рабочие тетради без лимита"
      : `${l.workbooks_monthly} рабочих тетрадей в месяц`;
  const interactives =
    l.interactives == null
      ? "Создание интерактивов без лимита"
      : `${l.interactives} интерактива в месяц`;

  if (plan.slug === "start") {
    return [
      l.students != null && `до ${l.students} учеников`,
      "домашние задания и проверка",
      l.variants_monthly != null && `${l.variants_monthly} вариантов в месяц`,
      l.workbooks_monthly != null && `${l.workbooks_monthly} рабочих тетрадей в месяц`,
      "бесплатные материалы",
    ].filter(Boolean);
  }

  if (plan.slug === "teacher") {
    return [
      students,
      "расписание и журнал",
      "видеозанятия прямо на платформе",
      "ДЗ и проверка",
      l.variants_monthly != null && `${l.variants_monthly} вариантов в месяц`,
      l.workbooks_monthly != null && `${l.workbooks_monthly} рабочих тетрадей`,
      "расширенная библиотека",
    ].filter(Boolean);
  }

  if (plan.slug === "pro") {
    return [
      students,
      "расписание, журнал и видеозанятия",
      variants,
      workbooks,
      interactives,
      "полная основная библиотека",
      f.simulators && "симуляторы",
      f.mass_actions && "массовые действия",
      f.analytics && "расширенная аналитика",
    ].filter(Boolean);
  }

  if (plan.slug === "premium") {
    return [
      students,
      "группы без лимита",
      { text: "полная библиотека и Premium-материалы", accent: true },
      "симуляторы и межпредметные проекты",
      variants,
      workbooks,
      f.priority_support && "приоритетная поддержка",
      "полная аналитика",
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
    f.homework && "Домашние задания",
    f.review && "Проверка работ",
    f.simulators && "Симуляторы",
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
    case "limit_monthly": {
      const v = l[row.field];
      if (v == null) return "Без лимита";
      return `${v}/мес`;
    }
    case "feature":
      if (row.altMin != null && rank >= row.altMin) return "✓";
      return f[row.field] ? "✓" : "—";
    case "rank":
      return rank >= row.min ? "✓" : "—";
    case "always":
      return "✓";
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
    case "analytics_level":
      if (rank >= 3) return "Полная";
      if (rank >= 2 || f.analytics) return "Расширенная";
      if (rank >= 1) return "Базовая";
      return "—";
    case "simulators_level":
      if (f.simulators || rank >= 2) return "✓";
      if (rank >= 1) return "Часть";
      return "Демо";
    case "cross_subject":
      if (rank >= 3) return "✓";
      if (rank >= 2) return "Часть";
      return "—";
    default:
      return "—";
  }
}

function formatMoneyRub(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`;
}

function SubscriptionStatusCard({
  subscription,
  currentPlan,
  registrationPromo,
  onChoosePlan,
  onPromoDetails,
  onSetAutoRenew,
  onCancelSubscription,
  onCancelPending,
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
    plan_price_month: planPriceMonth,
    next_charge: nextCharge,
    has_payment_method: hasPaymentMethod,
    payment_method_mask: paymentMask,
    pending_plan_change: pendingChange,
  } = subscription;

  const endDate = promoEndsAt || expiresAt;
  const isExpired = status === "expired" || (!subscription.is_valid && status !== "pending");
  const isPastDue = status === "past_due";
  const isPending = status === "pending" || payment?.status === "pending";
  const paymentFailed = payment?.status === "failed" || isPastDue;
  const isCancelled = Boolean(cancelledAt) || status === "cancelled";
  const autoRenewOn = Boolean(autoRenew) && !cancelledAt;
  const canToggleAutoRenew = !isExpired && status !== "suspended";
  const isStart =
    (subscription.plan_slug || currentPlan?.slug) === "start" ||
    Boolean(currentPlan?.is_free);
  const showDisableAutoRenew = autoRenewOn && !isExpired && !isStart;
  const monthlyPrice =
    planPriceMonth != null
      ? formatMoneyRub(planPriceMonth)
      : currentPlan?.price_month != null
        ? formatMoneyRub(currentPlan.price_month)
        : null;

  if (launchPromo) {
    return (
      <section className="upg-status upg-status--promo" aria-labelledby="upg-status-title">
        <div className="upg-status__body">
          <h2 id="upg-status-title" className="upg-status__title">
            Сейчас у вас тариф «{planName || registrationPromo?.plan_name || "Премиум"}» по стартовой акции
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
          {monthlyPrice && !isStart ? <li>Стоимость: {monthlyPrice} / месяц</li> : null}
          <li>Действует до: {expiresAt ? formatDate(expiresAt) : "—"}</li>
          <li className="upg-status__auto">
            <span>Автопродление:</span>
            <div className="upg-auto-toggle" role="group" aria-label="Автопродление">
              <button
                type="button"
                className={autoRenewOn ? "is-active" : ""}
                disabled={!canToggleAutoRenew || managing || autoRenewOn}
                onClick={() => onSetAutoRenew(true)}
              >
                {managing === "enable_auto_renew" ? "…" : "Вкл"}
              </button>
              <button
                type="button"
                className={!autoRenewOn ? "is-active" : ""}
                disabled={!canToggleAutoRenew || managing || !autoRenewOn}
                onClick={() => onSetAutoRenew(false)}
              >
                {managing === "disable_auto_renew" ? "…" : "Выкл"}
              </button>
            </div>
          </li>
          {autoRenewOn && nextCharge?.at ? (
            <>
              <li>Следующее списание: {formatDate(nextCharge.at)}</li>
              <li>Сумма: {formatMoneyRub(nextCharge.amount)}</li>
            </>
          ) : null}
          {!autoRenewOn && !isStart && !isExpired && expiresAt ? (
            <li className="upg-status__note">
              После {formatDate(expiresAt)} будет активирован тариф «Старт».
            </li>
          ) : null}
          {paymentMask ? <li>Карта: {paymentMask}</li> : null}
        </ul>
        {isCancelled && expiresAt ? (
          <p className="upg-status__note">
            Автопродление отключено. Тариф продолжит действовать до {formatDate(expiresAt)}.
          </p>
        ) : null}
        {isPending ? (
          <p className="upg-status__note">Проверяем оплату… Завершите платёж в окне банка.</p>
        ) : null}
        {paymentFailed ? (
          <div className="upg-status__note upg-status__note--err">
            <p>
              Не удалось автоматически продлить подписку
              {payment?.plan_name ? ` «${payment.plan_name}»` : ""}.
            </p>
            <div className="upg-status__actions--row upg-status__support">
              <button type="button" className="upg-btn upg-btn--primary" onClick={onChoosePlan}>
                Оплатить вручную
              </button>
              <SupportContactLink />
            </div>
          </div>
        ) : null}
        {isExpired ? (
          <p className="upg-status__note">Подписка истекла. Выберите тариф, чтобы продолжить работу.</p>
        ) : null}
          {autoRenewOn && !hasPaymentMethod ? (
          <p className="upg-status__note">
            Для автопродления нужна сохранённая карта. Оплатите тариф ещё раз.
          </p>
        ) : null}
        {pendingChange ? (
          <div className="upg-status__pending" role="status">
            <p>
              <strong>Следующий тариф:</strong> {pendingChange.to_plan_name}
            </p>
            <p>
              <strong>Переход:</strong>{" "}
              {pendingChange.effective_at
                ? formatDateShort(pendingChange.effective_at)
                : "—"}
            </p>
            {pendingChange.is_to_start ? (
              <p className="upg-status__note">
                После {formatDateShort(pendingChange.effective_at)} вы перейдёте на бесплатный
                тариф «Старт».
              </p>
            ) : autoRenewOn ? (
              <p className="upg-status__note">
                {formatDateShort(pendingChange.effective_at)} подписка будет автоматически
                продлена на тарифе «{pendingChange.to_plan_name}» за{" "}
                {formatMoneyRub(pendingChange.next_price)}.
              </p>
            ) : (
              <p className="upg-status__note">
                Чтобы получить «{pendingChange.to_plan_name}» с{" "}
                {formatDateShort(pendingChange.effective_at)}, оплатите тариф до этой даты.
                Иначе будет активирован «Старт».
              </p>
            )}
            {pendingChange.prepaid ? (
              <p className="upg-status__note">
                Следующий период уже оплачен. Отменить переход нельзя — текущий тариф
                сохранится до {formatDateShort(pendingChange.effective_at)}.
              </p>
            ) : (
              <button
                type="button"
                className="upg-btn upg-btn--ghost"
                onClick={onCancelPending}
                disabled={managing}
              >
                {managing === "cancel_pending" ? "…" : "Отменить переход"}
              </button>
            )}
          </div>
        ) : null}
      </div>
      <div className="upg-status__actions">
        {showDisableAutoRenew ? (
          <button
            type="button"
            className="upg-btn upg-btn--danger"
            onClick={onCancelSubscription}
            disabled={managing}
          >
            {managing === "cancel" || managing === "disable_auto_renew"
              ? "…"
              : "Отключить автопродление"}
          </button>
        ) : !autoRenewOn && !isExpired && !isStart ? (
          <button type="button" className="upg-btn upg-btn--ghost" onClick={onChoosePlan}>
            Продлить сейчас
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
  referralEligible = false,
  referralPercent = 50,
  onSelect,
  selecting,
  expanded,
  onToggleFeatures,
  paymentsEnabled = true,
  currentSlug = null,
  expiresAt = null,
  onOfferDetails,
}) {
  const highlights = buildHighlights(plan).slice(0, 8);
  const priceMonth = Number(plan.price_month);
  const priceYear = Number(plan.price_year);
  const isContact = plan.cta_type === "contact" || plan.slug === SCHOOL_SLUG;
  const isFree = Boolean(plan.is_free) && !isContact;
  const paymentBlocked = !paymentsEnabled && !isFree && !isContact;
  const offer = activeOffer(plan, period);
  const offerLive = Boolean(offer?.can_redeem);
  const buttonLabel = offerLive
    ? offer.button_text || ctaLabel(plan, isCurrent, { expiresAt, currentSlug, period })
    : ctaLabel(plan, isCurrent, { expiresAt, currentSlug, period });

  const basePrice = period === "year" && priceYear > 0 ? priceYear : priceMonth;
  const referralFirstPrice =
    referralEligible && !isFree && !isContact && basePrice > 0 && !offerLive
      ? Math.round(basePrice * (1 - Number(referralPercent || 50) / 100))
      : null;

  let priceMain;
  let priceSub = null;
  let priceWas = null;
  if (isContact) {
    priceMain = "По запросу";
    priceSub = "Стоимость рассчитывается индивидуально";
  } else if (offerLive && offer.benefit_type === "free_period") {
    priceWas = formatMoney(basePrice);
    priceMain = "Бесплатно";
    priceSub = `${offer.free_months} ${offer.free_months === 1 ? "месяц" : offer.free_months < 5 ? "месяца" : "месяцев"} · далее ${formatMoney(offer.pricing?.renewal || basePrice)}/мес`;
  } else if (offerLive && offer.pricing?.current != null) {
    priceWas = formatMoney(offer.pricing.original || basePrice);
    priceMain = formatMoney(offer.pricing.current);
    priceSub = `первый период · далее ${formatMoney(offer.pricing.renewal || basePrice)}/мес`;
  } else if (isFree || priceMonth === 0) {
    priceMain = "Бесплатно";
  } else if (
    promoDiscount?.valid &&
    promoDiscount.plan_slug === plan.slug &&
    promoDiscount.final_amount != null
  ) {
    priceWas = formatMoney(basePrice);
    priceMain = formatMoney(promoDiscount.final_amount);
    priceSub =
      promoDiscount.applied_discount_source === "referral"
        ? "первый месяц по приглашению"
        : promoDiscount.message || "с учётом скидки";
  } else if (referralFirstPrice != null && period === "month") {
    priceWas = formatMoney(priceMonth);
    priceMain = formatMoney(referralFirstPrice);
    priceSub = `первый месяц · далее ${formatMoney(priceMonth)}/мес`;
  } else if (period === "year" && priceYear > 0) {
    priceMain = formatMoney(priceYear);
    const perMonth = priceYear / 12;
    if (Number.isFinite(perMonth) && perMonth > 0) {
      priceSub = `${formatMoney(perMonth)}/мес при оплате за год`;
    } else {
      priceSub = "за год";
    }
  } else {
    priceMain = formatMoney(priceMonth);
    priceSub = "в месяц";
  }

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
        {offerLive ? <span className="upg-card__badge upg-card__badge--offer">Специальное предложение</span> : null}
        {offer && !offerLive && offer.status === "ended" ? (
          <span className="upg-card__badge upg-card__badge--muted">Акция завершена</span>
        ) : null}
        {isCurrent ? <span className="upg-card__badge upg-card__badge--current">Текущий</span> : null}
      </div>

      <div className="upg-card__head">
        <h3 className="upg-card__name">{plan.name}</h3>
        <p className="upg-card__desc">{plan.short_description || plan.description}</p>
      </div>

      <div className="upg-card__price-block">
        {priceWas ? <div className="upg-card__price-was">{priceWas}</div> : null}
        <div className="upg-card__price">{priceMain}</div>
        {priceSub ? <div className="upg-card__price-sub">{priceSub}</div> : null}
        {offerLive && offer.ends_at ? (
          <div className="upg-card__price-note">
            Доступно до {formatOfferUntil(offer.ends_at)}
            {onOfferDetails ? (
              <>
                {" · "}
                <button type="button" className="upg-link-btn" onClick={() => onOfferDetails(offer)}>
                  Подробнее
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {referralFirstPrice != null && period === "month" && !promoDiscount?.valid ? (
          <div className="upg-card__price-note">Скидка действует только на первый месяц.</div>
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

      {plan.slug === "start" ? (
        <p className="upg-card__caveat">Без расписания, журнала и видеозанятий.</p>
      ) : null}

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
        ) : isCurrent && (isFree || isContact) ? (
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
            {selecting === plan.slug ? "Подождите…" : buttonLabel}
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

function OfferDetailsModal({ offer, onClose }) {
  if (!offer) return null;
  const original = offer.pricing?.original;
  const current = offer.pricing?.current;
  const renewal = offer.pricing?.renewal;
  return (
    <div className="upg-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="upg-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upg-offer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="upg-offer-title" className="upg-modal__title">
          {offer.title}
        </h2>
        {offer.status === "ended" ? (
          <p className="upg-modal__note">Акция завершена.</p>
        ) : null}
        {offer.description ? (
          <div className="upg-modal__block">
            <strong>Об акции</strong>
            <p>{offer.description}</p>
          </div>
        ) : null}
        {offer.how_to_get ? (
          <div className="upg-modal__block">
            <strong>Как получить</strong>
            <p>{offer.how_to_get}</p>
          </div>
        ) : null}
        {offer.terms ? (
          <div className="upg-modal__block">
            <strong>Условия</strong>
            <p>{offer.terms}</p>
          </div>
        ) : null}
        <div className="upg-modal__block">
          <strong>Тариф</strong>
          <p>{offer.plan?.name}</p>
        </div>
        <div className="upg-modal__block">
          <strong>Стоимость</strong>
          <p>
            {offer.benefit_type === "free_period"
              ? `${offer.free_months} мес. бесплатно, далее ${formatMoney(renewal)}/мес`
              : `${formatMoney(current)} сейчас${original ? ` (вместо ${formatMoney(original)})` : ""}, далее ${formatMoney(renewal)}/мес`}
          </p>
        </div>
        {offer.ends_at ? (
          <div className="upg-modal__block">
            <strong>Действует до</strong>
            <p>{formatOfferUntil(offer.ends_at)}</p>
          </div>
        ) : null}
        <div className="upg-modal__actions">
          <button type="button" className="upg-btn upg-btn--ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function DowngradeConfirmModal({
  open,
  plan,
  preview,
  selectedStudents,
  selectedGroups,
  onToggleStudent,
  onToggleGroup,
  onConfirm,
  onClose,
  busy,
}) {
  if (!open || !preview || !plan) return null;

  const students = preview.limits?.students || {};
  const groups = preview.limits?.groups || {};
  const storage = preview.limits?.storage || {};
  const studentLimit = Number(students.limit || 0);
  const groupLimit = groups.limit != null ? Number(groups.limit) : null;
  const studentsOk = !students.needs_selection || selectedStudents.length === studentLimit;
  const groupsOk =
    !groups.needs_selection ||
    groupLimit == null ||
    selectedGroups.length === groupLimit;
  const canSubmit = studentsOk && groupsOk && !busy;
  const when = preview.effective_at ? formatDateShort(preview.effective_at) : "окончания периода";
  const confirmLabel = preview.is_to_start
    ? `Перейти на Старт с ${when}`
    : `Перейти на ${plan.name} с ${when}`;

  return (
    <div className="upg-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="upg-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upg-downgrade-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="upg-downgrade-title" className="upg-modal__title">
          Перейти на «{plan.name}»?
        </h2>
        <p className="upg-modal__text">{preview.message}</p>
        {preview.losses?.length ? (
          <div className="upg-modal__block">
            <strong>Вы потеряете доступ к:</strong>
            <ul>
              {preview.losses.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {students.needs_selection ? (
          <div className="upg-modal__block">
            <strong>
              На тарифе «{plan.name}» доступно до {studentLimit} активных учеников. Сейчас у вас{" "}
              {students.current}.
            </strong>
            <p>
              Выберите {studentLimit}, которые останутся активными. Остальные будут переведены в
              архив — данные сохранятся.
            </p>
            <ul className="upg-modal__checklist">
              {(students.candidates || []).map((s) => {
                const checked = selectedStudents.includes(s.id);
                const name = [s.last_name, s.first_name].filter(Boolean).join(" ") || `#${s.id}`;
                return (
                  <li key={s.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && selectedStudents.length >= studentLimit}
                        onChange={() => onToggleStudent(s.id)}
                      />
                      {name}
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="upg-modal__hint">
              Выбрано: {selectedStudents.length} из {studentLimit}
            </p>
          </div>
        ) : null}
        {groups.needs_selection ? (
          <div className="upg-modal__block">
            <strong>
              На тарифе «{plan.name}» доступно до {groupLimit} активных групп. Сейчас у вас{" "}
              {groups.current}.
            </strong>
            <p>Выберите группы, которые останутся активными. Остальные — в архив.</p>
            <ul className="upg-modal__checklist">
              {(groups.candidates || []).map((g) => {
                const checked = selectedGroups.includes(g.id);
                return (
                  <li key={g.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && selectedGroups.length >= groupLimit}
                        onChange={() => onToggleGroup(g.id)}
                      />
                      {g.name || `Группа #${g.id}`}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {storage.over ? (
          <p className="upg-modal__warn" role="status">
            Использовано {storage.used_mb} МБ из {storage.limit_mb} МБ нового тарифа. Файлы не
            удаляются, но новые загрузки будут недоступны, пока объём не станет меньше лимита.
          </p>
        ) : null}
        <p className="upg-modal__note">Ваши данные и материалы удалены не будут.</p>
        <div className="upg-modal__actions">
          <button
            type="button"
            className="upg-btn upg-btn--primary"
            onClick={onConfirm}
            disabled={!canSubmit}
          >
            {busy ? "…" : confirmLabel}
          </button>
          <button type="button" className="upg-btn upg-btn--ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
        </div>
      </div>
    </div>
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
  const [noticeSupport, setNoticeSupport] = useState(false);
  const [noticeRetry, setNoticeRetry] = useState(null);
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
  const [downgradeModal, setDowngradeModal] = useState(null);
  const [offerModal, setOfferModal] = useState(null);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [confirmingDowngrade, setConfirmingDowngrade] = useState(false);
  const plansRef = useRef(null);
  const payIdemRef = useRef({});
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const showNotice = (text, { support = false, retry = null } = {}) => {
    setNotice(text);
    setNoticeSupport(Boolean(support));
    setNoticeRetry(typeof retry === "function" ? retry : null);
  };

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
          notifySubscriptionChanged();
        }
      } catch {
        /* ignore */
      }
    };

    const applyReturn = async () => {
      if (status === "fail" || status === "failed" || status === "cancelled") {
        if (!cancelled) {
          showNotice("Оплата не завершена. Можно выбрать тариф и попробовать снова.");
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
          showNotice(
            payment.plan_name
              ? `Оплата прошла успешно. Тариф «${payment.plan_name}» активирован.`
              : "Оплата прошла успешно. Тариф обновлён.",
          );
        } else if (status === "success") {
          showNotice(
            "Оплата получена, но обновление подписки занимает больше времени, чем обычно.",
            {
              support: true,
              retry: async () => {
                try {
                  const again = await syncSubscriptionPayment(paymentId);
                  if (again?.is_paid) {
                    showNotice(
                      again.plan_name
                        ? `Оплата прошла успешно. Тариф «${again.plan_name}» активирован.`
                        : "Оплата прошла успешно. Тариф обновлён.",
                    );
                    await refreshPlans();
                  } else {
                    showNotice(
                      "Оплата получена, но обновление подписки занимает больше времени, чем обычно.",
                      { support: true, retry: null },
                    );
                  }
                } catch {
                  showNotice(
                    "Не удалось проверить оплату. Если вы платили — напишите мне.",
                    { support: true },
                  );
                }
              },
            },
          );
        } else {
          showNotice(
            "Открылась тестовая страница без формы банка. Перезапустите Django с PAYMENT_PROVIDER=tbank.",
          );
        }
      } catch (err) {
        if (!cancelled) {
          showNotice(
            err?.data?.detail ||
              "Не удалось проверить оплату. Если вы платили — обновите страницу позже.",
            { support: true },
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
    notifySubscriptionChanged();
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
        "Отключить автопродление? Тариф продолжит действовать до конца оплаченного периода, затем станет доступен «Старт».",
      )
    ) {
      return;
    }
    setManaging("disable_auto_renew");
    try {
      await manageSubscription("disable_auto_renew");
      setNotice("Автопродление отключено. Оплаченный период сохранён.");
      await refreshPlans();
    } catch (err) {
      setNotice(err?.data?.detail || err?.message || "Не удалось отключить автопродление.");
    } finally {
      setManaging(null);
    }
  };

  const handleCancelPending = async () => {
    if (!window.confirm("Отменить запланированный переход на другой тариф?")) return;
    setManaging("cancel_pending");
    setNotice("");
    try {
      const result = await cancelPendingPlanChange();
      await refreshPlans();
      setNotice(result.message || "Переход отменён. Текущий тариф продолжит действовать.");
    } catch (err) {
      setNotice(err?.data?.detail || err?.message || "Не удалось отменить переход.");
    } finally {
      setManaging(null);
    }
  };

  const closeDowngradeModal = () => {
    if (confirmingDowngrade) return;
    setDowngradeModal(null);
    setSelectedStudents([]);
    setSelectedGroups([]);
    setSelecting(null);
  };

  const toggleStudentKeep = (id) => {
    setSelectedStudents((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleGroupKeep = (id) => {
    setSelectedGroups((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleConfirmDowngrade = async () => {
    if (!downgradeModal?.plan) return;
    const plan = downgradeModal.plan;
    const preview = downgradeModal.preview || {};
    setConfirmingDowngrade(true);
    setNotice("");
    try {
      const payload = { confirm: true };
      if (preview.limits?.students?.needs_selection) {
        payload.student_ids = selectedStudents;
      }
      if (preview.limits?.groups?.needs_selection) {
        payload.group_ids = selectedGroups;
      }
      const result = await changePlan(plan.slug, period, payload);
      setDowngradeModal(null);
      setSelectedStudents([]);
      setSelectedGroups([]);
      await refreshPlans();
      const when = result.effective_at
        ? formatDateShort(result.effective_at)
        : preview.effective_at
          ? formatDateShort(preview.effective_at)
          : "окончания периода";
      setNotice(
        result.message ||
          `Переход на «${plan.name}» запланирован с ${when}. До этой даты действует текущий тариф.`,
      );
    } catch (err) {
      setNotice(
        err?.data?.detail || err?.message || "Не удалось запланировать понижение тарифа.",
      );
    } finally {
      setConfirmingDowngrade(false);
      setSelecting(null);
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
      const source = data.applied_discount_source;
      let message;
      if (source === "referral") {
        message = data.message || `Реферальная скидка −${formatMoney(data.applied_discount || data.discount)} · к оплате ${formatMoney(data.final_amount || data.final_price)}`;
      } else if (data.discount_type === "bonus_days" || source === "promo" && data.applied_discount_type === "bonus_days") {
        message = `+${data.bonus_days || data.discount_value} бонусных дней`;
      } else {
        message =
          data.message ||
          `✓ ${data.code || code}: −${formatMoney(data.applied_discount || data.discount)} · к оплате ${formatMoney(data.final_amount || data.final_price)}`;
      }
      setPromoState({
        valid: true,
        message,
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
    if (!plan) return;
    if (plan.cta_type === "contact" || plan.slug === SCHOOL_SLUG) return;
    const isFree = Boolean(plan.is_free);
    const isExtendCurrent = plan.slug === currentSlug;
    if (isExtendCurrent && isFree) return;

    if (!paymentsEnabled && !isFree) {
      setNotice("Оплата временно недоступна. Попробуйте позже.");
      return;
    }

    setSelecting(plan.slug);
    setNotice("");
    let openedDowngradeModal = false;
    try {
      let result = { requires_payment: isExtendCurrent && !isFree };
      if (!isExtendCurrent) {
        result = await changePlan(plan.slug, period);
      }
      if (result.requires_downgrade_confirm || result.preview?.can_schedule) {
        const preview = result.preview || {};
        const students = preview.limits?.students;
        const groups = preview.limits?.groups;
        setSelectedStudents(
          students?.needs_selection
            ? (students.candidates || []).slice(0, Number(students.limit || 0)).map((s) => s.id)
            : [],
        );
        setSelectedGroups(
          groups?.needs_selection
            ? (groups.candidates || []).slice(0, Number(groups.limit || 0)).map((g) => g.id)
            : [],
        );
        openedDowngradeModal = true;
        setDowngradeModal({ plan, preview });
        return;
      }
      if (result.scheduled) {
        await refreshPlans();
        setNotice(
          result.message ||
            `Переход на «${plan.name}» запланирован. До даты перехода действует текущий тариф.`,
        );
        return;
      }
      if (result.requires_payment) {
        if (!paymentsEnabled) {
          setNotice("Оплата временно недоступна. Попробуйте позже.");
          return;
        }
        const promoCode = (() => {
          const offer = activeOffer(plan, period);
          if (offer?.can_redeem && offer.allow_promo_codes === false) return null;
          return promoState?.valid ? promoInput.trim() : null;
        })();
        const idemKey = `${plan.slug}:${period}`;
        if (!payIdemRef.current[idemKey]) {
          const uuid =
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
          payIdemRef.current[idemKey] = `pay_${plan.slug}_${period}_${uuid}`;
        }
        const payment = await createPayment(
          plan.slug,
          period,
          promoCode,
          payIdemRef.current[idemKey],
          activeOffer(plan, period)?.id || null,
        );
        if (payment.granted || payment.status === "paid") {
          await refreshPlans();
          setNotice(payment.discount?.message || payment.pricing?.message || "Предложение применено.");
          return;
        }
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
            delete payIdemRef.current[idemKey];
            setNotice(
              paid.plan_name
                ? `Оплата прошла успешно. Тариф «${paid.plan_name}» активирован.`
                : "Оплата прошла успешно. Тариф обновлён.",
            );
            await refreshPlans();
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
        await refreshPlans();
        setTimeout(() => navigate("/cabinet"), 1200);
      }
    } catch (err) {
      setNotice(
        err?.data?.detail ||
          err?.data?.message ||
          err?.message ||
          "Не удалось изменить тариф. Попробуйте позже.",
      );
    } finally {
      if (!openedDowngradeModal) setSelecting(null);
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
            onCancelPending={handleCancelPending}
            managing={managing}
          />

          {promoDetailsOpen && registrationPromo ? (
            <div className="upg-promo-details" role="region" aria-label="Подробнее об акции">
              <strong>{registrationPromo.title || "Стартовая акция"}</strong>
              <p>
                {registrationPromo.message ||
                  "Всем зарегистрировавшимся — тариф «Премиум» на 3 месяца с даты регистрации."}
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

          {(plansData?.promotions || []).filter((p) => p.can_redeem || p.status === "ended").length ? (
            <section className="upg-offers" aria-labelledby="upg-offers-title">
              <h2 id="upg-offers-title" className="upg-section-title">
                Специальные предложения
              </h2>
              <div className="upg-offers__list">
                {(plansData.promotions || [])
                  .filter((p) => p.can_redeem || p.status === "ended")
                  .map((offer) => (
                    <article key={offer.id} className="upg-offer-card">
                      <div className="upg-offer-card__head">
                        <strong>{offer.title}</strong>
                        {offer.status === "ended" ? (
                          <span className="upg-card__badge upg-card__badge--muted">Завершена</span>
                        ) : (
                          <span className="upg-card__badge upg-card__badge--offer">Акция</span>
                        )}
                      </div>
                      {offer.short_description ? <p>{offer.short_description}</p> : null}
                      <p className="upg-offer-card__meta">
                        {offer.plan?.name}
                        {offer.ends_at ? ` · до ${formatOfferUntil(offer.ends_at)}` : ""}
                      </p>
                      <div className="upg-offer-card__actions">
                        <button
                          type="button"
                          className="upg-link-btn"
                          onClick={() => setOfferModal(offer)}
                        >
                          Подробнее
                        </button>
                        {offer.can_redeem ? (
                          <button
                            type="button"
                            className="upg-card__btn"
                            onClick={() => {
                              const target = plans.find((p) => p.slug === offer.plan?.slug);
                              if (target) handleSelect(target);
                            }}
                          >
                            {offer.button_text || "Выбрать тариф"}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
              </div>
            </section>
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

          {referral?.my_discount?.eligible ? (
            <div className="upg-referral-banner" role="status">
              <strong>Ваша скидка по приглашению — 50%</strong>
              <p>На первый месяц любого платного тарифа. Скидка действует только на первый месяц.</p>
            </div>
          ) : null}

          <div className="upg-grid">
            {mainPlans.map((plan) => (
              <PlanCard
                key={plan.slug}
                plan={plan}
                isCurrent={plan.slug === currentSlug}
                period={period}
                promoDiscount={promoState}
                referralEligible={Boolean(referral?.my_discount?.eligible)}
                referralPercent={referral?.my_discount?.percent || 50}
                onSelect={handleSelect}
                selecting={selecting}
                expanded={compareOpen}
                onToggleFeatures={() => setCompareOpen((v) => !v)}
                paymentsEnabled={paymentsEnabled}
                currentSlug={currentSlug}
                expiresAt={subscription?.expires_at || subscription?.promo_ends_at}
                onOfferDetails={setOfferModal}
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
                Приглашайте коллег
              </h2>
              <p className="upg-referral__desc">
                Поделитесь персональной ссылкой.
              </p>
              <ul className="upg-referral__list">
                <li>
                  <strong>Коллеге — 50% на первый месяц</strong>
                </li>
                <li>
                  <strong>Вам — 14 дней подписки после его первой оплаты</strong>
                </li>
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
                    : "Скопировать ссылку"}
              </button>
              {referralLink?.url ? (
                <p className="upg-referral__url">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}${referralLink.url}`
                    : referralLink.url}
                </p>
              ) : null}
              {referral.stats ? (
                <div className="upg-referral__stats" aria-label="Статистика рефералов">
                  <div>
                    <strong>{referral.stats.invited ?? 0}</strong>
                    <span>Приглашено</span>
                  </div>
                  <div>
                    <strong>{referral.stats.paid ?? 0}</strong>
                    <span>Оплатили</span>
                  </div>
                  <div>
                    <strong>{referral.stats.bonus_days ?? 0}</strong>
                    <span>Бонусные дни</span>
                  </div>
                </div>
              ) : null}
              {Array.isArray(referral.history) && referral.history.length > 0 ? (
                <ul className="upg-referral__history">
                  {referral.history.map((item, idx) => (
                    <li key={`${item.display_name}-${idx}`}>
                      {item.display_name}: {item.note}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <FaqSection />

          <DowngradeConfirmModal
            open={Boolean(downgradeModal)}
            plan={downgradeModal?.plan}
            preview={downgradeModal?.preview}
            selectedStudents={selectedStudents}
            selectedGroups={selectedGroups}
            onToggleStudent={toggleStudentKeep}
            onToggleGroup={toggleGroupKeep}
            onConfirm={handleConfirmDowngrade}
            onClose={closeDowngradeModal}
            busy={confirmingDowngrade}
          />
          <OfferDetailsModal offer={offerModal} onClose={() => setOfferModal(null)} />
        </>
      )}
    </CabinetPageShell>
  );
}
