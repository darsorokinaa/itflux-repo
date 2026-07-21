/** Форматирование сумм и статусов оплат. */

const BILLING_TYPE_LABELS = {
  per_lesson: "За урок",
  per_minute: "За минуту",
  per_hour: "Почасовая",
  package_lessons: "Абонемент (уроки)",
  package_minutes: "Абонемент (минуты)",
  monthly_fixed: "Фикс за месяц",
  manual: "Вручную",
};

const FINANCIAL_STATUS_LABELS = {
  not_specified: "Не указано",
  not_charged: "Не начислен",
  awaiting_payment: "Ожидает оплаты",
  partially_paid: "Частично оплачен",
  paid: "Оплачено",
  paid_from_package: "Из абонемента",
  not_billable: "Не подлежит оплате",
  refunded: "Возвращён",
  needs_decision: "Требует оформления",
};

const TX_TYPE_LABELS = {
  payment: "Оплата",
  charge: "Начисление",
  package_purchase: "Покупка абонемента",
  package_consumption: "Списание абонемента",
  package_return: "Возврат единиц",
  refund: "Возврат",
  discount: "Скидка",
  adjustment: "Корректировка",
  write_off: "Списание",
};

const METHOD_LABELS = {
  transfer: "Перевод",
  cash: "Наличные",
  card: "Банковская карта",
  sbp: "СБП",
  other: "Другое",
};

export function billingTypeLabel(type) {
  return BILLING_TYPE_LABELS[type] || type || "—";
}

export function financialStatusLabel(status) {
  return FINANCIAL_STATUS_LABELS[status] || status || "—";
}

export function transactionTypeLabel(type) {
  return TX_TYPE_LABELS[type] || type || "—";
}

export function paymentMethodLabel(method) {
  return METHOD_LABELS[method] || method || "";
}

export function formatMoney(amount, currency = "RUB") {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (Number.isNaN(n)) return String(amount);
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
  if (currency === "RUB" || currency === "₽") return `${formatted} ₽`;
  return `${formatted} ${currency}`;
}

export function formatUnits(units, unitType) {
  if (units == null) return "—";
  const n = Number(units);
  const value = Number.isNaN(n) ? units : String(n).replace(/\.00$/, "");
  if (unitType === "minute") {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      const mod10 = num % 10;
      const mod100 = num % 100;
      let word = "минут";
      if (mod10 === 1 && mod100 !== 11) word = "минута";
      else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "минуты";
      return `${value} ${word}`;
    }
    return `${value} мин`;
  }
  const num = Number(value);
  if (!Number.isNaN(num)) {
    const mod10 = num % 10;
    const mod100 = num % 100;
    let word = "занятий";
    if (mod10 === 1 && mod100 !== 11) word = "занятие";
    else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "занятия";
    return `${value} ${word}`;
  }
  return `${value} ур.`;
}

export function financialStatusMod(status) {
  switch (status) {
    case "paid":
    case "paid_from_package":
    case "not_billable":
      return "ok";
    case "awaiting_payment":
    case "partially_paid":
      return "warn";
    case "needs_decision":
    case "not_specified":
      return "alert";
    default:
      return "muted";
  }
}

/** Есть ли у ученика настроенные условия оплаты. */
export function isBillingConfigured(account) {
  if (!account) return false;
  if (account.package) return true;
  if (account.status_label === "нет активного тарифа" || account.status_label === "оплата не настроена") {
    return false;
  }
  const hasPrice = !!(
    account.default_lesson_price
    || account.hourly_rate
    || account.per_minute_rate
    || account.monthly_fee
    || account.settings?.default_lesson_price
    || account.settings?.hourly_rate
    || account.settings?.per_minute_rate
    || account.settings?.monthly_fee
  );
  return hasPrice;
}

export function isLowPackage(account) {
  return account?.status_label === "заканчивается абонемент"
    || (account?.package && (
      (account.package.unit_type === "lesson" && Number(account.package.remaining_units) <= 2)
      || (account.package.unit_type === "minute" && Number(account.package.remaining_units) <= 120)
    ));
}

