export type AccessReason =
  | "anonymous"
  | "insufficient_plan"
  | "feature_not_in_plan"
  | "limit_reached";

export type AccessResourceType =
  | "material"
  | "lesson"
  | "interesting"
  | "interactive"
  | "feature"
  | "variant"
  | "workbook"
  | "students"
  | "groups"
  | "lessons"
  | "ai"
  | "schedule"
  | "student_booking"
  | "content"
  | "teacher_tasks"
  | "teacher_task_copies"
  | "teacher_task_attachments"
  | "storage";

export type AccessDeniedPayload = {
  code: string;
  message: string;
  feature?: string;
  min_plan?: string;
  recommended_plan?: string;
  upgrade_required?: boolean;
  limit?: number;
  current?: number;
  used_bytes?: number;
  limit_bytes?: number;
};

export type AccessGateContext = {
  reason: AccessReason;
  resourceType: AccessResourceType;
  resourceName?: string;
  resourceId?: string;
  requiredPlan?: string;
  currentPlan?: string;
  sourcePage?: string;
  returnUrl?: string;
  limit?: number;
  current?: number;
};

/** Display names from seeded tariffs — fallback if pricing API is unavailable. */
export const PLAN_DISPLAY_NAMES: Record<string, string> = {
  start: "Старт",
  teacher: "Учитель",
  repetitor: "Учитель",
  pro: "Профи",
  profi: "Профи",
  premium: "Премиум",
  school: "Школа",
};

const RETURN_STORAGE_KEY = "itflux_return_to";

const ANON_LIMIT_CODES = new Set([
  "ANON_VARIANT_LIMIT_REACHED",
  "ANON_WORKBOOK_LIMIT_REACHED",
]);

const LIMIT_CODES: Record<string, AccessResourceType> = {
  ANON_VARIANT_LIMIT_REACHED: "variant",
  VARIANT_LIMIT_REACHED: "variant",
  ANON_WORKBOOK_LIMIT_REACHED: "workbook",
  WORKBOOK_LIMIT_REACHED: "workbook",
  STUDENT_LIMIT_REACHED: "students",
  GROUP_LIMIT_REACHED: "groups",
  LESSON_LIMIT_REACHED: "lessons",
  INTERACTIVE_LIMIT_REACHED: "interactive",
  AI_LIMIT_REACHED: "ai",
  TEACHER_TASK_LIMIT_REACHED: "teacher_tasks",
  TEACHER_TASK_COPY_LIMIT_REACHED: "teacher_task_copies",
  QUOTA_EXCEEDED: "storage",
};

const FEATURE_CODES: Record<string, AccessResourceType> = {
  SCHEDULE_REQUIRES_PAID_PLAN: "schedule",
  BOOKING_REQUIRES_TEACHER_PLAN: "student_booking",
  TEACHER_TASK_ATTACHMENTS_REQUIRED: "teacher_task_attachments",
};

const AUTH_CODES = new Set(["AUTH_REQUIRED", "auth_required"]);

export function planDisplayName(slug?: string, fallbackName?: string) {
  if (fallbackName) return fallbackName;
  if (!slug) return "";
  return PLAN_DISPLAY_NAMES[slug] || slug;
}

