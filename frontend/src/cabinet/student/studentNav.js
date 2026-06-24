/** MVP навигация ученика: 4 вкладки */

export const STUDENT_NAV = [
  { id: "home",        label: "Главная",  path: "/cabinet/student",             icon: "home"     },
  { id: "lessons",     label: "Занятия",  path: "/cabinet/student/lessons",      icon: "lessons"  },
  { id: "assignments", label: "Задания",  path: "/cabinet/student/assignments",  icon: "check"    },
  { id: "profile",     label: "Профиль",  path: "/cabinet/student/profile",      icon: "settings" },
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
  for (const item of STUDENT_NAV) {
    if (item.id !== "home" && (pathname === item.path || pathname.startsWith(`${item.path}/`))) {
      return item.label;
    }
  }
  return "Кабинет";
}
