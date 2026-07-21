/** MVP навигация ученика: 5 вкладок */

export const STUDENT_NAV = [
  { id: "home",        label: "Главная",   path: "/cabinet/student",              icon: "home"     },
  { id: "lessons",     label: "Занятия",   path: "/cabinet/student/lessons",       icon: "lessons"  },
  { id: "assignments", label: "Задания",   path: "/cabinet/student/assignments",   icon: "check"    },
  { id: "results",     label: "Результаты", path: "/cabinet/student/results",      icon: "chart"    },
  { id: "materials",   label: "Материалы", path: "/cabinet/student/materials",     icon: "folder"   },
  { id: "files",       label: "Мои файлы", path: "/cabinet/student/files",         icon: "folder"   },
  { id: "profile",     label: "Профиль",   path: "/cabinet/student/profile",       icon: "settings" },
];

export const STUDENT_MOBILE_NAV = STUDENT_NAV;

export function isStudentNavActive(pathname, item) {
  if (item.id === "home") {
    return pathname === "/cabinet/student" || pathname === "/cabinet/student/";
  }
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export function getStudentSectionTitle(pathname) {
  if (pathname === "/cabinet/student" || pathname === "/cabinet/student/") return "Главная";
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
