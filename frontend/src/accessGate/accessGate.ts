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
  | "content";

export type AccessDeniedPayload = {
  code: string;
  message: string;
  feature?: string;
  min_plan?: string;
  recommended_plan?: string;
  upgrade_required?: boolean;
  limit?: number;
  current?: number;
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
};

const FEATURE_CODES: Record<string, AccessResourceType> = {
  SCHEDULE_REQUIRES_PAID_PLAN: "schedule",
};

const AUTH_CODES = new Set(["AUTH_REQUIRED", "auth_required"]);

export function planDisplayName(slug?: string, fallbackName?: string) {
  if (fallbackName) return fallbackName;
  if (!slug) return "";
  return PLAN_DISPLAY_NAMES[slug] || slug;
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
    upgrade_required: Boolean(source.upgrade_required ?? source.code),
    limit: typeof source.limit === "number" ? source.limit : undefined,
    current: typeof source.current === "number" ? source.current : undefined,
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
    feature === "interactive" ||
    feature === "ai" ||
    feature === "students" ||
    feature === "groups"
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
  };

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
    case "ai":
      return "ИИ-помощник";
    case "students":
      return "ученики";
    case "groups":
      return "группы";
    case "feature":
      return "эта возможность";
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
    const paid = Boolean(ctx.requiredPlan && ctx.requiredPlan !== "start");
    if (ctx.resourceType === "variant" || ctx.resourceType === "workbook") {
      return {
        eyebrow: "Бесплатный доступ",
        title: "Нужна регистрация",
        text: `Лимит без регистрации исчерпан. Создайте бесплатный аккаунт, чтобы продолжить работу с платформой.`,
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
    return {
      title: "Лимит на этот месяц использован",
      text: "Вы можете продолжить в следующем расчётном периоде или выбрать тариф с большим лимитом.",
      primary: "Сравнить тарифы",
      secondary: "Закрыть",
    };
  }

  if (ctx.reason === "feature_not_in_plan") {
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

export function isCatalogLocked(item: { access?: { allowed?: boolean } | null } | null | undefined) {
  if (!item?.access || typeof item.access.allowed !== "boolean") return false;
  return item.access.allowed === false;
}
