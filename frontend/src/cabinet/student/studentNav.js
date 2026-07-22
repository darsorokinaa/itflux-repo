/** Навигация ученика: sidebar + компактное нижнее меню */

export const STUDENT_NAV = [
  { id: "home",        label: "Главная",    path: "/cabinet/student",            icon: "home"     },
  { id: "lessons",     label: "Занятия",    path: "/cabinet/student/lessons",    icon: "lessons"  },
  { id: "assignments", label: "Задания",    path: "/cabinet/student/assignments", icon: "check"   },
  { id: "results",     label: "Результаты", path: "/cabinet/student/results",    icon: "chart"    },
  { id: "materials",   label: "Материалы",  path: "/cabinet/student/materials",  icon: "folder"   },
  { id: "files",       label: "Мои файлы",  path: "/cabinet/student/files",      icon: "folder"   },
  { id: "boards",      label: "Доски",      path: "/cabinet/student/boards",     icon: "board"    },
  { id: "profile",     label: "Профиль",    path: "/cabinet/student/profile",    icon: "settings" },
];

/** Нижнее меню — 5 вкладок; остальное в «Ещё» */
export const STUDENT_MOBILE_NAV = [
  { id: "home",        label: "Главная",    path: "/cabinet/student",            icon: "home"    },
  { id: "lessons",     label: "Занятия",    path: "/cabinet/student/lessons",    icon: "lessons" },
  { id: "assignments", label: "Задания",    path: "/cabinet/student/assignments", icon: "check"  },
  { id: "results",     label: "Результаты", path: "/cabinet/student/results",    icon: "chart"   },
  { id: "more",        label: "Ещё",        path: "/cabinet/student/more",       icon: "expand"  },
];

export const STUDENT_MORE_GROUPS = [
  {
    id: "study",
    label: "Учёба",
    items: [
      { id: "materials", label: "Материалы", path: "/cabinet/student/materials", icon: "folder" },
      { id: "files",     label: "Мои файлы", path: "/cabinet/student/files",     icon: "folder" },
      { id: "boards",    label: "Доски",     path: "/cabinet/student/boards",    icon: "board"  },
    ],
  },
  {
    id: "account",
    label: "Аккаунт",
    items: [
      { id: "profile", label: "Профиль", path: "/cabinet/student/profile", icon: "settings" },
    ],
  },
];

export const STUDENT_MORE_ITEMS = STUDENT_MORE_GROUPS.flatMap((group) => group.items);
const MORE_PATHS = STUDENT_MORE_ITEMS.map((item) => item.path);

export function isStudentNavActive(pathname, item) {
  if (item.id === "home") {
    return pathname === "/cabinet/student" || pathname === "/cabinet/student/";
  }
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export function isStudentMobileNavActive(pathname, item) {
  if (item.id === "home") {
    return pathname === "/cabinet/student" || pathname === "/cabinet/student/";
  }
  if (item.id === "more") {
    if (pathname === "/cabinet/student/more" || pathname.startsWith("/cabinet/student/more/")) {
      return true;
    }
    return MORE_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
  }
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export function getStudentSectionTitle(pathname) {
  if (pathname === "/cabinet/student" || pathname === "/cabinet/student/") return "Главная";
  if (pathname === "/cabinet/student/more" || pathname.startsWith("/cabinet/student/more/")) {
    return "Ещё";
  }
  if (pathname === "/cabinet/student/boards" || pathname.startsWith("/cabinet/student/boards/")) {
    return "Доски";
  }
  if (pathname === "/cabinet/student/results" || pathname.startsWith("/cabinet/student/results/")) {
    return "Мои результаты";
  }
  for (const item of STUDENT_NAV) {
    if (item.id !== "home" && (pathname === item.path || pathname.startsWith(`${item.path}/`))) {
      return item.label;
    }
  }
  return "Кабинет";
}
