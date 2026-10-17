/** Подписи лимитов и отличий тарифа для карточек витрины и кабинета. */

export function formatStorageLabel(mb) {
  if (mb == null || mb === "") return null;
  const n = Number(mb);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1024) {
    const gb = n / 1024;
    const pretty = Number.isInteger(gb) ? String(gb) : String(Math.round(gb * 10) / 10);
    return `${pretty} ГБ`;
  }
  return `${n} МБ`;
}

function ruCount(n, one, few, many) {
  const abs = Math.abs(Number(n) || 0) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function limitLine(value, { one, few, many, unlimited, prefix = "до " }) {
  if (value == null) return unlimited || null;
  const n = Number(value);
  // r36: нулевой лимит — функции нет в тарифе, «до 0 учеников» не показываем.
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${prefix}${n} ${ruCount(n, one, few, many)}`;
}

function monthlyLine(value, { one, few, many, unlimited }) {
  if (value == null) return unlimited || null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n} ${ruCount(n, one, few, many)} в месяц`;
}

function teacherBankLines(limits, features) {
  const l = limits || {};
  const f = features || {};
  const lines = [];
  if (l.teacher_tasks !== undefined) {
    lines.push(
      limitLine(l.teacher_tasks, {
        one: "задача в личном банке",
        few: "задачи в личном банке",
        many: "задач в личном банке",
        unlimited: "личный банк задач без лимита",
      }),
    );
  }
  if (l.teacher_task_copies_monthly !== undefined) {
    lines.push(
      monthlyLine(l.teacher_task_copies_monthly, {
        one: "копия из общего банка",
        few: "копии из общего банка",
        many: "копий из общего банка",
        unlimited: "копирование из общего банка без лимита",
      }),
    );
  }
  if (f.teacher_task_attachments) {
    lines.push("файлы к задачам");
  }
  return lines.filter(Boolean);
}

/**
 * @param {object} plan
 * @param {{ includeAi?: boolean }} [opts]
 */
export function buildPlanHighlights(plan, opts = {}) {
  const includeAi = Boolean(opts.includeAi);
  const l = plan?.limits || {};
  const f = plan?.features || {};
  const storage = formatStorageLabel(l.storage_mb);
  const storageLine = storage ? `${storage} хранилища` : null;
  const students = limitLine(l.students, {
    one: "активный ученик",
    few: "активных ученика",
    many: "активных учеников",
  });
  const groups = limitLine(l.groups, {
    one: "группа",
    few: "группы",
    many: "групп",
    unlimited: "группы без лимита",
  });
  const variants = monthlyLine(l.variants_monthly, {
    one: "вариант",
    few: "варианта",
    many: "вариантов",
    unlimited: "генератор вариантов без лимита",
  });
  const workbooks = monthlyLine(l.workbooks_monthly, {
    one: "рабочая тетрадь",
    few: "рабочие тетради",
    many: "рабочих тетрадей",
    unlimited: "рабочие тетради без лимита",
  });
  const interactives = monthlyLine(l.interactives, {
    one: "интерактив",
    few: "интерактива",
    many: "интерактивов",
    unlimited: "интерактивы без лимита",
  });
  const ai =
    includeAi && l.ai_requests != null
      ? monthlyLine(l.ai_requests, {
          one: "ИИ-запрос",
          few: "ИИ-запроса",
          many: "ИИ-запросов",
        })
      : null;
  const notifications = f.advanced_notifications
    ? "расширенные уведомления"
    : f.basic_notifications
      ? "уведомления"
      : null;
  const bank = teacherBankLines(l, f);

  if (plan.slug === "start") {
    return [
      limitLine(l.students, {
        one: "ученик",
        few: "ученика",
        many: "учеников",
      }),
      groups,
      storageLine,
      ...bank,
      "домашние задания и проверка",
      variants,
      workbooks,
      interactives,
      ai,
      "бесплатные материалы",
    ].filter(Boolean);
  }

  if (plan.slug === "teacher") {
    return [
      students,
      groups,
      storageLine,
      ...bank,
      "расписание и журнал",
      "Запись учеников по ссылке",
      "видеозанятия прямо на платформе",
      "ДЗ и проверка",
      variants,
      workbooks,
      interactives,
      notifications,
      ai,
      "расширенная библиотека",
    ].filter(Boolean);
  }

  if (plan.slug === "pro") {
    return [
      students,
      groups,
      storageLine,
      ...bank,
      "расписание, журнал и видеозанятия",
      "Запись учеников по ссылке",
      variants,
      workbooks,
      interactives,
      notifications,
      ai,
      f.mass_actions && "массовые действия",
    ].filter(Boolean);
  }

  if (plan.slug === "premium") {
    return [
      students,
      groups,
      storageLine,
      ...bank,
      { text: "полная библиотека и Premium-материалы", accent: true },
      "Запись учеников по ссылке",
      "симуляторы и межпредметные проекты",
      variants,
      workbooks,
      interactives,
      notifications,
      ai,
      f.priority_support && "приоритетная поддержка",
    ].filter(Boolean);
  }

  if (plan.slug === "school") {
    return [
      "Подключаем каждого преподавателя школы на «Профи» с индивидуальными условиями",
      l.ai_tokens_monthly ? `от ${l.ai_tokens_monthly} токенов «Цифрика» в месяц` : null,
      storageLine,
      ...bank,
      "Индивидуальные условия подключения",
    ].filter(Boolean);
  }

  return [
    students,
    groups,
    storageLine,
    ...bank,
    f.homework && "Домашние задания",
    f.review && "Проверка работ",
    variants,
    workbooks,
    interactives,
    notifications,
    ai,
    f.simulators && "Симуляторы",
  ].filter(Boolean);
}

/**
 * r36: реальная выгода годовой оплаты по ценам тарифа (без выдуманных цифр).
 * @returns {{ months: number, percent: number, saved: number, perMonth: number } | null}
 */
export function yearSavings(plan) {
  const month = Number(plan?.price_month);
  const year = Number(plan?.price_year);
  if (!Number.isFinite(month) || !Number.isFinite(year) || month <= 0 || year <= 0) return null;
  const full = month * 12;
  if (year >= full) return null;
  const saved = full - year;
  return {
    months: Math.round((saved / month) * 10) / 10,
    percent: Math.round((saved / full) * 100),
    saved,
    perMonth: Math.round(year / 12),
  };
}

export function yearSavingsText(plan) {
  const s = yearSavings(plan);
  if (!s) return null;
  const fmt = (n) => new Intl.NumberFormat("ru-RU").format(Math.round(n));
  return `${fmt(s.perMonth)} ₽/мес · выгода ${fmt(s.saved)} ₽ (−${s.percent}%) против помесячной оплаты`;
}
