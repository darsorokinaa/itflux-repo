import { WORKSHEETS_CONSTRUCTOR_ENABLED } from "./featureFlags";

const worksheetsNavItem = {
  id: "worksheets",
  label: "Конструктор материалов",
  path: "/cabinet/worksheets",
  icon: "worksheet",
  soon: !WORKSHEETS_CONSTRUCTOR_ENABLED,
};

export const CABINET_NAV_GROUPS = [
  {
    id: "overview",
    label: "Обзор",
    items: [
      { id: "home", label: "Главная", path: "/cabinet", icon: "home" },
      { id: "messages", label: "Сообщения", path: "/cabinet/messages", icon: "message" },
    ],
  },
  {
    id: "students",
    label: "Ученики",
    items: [
      { id: "students", label: "Ученики", path: "/cabinet/students", icon: "students" },
      { id: "schedule", label: "Календарь", path: "/cabinet/schedule", icon: "calendar" },
    ],
  },
  {
    id: "teaching",
    label: "Обучение",
    items: [
      { id: "plans", label: "Планы уроков", path: "/cabinet/plans", icon: "plan" },
      { id: "interactives", label: "Интерактивы", path: "/cabinet/interactives", icon: "interactives" },
      worksheetsNavItem,
      { id: "boards", label: "Интерактивные доски", path: "/cabinet/boards", icon: "board" },
      { id: "files", label: "Мои файлы", path: "/cabinet/files", icon: "folder" },
    ],
  },
  {
    id: "control",
    label: "Контроль",
    items: [
      { id: "review", label: "Домашние задания", path: "/cabinet/review", icon: "check" },
      { id: "my-variants", label: "Мои варианты", path: "/cabinet/my-variants", icon: "quiz" },
      { id: "journal", label: "Журнал", path: "/cabinet/journal", icon: "note" },
    ],
  },
  {
    id: "services",
    label: "Сервисы",
    items: [
      { id: "payments", label: "Оплаты", path: "/cabinet/payments", icon: "wallet" },
      { id: "task-bank", label: "Банк задач", path: "/tasks", icon: "tasks", accent: true },
      { id: "my-task-bank", label: "Мой банк задач", path: "/tasks/my", icon: "cards" },
    ],
  },
];

/** Плоский список для поиска активного пункта и заголовков */
export const CABINET_NAV = CABINET_NAV_GROUPS.flatMap((group) => group.items);

/** Основные пункты нижней навигации на mobile */
export const CABINET_MOBILE_NAV = [
  { id: "home", label: "Главная", path: "/cabinet", icon: "home" },
  { id: "students", label: "Ученики", path: "/cabinet/students", icon: "students" },
  { id: "schedule", label: "Расписание", path: "/cabinet/schedule", icon: "calendar", featured: true },
  { id: "review", label: "ДЗ", path: "/cabinet/review", icon: "check" },
  { id: "more", label: "Ещё", path: "/cabinet/more", icon: "expand" },
];

/** Пункты внутри «Ещё» на mobile — с разделением по темам */
export const CABINET_MORE_GROUPS = [
  {
    id: "work",
    label: "Работа",
    items: [
      { id: "my-variants", label: "Мои варианты", path: "/cabinet/my-variants", icon: "quiz" },
      { id: "journal", label: "Журнал", path: "/cabinet/journal", icon: "note" },
    ],
  },
  {
    id: "content",
    label: "Материалы",
    items: [
      { id: "plans", label: "Планы уроков", path: "/cabinet/plans", icon: "plan" },
      { id: "library", label: "Библиотека", path: "/cabinet/library", icon: "lessons" },
      { id: "my-task-bank", label: "Мой банк задач", path: "/tasks/my", icon: "cards" },
      { id: "interactives", label: "Интерактивы", path: "/cabinet/interactives", icon: "interactives" },
      worksheetsNavItem,
      { id: "boards", label: "Интерактивные доски", path: "/cabinet/boards", icon: "board" },
      { id: "files", label: "Мои файлы", path: "/cabinet/files", icon: "folder" },
    ],
  },
  {
    id: "finance",
    label: "Финансы",
    items: [
      { id: "payments", label: "Оплаты", path: "/cabinet/payments", icon: "wallet" },
    ],
  },
  {
    id: "account",
    label: "Аккаунт",
    items: [
      { id: "messages", label: "Сообщения", path: "/cabinet/messages", icon: "message" },
      { id: "notifications", label: "Уведомления", path: null, icon: "bell", action: "notifications" },
      { id: "appearance", label: "Оформление", path: null, icon: "spark", action: "appearance" },
      { id: "settings", label: "Настройки", path: null, icon: "settings", action: "settings" },
    ],
  },
];