export function needsDecision(account) {
  return account?.status_label === "требуется оформление";
}

/**
 * Вычисляемое состояние ученика для UI.
 * kind: not_configured | debt | low_package | needs_decision | advance | paid
 */
export function resolveAccountState(account) {
  if (!account) {
    return {
      kind: "not_configured",
      mod: "muted",
      headline: "Оплата не настроена",
      detail: "",
      primaryAction: "setup",
      primaryLabel: "Настроить",
      showReminder: false,
    };
  }

  const currency = account.currency || "RUB";
  const debt = Number(account.balance?.debt || 0);
  const credit = Number(account.balance?.credit || 0);
  const configured = isBillingConfigured(account);
  const pkg = account.package;
  const decision = needsDecision(account);
  const lowPkg = isLowPackage(account);

  if (!configured) {
    return {
      kind: "not_configured",
      mod: "muted",
      headline: "Оплата не настроена",
      detail: "Условия оплаты не настроены",
      primaryAction: "setup",
      primaryLabel: "Настроить",
      showReminder: false,
    };
  }

  if (decision) {
    return {
      kind: "needs_decision",
      mod: "warn",
      headline: "Требует оформления",
      detail: "Есть урок без финансового решения",
      primaryAction: "finalize",
      primaryLabel: "Оформить",
      showReminder: false,
    };
  }

  if (debt > 0) {
    return {
      kind: "debt",
      mod: "alert",
      headline: `Долг ${formatMoney(debt, currency)}`,
      detail: "Есть неоплаченные уроки",
      primaryAction: "payment",
      primaryLabel: "Добавить оплату",
      showReminder: true,
      debt,
      credit: 0,
    };
  }

  if (lowPkg && pkg) {
    return {
      kind: "low_package",
      mod: "warn",
      headline: `Осталось ${formatUnits(pkg.remaining_units, pkg.unit_type)}`,
      detail: pkg.expires_at
        ? `Действует до ${formatShortDate(pkg.expires_at)}`
        : "Абонемент заканчивается",
      primaryAction: "package",
      primaryLabel: "Продлить",
      showReminder: true,
    };
  }

  if (pkg) {
    return {
      kind: credit > 0 ? "advance" : "paid",
      mod: "ok",
      headline: `Осталось ${formatUnits(pkg.remaining_units, pkg.unit_type)}`,
      detail: pkg.expires_at
        ? `Действует до ${formatShortDate(pkg.expires_at)}`
        : credit > 0
          ? `Аванс ${formatMoney(credit, currency)}`
          : "Всё оплачено",
      primaryAction: "open",
      primaryLabel: "Открыть",
      showReminder: false,
      credit,
    };
  }

  if (credit > 0) {
    return {
      kind: "advance",
      mod: "ok",
      headline: `Аванс ${formatMoney(credit, currency)}`,
      detail: "Всё оплачено",
      primaryAction: "open",
      primaryLabel: "Открыть",
      showReminder: false,
      credit,
    };
  }

  return {
    kind: "paid",
    mod: "ok",
    headline: "Всё оплачено",
    detail: "",
    primaryAction: "open",
    primaryLabel: "Открыть",
    showReminder: false,
  };
}

export function formatPaymentTerms(account) {
  if (!account) return "Условия не настроены";
  if (!isBillingConfigured(account)) return "Условия оплаты не настроены";

  const type = billingTypeLabel(account.billing_type);
  const currency = account.currency || "RUB";
  const duration = account.settings?.default_lesson_duration_minutes || 60;

  if (account.billing_type === "package_lessons" || account.billing_type === "package_minutes") {
    if (account.package) {
      return `${type} · ${formatUnits(account.package.total_units, account.package.unit_type)}`;
    }
    return type;
  }

  if (account.billing_type === "per_hour" && account.hourly_rate) {
    return `${type} · ${formatMoney(account.hourly_rate, currency)} / час`;
  }
  if (account.billing_type === "per_minute" && account.per_minute_rate) {
    return `${type} · ${formatMoney(account.per_minute_rate, currency)} / мин`;
  }
  if (account.billing_type === "monthly_fixed" && account.monthly_fee) {
    return `${type} · ${formatMoney(account.monthly_fee, currency)}`;
  }
  if (account.default_lesson_price) {
    return `${type} · ${formatMoney(account.default_lesson_price, currency)} / ${duration} минут`;
  }
  return type;
}