function formatStorageBytes(bytes?: number) {
  if (bytes == null || Number.isNaN(bytes)) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)} ГБ`;
  }
  return `${Math.round(mb)} МБ`;
}

export function safeReturnPath(path: unknown): string {
  if (!path || typeof path !== "string") return "";
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return "";
  }
  if (trimmed.includes("://") || trimmed.includes("\\")) return "";
  return trimmed;
}

export function rememberReturnPath(path: unknown) {
  const safe = safeReturnPath(path);
  if (!safe || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(RETURN_STORAGE_KEY, safe);
  } catch {
    /* ignore */
  }
}

export function takeReturnPath(): string {
  if (typeof sessionStorage === "undefined") return "";
  try {
    const value = sessionStorage.getItem(RETURN_STORAGE_KEY) || "";
    sessionStorage.removeItem(RETURN_STORAGE_KEY);
    return safeReturnPath(value);
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function payloadFromRecord(record: Record<string, unknown> | null): AccessDeniedPayload | null {
  if (!record) return null;
  const nested =
    asRecord(record.error) ||
    asRecord(record.detail) ||
    asRecord(asRecord(record.data)?.error) ||
    asRecord(asRecord(record.data)?.detail);
  const source = typeof record.code === "string" ? record : nested;
  if (!source || typeof source.code !== "string") return null;
  const message =
    (typeof source.message === "string" && source.message) ||
    (typeof source.error === "string" && source.error) ||
    (typeof record.message === "string" && record.message) ||
    "";
  return {
    code: source.code,
    message,
    feature: typeof source.feature === "string" ? source.feature : undefined,
    min_plan: typeof source.min_plan === "string" ? source.min_plan : undefined,
    recommended_plan:
      typeof source.recommended_plan === "string" ? source.recommended_plan : undefined,
    upgrade_required: Boolean(source.upgrade_required),
    limit: typeof source.limit === "number" ? source.limit : undefined,
    current: typeof source.current === "number" ? source.current : undefined,
    used_bytes:
      typeof source.used_bytes === "number"
        ? source.used_bytes
        : typeof record.used_bytes === "number"
          ? record.used_bytes
          : undefined,
    limit_bytes:
      typeof source.limit_bytes === "number"
        ? source.limit_bytes
        : typeof record.limit_bytes === "number"
          ? record.limit_bytes
          : undefined,
  };
}

export function parseAccessDenied(input: unknown): AccessDeniedPayload | null {
  if (!input) return null;
  if (typeof input === "object") {
    const record = asRecord(input);
    const fromSelf = payloadFromRecord(record);
    if (fromSelf) return fromSelf;
    const data = payloadFromRecord(asRecord(record?.data));
    if (data) return data;
  }
  return null;
}

export function isAnonLimitError(input: unknown): boolean {
  const payload = parseAccessDenied(input);
  return Boolean(payload && ANON_LIMIT_CODES.has(payload.code));
}

export function isAccessGateError(input: unknown): boolean {
  return Boolean(classifyAccessError(input));
}

export function accessDeniedMessage(input: unknown, fallback = "Не удалось выполнить действие"): string {
  const payload = parseAccessDenied(input);
  if (payload?.message) return payload.message;
  if (input && typeof input === "object") {
    const record = asRecord(input);
    if (typeof record?.message === "string" && record.message) return record.message;
    if (typeof record?.error === "string" && record.error) return record.error;
  }
  if (input instanceof Error && input.message) return input.message;
  return fallback;
}

function resourceFromFeature(feature?: string): AccessResourceType {
  if (!feature) return "content";
  if (feature === "variants") return "variant";
  if (feature === "workbooks") return "workbook";
  if (feature === "content") return "material";
  if (
    feature === "schedule" ||
    feature === "student_booking" ||
    feature === "interactive" ||
    feature === "ai" ||
    feature === "students" ||
    feature === "groups" ||
    feature === "teacher_tasks" ||
    feature === "teacher_task_copies" ||
    feature === "teacher_task_attachments" ||
    feature === "storage"
  ) {
    return feature;
  }
  return "feature";
}

export function classifyAccessError(
  input: unknown,
  extras: Partial<AccessGateContext> = {},
): AccessGateContext | null {
  const payload = parseAccessDenied(input);
  if (!payload?.code) return null;

  const requiredPlan = payload.min_plan || payload.recommended_plan || extras.requiredPlan;
  const fromFeature = resourceFromFeature(payload.feature);
  const base = {
    resourceName: extras.resourceName,
    resourceId: extras.resourceId,
    requiredPlan,
    currentPlan: extras.currentPlan,
    sourcePage: extras.sourcePage,
    returnUrl: extras.returnUrl,
    limit: payload.limit,
    current: payload.current,
  };
  if (payload.code === "QUOTA_EXCEEDED") {
    base.current = payload.used_bytes ?? payload.current;
    base.limit = payload.limit_bytes ?? payload.limit;
  }

  if (AUTH_CODES.has(payload.code)) {
    return { ...base, reason: "anonymous", resourceType: extras.resourceType || fromFeature };
  }
  if (ANON_LIMIT_CODES.has(payload.code)) {
    return {
      ...base,
      reason: "anonymous",
      resourceType: extras.resourceType || LIMIT_CODES[payload.code] || fromFeature,
    };
  }
  if (payload.code === "CONTENT_ACCESS_DENIED") {
    return {
      ...base,
      reason: extras.reason || "insufficient_plan",
      resourceType: extras.resourceType || fromFeature,
    };
  }
  if (FEATURE_CODES[payload.code]) {
    return {
      ...base,
      reason: "feature_not_in_plan",
      resourceType: extras.resourceType || FEATURE_CODES[payload.code],
    };
  }
  if (LIMIT_CODES[payload.code]) {
    return {
      ...base,
      reason: "limit_reached",
      resourceType: extras.resourceType || LIMIT_CODES[payload.code],
    };
  }
  // Только явный флаг с бэкенда AccessDenied — не любой { code: "..." }
  // (иначе конфликт слота в расписании выглядит как «нужен другой тариф»).
  if (payload.upgrade_required) {
    return {
      ...base,
      reason: extras.reason || "insufficient_plan",
      resourceType: extras.resourceType || fromFeature,
    };
  }
  return null;
}

type Copy = {
  title: string;
  text: string;
  primary: string;
  secondary: string;
  eyebrow?: string;
};

function resourceNoun(type: AccessResourceType) {
  switch (type) {
    case "lesson":
      return "готовый урок";
    case "interesting":
      return "материал";
    case "interactive":
      return "интерактив";
    case "variant":
      return "генератор вариантов";
    case "workbook":
      return "рабочие тетради";
    case "schedule":
      return "расписание";
    case "student_booking":
      return "запись учеников по ссылке";
    case "ai":
      return "эта возможность";
    case "students":
      return "ученики";
    case "groups":
      return "группы";
    case "feature":
      return "эта возможность";
    case "teacher_tasks":
      return "личный банк задач";
    case "teacher_task_copies":
      return "копирование из общего банка";
    case "teacher_task_attachments":
      return "файлы к задачам";
    case "storage":
      return "хранилище";
    default:
      return "этот материал";
  }
}

export function accessGateCopy(
  ctx: AccessGateContext,
  options: { requiredPlanName?: string; authenticated?: boolean } = {},
): Copy {
  const noun = resourceNoun(ctx.resourceType);
  const planName = options.requiredPlanName;

  if (ctx.reason === "anonymous") {
    if (ctx.resourceType === "teacher_tasks" || ctx.resourceType === "teacher_task_copies") {
      return {
        eyebrow: "Личный банк задач",
        title: "Нужна регистрация",
        text: "Создавайте свои задания, копируйте из общего банка и собирайте варианты.\n\nЗарегистрируйтесь бесплатно — после входа банк сразу доступен, а лимиты зависят от тарифа.",
        primary: "Зарегистрироваться бесплатно",
        secondary: "Уже есть аккаунт? Войти",
      };
    }
    const paid = Boolean(ctx.requiredPlan && ctx.requiredPlan !== "start");
    if (ctx.resourceType === "variant" || ctx.resourceType === "workbook") {
      return {
        eyebrow: "Бесплатный доступ",
        title: "Нужна регистрация",
        text: `Лимит без регистрации исчерпан. Создайте аккаунт, чтобы сохранить этот вариант и продолжить работу с заданиями.`,
        primary: "Зарегистрироваться бесплатно",
        secondary: "Уже есть аккаунт? Войти",
      };
    }
    return {
      eyebrow: "Бесплатный доступ",
      title: paid ? "Нужна регистрация" : "Этот материал доступен после регистрации",
      text: paid
        ? `Зарегистрируйтесь, чтобы увидеть доступные варианты доступа к ${noun === "этот материал" ? "этому материалу" : noun}.`
        : `Создайте бесплатный аккаунт, чтобы открыть доступные материалы и возможности платформы.`,
      primary: "Зарегистрироваться бесплатно",
      secondary: "Уже есть аккаунт? Войти",
    };
  }

  if (ctx.reason === "limit_reached") {
    if (ctx.resourceType === "teacher_tasks") {
      const used = ctx.current;
      const cap = ctx.limit;
      const over = used != null && cap != null && used > cap;
      return {
        title: over ? "Создание новых задач недоступно" : "Ваш банк задач заполнен",
        text: over
          ? `В вашем банке ${used} задач. Текущий тариф позволяет хранить до ${cap} новых задач. Существующие материалы сохранены.`
          : `Вы использовали все ${cap ?? ""} мест в личном банке задач.\n\nНа тарифе «${planName || "Учитель"}» можно хранить больше задач, добавлять файлы и без ограничений копировать задания из общего банка.`,
        primary: "Посмотреть тарифы",
        secondary: "Не сейчас",
      };
    }
    if (ctx.resourceType === "teacher_task_copies") {
      return {
        title: "Лимит копирования исчерпан",
        text: `В этом месяце вы уже скопировали ${ctx.limit ?? 5} задач из общего банка.\n\nСоздавать собственные задачи вручную можно, пока не достигнут общий лимит банка.`,
        primary: planName ? `Перейти на тариф «${planName}»` : "Посмотреть тарифы",
        secondary: "Закрыть",
      };
    }
    if (ctx.resourceType === "storage") {
      const usedLabel = formatStorageBytes(ctx.current);
      const limitLabel = formatStorageBytes(ctx.limit);
      return {
        title: "Недостаточно места в хранилище",
        text:
          usedLabel && limitLabel
            ? `Использовано:\n${usedLabel} из ${limitLabel}`
            : "Удалите ненужные файлы или выберите тариф с большим хранилищем.",
        primary: "Посмотреть тарифы",
        secondary: "Закрыть",
      };
    }
    if (ctx.resourceType === "students" || ctx.resourceType === "groups") {
      return {
        title: "Чтобы вести больше учеников",
        text: "Чтобы использовать эту возможность для большего количества учеников, нужен соответствующий тариф.",
        primary: "Сравнить тарифы",
        secondary: "Закрыть",
      };
    }
    if (ctx.resourceType === "variant" || ctx.resourceType === "workbook") {
      const limitLabel = ctx.limit != null ? ` На вашем тарифе доступно ${ctx.limit}.` : "";
      return {
        title: "Продолжить работу с вариантами",
        text: `Вы создали вариант.${limitLabel} Чтобы собирать больше, нужен тариф с большим лимитом.`,
        primary: "Сравнить тарифы",
        secondary: "Закрыть",
      };
    }
    return {
      title: "Лимит на этот месяц использован",
      text: "Вы можете продолжить в следующем расчётном периоде или выбрать тариф с большим лимитом.",
      primary: "Сравнить тарифы",
      secondary: "Закрыть",
    };
  }

  if (ctx.resourceType === "student_booking") {
    const teacherName = planName || "Учитель";
    return {
      title: "Запись учеников по ссылке",
      text:
        "Отметьте свободное время в календаре и отправьте ученикам ссылку — они сами выберут удобный слот.\n\n" +
        `Доступно на тарифе «${teacherName}».`,
      primary: `Перейти на тариф «${teacherName}»`,
      secondary: "Не сейчас",
    };
  }

  if (ctx.reason === "feature_not_in_plan") {
    if (ctx.resourceType === "teacher_task_attachments") {
      const teacherName = planName || "Учитель";
      return {
        title: "Файлы к задачам",
        text: `Прикрепляйте PDF, документы и дополнительные материалы к своим заданиям на тарифе «${teacherName}».`,
        primary: "Посмотреть тарифы",
        secondary: "Закрыть",
      };
    }
    return {
      title: "Эта функция недоступна на вашем тарифе",
      text: planName
        ? `Доступно с тарифа «${planName}». Эта возможность не входит в ваш текущий тариф.`
        : "Эта возможность не входит в ваш текущий тариф.",
      primary: "Посмотреть тарифы",
      secondary: "Не сейчас",
    };
  }

  const titleByType: Partial<Record<AccessResourceType, string>> = {
    lesson: "Готовый урок доступен на другом тарифе",
    interesting: "Материал доступен на другом тарифе",
    interactive: "Этот интерактив недоступен на вашем тарифе",
    material: "Материал доступен на другом тарифе",
  };

  return {
    title: titleByType[ctx.resourceType] || "Доступно на другом тарифе",
    text: planName
      ? `Доступно с тарифа «${planName}». Эта возможность не входит в ваш текущий тариф.`
      : "Эта возможность не входит в ваш текущий тариф.",
    primary: "Посмотреть тарифы",
    secondary: "Не сейчас",
  };
}

export function isCatalogLocked(item: { access?: { allowed?: boolean; can_view?: boolean } | null } | null | undefined) {
  if (!item?.access) return false;
  if (typeof item.access.can_view === "boolean") return item.access.can_view === false;
  if (typeof item.access.allowed !== "boolean") return false;
  return item.access.allowed === false;
}
