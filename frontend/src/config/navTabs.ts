export type NavTabKey = "tasks" | "generator" | "lessons";

export type NavTabDef = {
  key: NavTabKey;
  label: string;
  to?: string;
  soon?: boolean;
  badge?: string;
  disabled?: boolean;
};

/** Якорь блока «Выберите формат подготовки» на главной (HomePage). */
export const GENERATOR_HASH = "home-levels";

export const NAV_TABS: ReadonlyArray<NavTabDef> = [
  { key: "tasks", label: "Все задачи", to: "/tasks" },
  { key: "generator", label: "Генератор вариантов", to: `/#${GENERATOR_HASH}`, badge: "бета-версия" },
  { key: "lessons", label: "Готовые уроки", to: "/lessons" },
];

/** Какая вкладка подсвечена на текущем пути. */
export function getActiveNavTab(
  pathname: string,
  hash: string = ""
): NavTabKey | null {
  const p = (pathname || "").replace(/\/+$/, "") || "/";
  if (p === "/tasks" || p.startsWith("/subject/")) {
    return "tasks";
  }
  if (p === "/" && hash === `#${GENERATOR_HASH}`) {
    return "generator";
  }
  if (p === "/lessons" || p.startsWith("/lessons/")) {
    return "lessons";
  }
  return null;
}
