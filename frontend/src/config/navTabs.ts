export type NavTabKey = "tasks" | "generator";

export type NavTabDef = {
  key: NavTabKey;
  label: string;
  to?: string;
  soon?: boolean;
  disabled?: boolean;
};

/** Якорь блока «Выберите формат подготовки» на главной (HomePage). */
export const GENERATOR_HASH = "home-levels";

export const NAV_TABS: ReadonlyArray<NavTabDef> = [
  { key: "tasks", label: "Все задачи", to: "/tasks" },
  { key: "generator", label: "Генератор вариантов", to: `/#${GENERATOR_HASH}` },
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
  return null;
}