export function formatShortDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function formatLessonWhen(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startLesson = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startLesson - startToday) / 86400000);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Сегодня · ${time}`;
  if (diffDays === 1) return `Завтра · ${time}`;
  return `${formatShortDate(d)} · ${time}`;
}

export function formatTxWhen(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday - startDay) / 86400000);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Сегодня, ${time}`;
  if (diffDays === 1) return `Вчера, ${time}`;
  return `${formatShortDate(d)}, ${time}`;
}

function badgeLooksLikePackage(badge) {
  const source = String(badge?.price_source_label || "").toLowerCase();
  const label = String(badge?.label || "").toLowerCase();
  return source.includes("абонемент") || label.includes("абонемент");
}

/** Компактный статус урока в расписании / карточке занятия. */
export function compactLessonBillingLabel(badge) {
  if (!badge) return "";
  const status = badge.financial_status;
  if (status === "paid") return "Оплачено";
  if (status === "paid_from_package") {
    return badge.label?.startsWith("Абонемент") ? badge.label : "Оплачено из абонемента";
  }
  if (status === "awaiting_payment") {
    const amount = Number(badge.amount || 0);
    if (amount > 0) return `Ожидает оплаты · ${formatMoney(amount, badge.currency)}`;
    return "Ожидает оплаты";
  }
  if (status === "partially_paid") {
    const amount = Number(badge.amount || 0);
    if (amount > 0) return `Частично оплачен · долг ${formatMoney(amount, badge.currency)}`;
    return "Частично оплачен";
  }
  if (status === "not_charged") {
    if (badgeLooksLikePackage(badge)) return "Абонемент (ещё не списан)";
    const amount = Number(badge.amount || 0);
    if (amount > 0) return `Не начислен · ${formatMoney(amount, badge.currency)}`;
    return "Не начислен";
  }
  if (status === "needs_decision" || status === "not_specified") {
    if (badgeLooksLikePackage(badge)) return "Абонемент — требует оформления";
    return "Требует оформления";
  }
  if (status === "not_billable") return "Не оплачивается";
  if (status === "refunded") return "Возвращён";
  return badge.label || financialStatusLabel(status);
}

export function describeTransaction(tx) {
  const type = tx.transaction_type;
  const currency = tx.currency || "RUB";
  const unitType = tx.unit_type || "lesson";
  if (type === "payment" || type === "package_purchase") {
    return `Оплата ${formatMoney(tx.amount, currency)}`;
  }
  if (type === "package_consumption") {
    const units = Number(tx.package_units || 0);
    const base = units
      ? `Списано ${formatUnits(Math.abs(units), unitType)}`
      : "Списание абонемента";
    if (tx.event_starts_at) {
      const when = formatLessonWhen(tx.event_starts_at).replace(" · ", " в ");
      const title = String(tx.event_title || "").trim();
      if (title) return `${base} за урок «${title}» (${when})`;
      return `${base} за урок ${when}`;
    }
    return base;
  }
  if (type === "package_return") {
    const units = Number(tx.package_units || 0);
    if (units) return `Возврат ${formatUnits(Math.abs(units), unitType)}`;
    return "Возврат в абонемент";
  }
  if (type === "charge") {
    return `Начислено ${formatMoney(tx.amount, currency)}`;
  }
  if (type === "refund") {
    return `Возврат ${formatMoney(tx.amount, currency)}`;
  }
  return transactionTypeLabel(type);
}

export {
  BILLING_TYPE_LABELS,
  FINANCIAL_STATUS_LABELS,
  TX_TYPE_LABELS,
  METHOD_LABELS,
};
