export const CABINET_NAV_GROUPS = [
  {
    id: "overview",
    label: "Обзор",
    items: [
      { id: "home", label: "Главная", path: "/cabinet", icon: "home" },
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
      { id: "boards", label: "Интерактивные доски", path: "/cabinet/boards", icon: "board" },
      { id: "files", label: "Мои файлы", path: "/cabinet/files", icon: "folder" },
    ],
  },
  {
    id: "control",
    label: "Контроль",
    items: [
      { id: "review", label: "Проверка", path: "/cabinet/review", icon: "check" },
      { id: "journal", label: "Журнал", path: "/cabinet/journal", icon: "note" },
    ],
  },
  {
    id: "services",
    label: "Сервисы",
    items: [
      { id: "payments", label: "Оплаты", path: "/cabinet/payments", icon: "wallet" },
      // TEMP: ИИ-помощник скрыт
      // { id: "ai", label: "ИИ-помощник", path: "/cabinet/ai", icon: "spark" },
      { id: "task-bank", label: "Банк задач", path: "/tasks", icon: "tasks", accent: true, newTab: true },
    ],
  },
];

/** Плоский список для поиска активного пункта и заголовков */
export const CABINET_NAV = CABINET_NAV_GROUPS.flatMap((group) => group.items);

/** Основные пункты нижней навигации на mobile */
export const CABINET_MOBILE_NAV = [
  { id: "home", label: "Главная", path: "/cabinet", icon: "home" },
  { id: "students", label: "Ученики", path: "/cabinet/students", icon: "students" },
  { id: "schedule", label: "Расписание", path: "/cabinet/schedule", icon: "calendar" },
  { id: "review", label: "Проверка", path: "/cabinet/review", icon: "check" },
  { id: "more", label: "Ещё", path: "/cabinet/more", icon: "expand" },
];

/** Пункты внутри «Ещё» на mobile — с разделением по темам */
export const CABINET_MORE_GROUPS = [
  {
    id: "work",
    label: "Работа",
    items: [
      { id: "journal", label: "Журнал", path: "/cabinet/journal", icon: "note" },
    ],
  },
  {
    id: "content",
    label: "Материалы",
    items: [
      { id: "plans", label: "Планы уроков", path: "/cabinet/plans", icon: "plan" },
      { id: "interactives", label: "Интерактивы", path: "/cabinet/interactives", icon: "interactives" },
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
      { id: "notifications", label: "Уведомления", path: null, icon: "bell", action: "notifications" },
      // TEMP: ИИ-помощник скрыт
      // { id: "ai", label: "ИИ-помощник", path: "/cabinet/ai", icon: "spark" },
      { id: "settings", label: "Настройки", path: null, icon: "settings", action: "settings" },
    ],
  },
];

export const CABINET_MORE_ITEMS = CABINET_MORE_GROUPS.flatMap((group) => group.items);

const MORE_PATHS = CABINET_MORE_ITEMS.filter((item) => item.path).map((item) => item.path);

export function isCabinetNavActive(pathname, item) {
  const match = item.matchPath || item.path;
  if (!match) return false;
  if (match === "/cabinet") {
    return pathname === "/cabinet" || pathname === "/cabinet/";
  }
  return pathname === match || pathname.startsWith(`${match}/`);
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
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export function getCabinetSectionTitle(pathname) {
  if (pathname === "/cabinet/more") return "Ещё";
  if (pathname.startsWith("/cabinet/settings/notifications")) return "Уведомления";

  const candidates = [
    ...CABINET_MOBILE_NAV.filter((item) => item.id !== "more"),
    ...CABINET_MORE_ITEMS,
    ...CABINET_NAV,
  ];

  for (const item of candidates) {
    if (item.path && isCabinetNavActive(pathname, item)) {
      return item.label;
    }
  }

  return "Главная";
}
