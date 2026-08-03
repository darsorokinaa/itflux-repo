/** Навигация кабинета родителя — та же схема, что у ученика */

export const PARENT_NAV = [
  { id: "home", label: "Главная", path: "/cabinet/parent", icon: "home" },
  { id: "homework", label: "Домашние задания", path: "/cabinet/parent/homework", icon: "check" },
  { id: "schedule", label: "Расписание", path: "/cabinet/parent/schedule", icon: "lessons" },
  { id: "results", label: "Результаты", path: "/cabinet/parent/results", icon: "chart" },
  { id: "journal", label: "Журнал", path: "/cabinet/parent/journal", icon: "book" },
  { id: "billing", label: "Оплата", path: "/cabinet/parent/billing", icon: "wallet" },
];

/** Нижнее меню — 5 вкладок; остальное в «Ещё» */
export const PARENT_MOBILE_NAV = [
  { id: "home", label: "Главная", path: "/cabinet/parent", icon: "home" },
  { id: "homework", label: "Задания", path: "/cabinet/parent/homework", icon: "check" },
  { id: "schedule", label: "Расписание", path: "/cabinet/parent/schedule", icon: "lessons" },
  { id: "results", label: "Успех.", path: "/cabinet/parent/results", icon: "chart" },
  { id: "more", label: "Ещё", path: "/cabinet/parent/more", icon: "expand" },
];

export const PARENT_MORE_GROUPS = [
  {
    id: "study",
    label: "Учёба",
    items: [
      { id: "journal", label: "Журнал", path: "/cabinet/parent/journal", icon: "book" },
      { id: "results", label: "Результаты", path: "/cabinet/parent/results", icon: "chart" },
    ],
  },
  {
    id: "account",
    label: "Аккаунт",
    items: [
      { id: "billing", label: "Оплата", path: "/cabinet/parent/billing", icon: "wallet" },
      { id: "notifications", label: "Уведомления", path: "/cabinet/parent/settings/notifications", icon: "bell" },
    ],
  },
];

export const PARENT_MORE_ITEMS = PARENT_MORE_GROUPS.flatMap((group) => group.items);
const MORE_PATHS = PARENT_MORE_ITEMS.map((item) => item.path);

export function isParentNavActive(pathname, item) {
  if (item.id === "home") {
    return pathname === "/cabinet/parent" || pathname === "/cabinet/parent/";
  }
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export function isParentMobileNavActive(pathname, item) {
  if (item.id === "home") {
    return pathname === "/cabinet/parent" || pathname === "/cabinet/parent/";
  }
  if (item.id === "more") {
    if (pathname === "/cabinet/parent/more" || pathname.startsWith("/cabinet/parent/more/")) {
      return true;
    }
    return MORE_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
  }
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export function getParentSectionTitle(pathname) {
  if (pathname === "/cabinet/parent" || pathname === "/cabinet/parent/") return "Главная";
  if (pathname.startsWith("/cabinet/parent/settings/notifications")) return "Настройки уведомлений";
  if (pathname === "/cabinet/parent/more" || pathname.startsWith("/cabinet/parent/more/")) {
    return "Ещё";
  }
  if (pathname.startsWith("/cabinet/parent/schedule")) return "Расписание";
  if (pathname.startsWith("/cabinet/parent/homework")) return "Домашние задания";
  if (pathname.startsWith("/cabinet/parent/results")) return "Результаты";
  if (pathname.startsWith("/cabinet/parent/journal")) return "Журнал";
  if (pathname.startsWith("/cabinet/parent/billing")) return "Оплата";
  for (const item of PARENT_NAV) {
    if (item.id !== "home" && (pathname === item.path || pathname.startsWith(`${item.path}/`))) {
      return item.label;
    }
  }
  return "Кабинет";
}