export const CABINET_MORE_ITEMS = CABINET_MORE_GROUPS.flatMap((group) => group.items);

const MORE_PATHS = CABINET_MORE_ITEMS.filter((item) => item.path).map((item) => item.path);

function navPathMatches(pathname, match) {
  if (!match) return false;
  if (match === "/cabinet") {
    return pathname === "/cabinet" || pathname === "/cabinet/";
  }
  return pathname === match || pathname.startsWith(`${match}/`);
}

/** r49: подсвечиваем только самый точный пункт (/tasks/my не подсвечивает и «Банк задач» /tasks). */
export function isCabinetNavActive(pathname, item) {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  const match = item.matchPath || item.path;
  if (!navPathMatches(path, match)) return false;
  const all = [...CABINET_NAV, ...CABINET_MORE_ITEMS];
  return !all.some((other) => {
    const om = other.matchPath || other.path;
    return om && om !== match && om.length > match.length && navPathMatches(path, om);
  });
}

export function isCabinetMobileNavActive(pathname, item) {
  if (item.id === "home") {
    return pathname === "/cabinet" || pathname === "/cabinet/";
  }
  if (item.id === "more") {
    if (pathname === "/cabinet/more") return true;
    return MORE_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
  }
  return isCabinetNavActive(pathname, item);
}

export function getCabinetSectionTitle(pathname) {
  if (pathname === "/cabinet/more") return "Ещё";
  if (pathname.startsWith("/cabinet/settings/notifications")) return "Настройки уведомлений";
  if (pathname.startsWith("/cabinet/messages")) return "Сообщения";
  if (pathname.startsWith("/cabinet/library")) return "Библиотека";
  if (pathname.startsWith("/cabinet/upgrade")) return "Подписка и оплата";
  if (pathname.startsWith("/cabinet/homework/")) return "Редактировать ДЗ";
  if (pathname.startsWith("/cabinet/review/")) return "Домашние задания";
  if (pathname.startsWith("/cabinet/journal/lesson/")) return "Итоги урока";
  if (pathname.startsWith("/cabinet/journal/analytics")) return "Сводка";
  if (pathname.startsWith("/cabinet/plans/") && pathname.includes("/edit")) return "Редактирование плана";
  if (pathname.startsWith("/cabinet/plans/new")) return "Новый план";
  if (/\/cabinet\/plans\/[^/]+$/.test(pathname)) return "План занятий";
  if (pathname.startsWith("/cabinet/worksheets")) return "Конструктор материалов";
  if (pathname.startsWith("/cabinet/interactives/new")) return "Создать интерактив";
  if (pathname.startsWith("/cabinet/interactives/")) return "Интерактив";
  if (pathname.startsWith("/cabinet/variant-themes")) return "Темы вариантов";
  if (pathname.startsWith("/cabinet/live-variants") || pathname.startsWith("/cabinet/my-variants")) return "Мои варианты";

  // Desktop-навигация приоритетнее mobile (там другие подписи, напр. «Расписание» vs «Календарь»).
  const candidates = [
    ...CABINET_NAV,
    ...CABINET_MORE_ITEMS,
    ...CABINET_MOBILE_NAV.filter((item) => item.id !== "more"),
  ];

  for (const item of candidates) {
    if (item.path && isCabinetNavActive(pathname, item)) {
      return item.label;
    }
  }

  return "Главная";
}
