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
  if (!Number.isFinite(n)) return null;
  return `${prefix}${n} ${ruCount(n, one, few, many)}`;
}

function monthlyLine(value, { one, few, many, unlimited }) {
  if (value == null) return unlimited || null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n} ${ruCount(n, one, few, many)} в месяц`;
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

  if (plan.slug === "start") {
    return [
      limitLine(l.students, {
        one: "ученик",
        few: "ученика",
        many: "учеников",
      }),
      groups,
      storageLine,
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
      "расписание и журнал",
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
      "расписание, журнал и видеозанятия",
      variants,
      workbooks,
      interactives,
      "полная основная библиотека",
      notifications,
      ai,
      f.simulators && "симуляторы",
      f.mass_actions && "массовые действия",
      f.analytics && "расширенная аналитика",
    ].filter(Boolean);
  }

  if (plan.slug === "premium") {
    return [
      students,
      groups,
      storageLine,
      { text: "полная библиотека и Premium-материалы", accent: true },
      "симуляторы и межпредметные проекты",
      variants,
      workbooks,
      interactives,
      notifications,
      ai,
      f.priority_support && "приоритетная поддержка",
      f.analytics && "полная аналитика",
    ].filter(Boolean);
  }

  if (plan.slug === "school") {
    return [
      f.multi_teacher && "Несколько преподавателей",
      f.team_roles && "Роли в команде",
      storageLine,
      "Единый кабинет организации",
      "Управление лицензиями",
      f.analytics && "Общая аналитика",
      "Администратор организации",
      "Индивидуальные лимиты",
      ai,
      f.priority_support && "Корпоративная поддержка",
    ].filter(Boolean);
  }

  return [
    students,
    groups,
    storageLine,
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
