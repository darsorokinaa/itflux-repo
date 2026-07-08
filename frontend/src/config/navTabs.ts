export type NavTabKey = "tasks" | "generator" | "lessons" | "teachers";

export type NavTabDef = {
  key: NavTabKey;
  label: string;
  to?: string;
  soon?: boolean;
  badge?: string;
  disabled?: boolean;
};

export const NAV_TABS: ReadonlyArray<NavTabDef> = [
  { key: "tasks", label: "Все задачи", to: "/tasks" },
  { key: "generator", label: "Генератор вариантов", to: "/generator" },
  { key: "lessons", label: "Готовые уроки", to: "/lessons" },
  { key: "teachers", label: "Для учителей", to: "/teachers" },
];

/** Какая вкладка подсвечена на текущем пути. */
export function getActiveNavTab(
  pathname: string
): NavTabKey | null {
  const p = (pathname || "").replace(/\/+$/, "") || "/";
  if (p === "/tasks") {
    return "tasks";
  }
  if (p === "/generator" || p === "/subject" || p.startsWith("/subject/")) {
    return "generator";
  }
  if (p === "/lessons" || p.startsWith("/lessons/")) {
    return "lessons";
  }
  if (p === "/teachers") {
    return "teachers";
  }
  return null;
}
