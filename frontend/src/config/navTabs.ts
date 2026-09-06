export type NavTabKey = "tasks" | "my-tasks" | "generator" | "lessons" | "interesting" | "teachers";

export type NavTabDef = {
  key: NavTabKey;
  label: string;
  to?: string;
  soon?: boolean;
  badge?: string;
  disabled?: boolean;
  teacherOnly?: boolean;
};

export const NAV_TABS: ReadonlyArray<NavTabDef> = [
  { key: "tasks", label: "Все задачи", to: "/tasks" },
  { key: "my-tasks", label: "Мой банк задач", to: "/tasks/my" },
  { key: "generator", label: "Генератор вариантов", to: "/generator" },
  { key: "lessons", label: "Готовые уроки", to: "/lessons" },
  { key: "interesting", label: "Интересное", to: "/interesting" },
  { key: "teachers", label: "Сообщество учителей", to: "/teachers" },
];

/** Какая вкладка подсвечена на текущем пути. */
export function getActiveNavTab(
  pathname: string
): NavTabKey | null {
  const p = (pathname || "").replace(/\/+$/, "") || "/";
  if (p === "/tasks/my" || p.startsWith("/tasks/my/")) {
    return "my-tasks";
  }
  if (p === "/tasks") {
    return "tasks";
  }
  if (p === "/generator" || p === "/subject" || p.startsWith("/subject/")) {
    return "generator";
  }
  if (p === "/lessons" || p.startsWith("/lessons/")) {
    return "lessons";
  }
  if (p === "/interesting" || p.startsWith("/interesting/")) {
    return "interesting";
  }
  if (p === "/teachers") {
    return "teachers";
  }
  return null;
}
