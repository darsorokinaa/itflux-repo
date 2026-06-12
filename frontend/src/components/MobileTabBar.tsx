import { type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { GENERATOR_HASH } from "../config/navTabs";

type TabKey = "home" | "lessons" | "tasks" | "generator";

type IconProps = { className?: string };

function IconHome({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

function IconLessons({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5a1 1 0 0 1 1-1h5a2.5 2.5 0 0 1 2 1 2.5 2.5 0 0 1 2-1h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-5.5a2 2 0 0 0-2 2 2 2 0 0 0-2-2H5a1 1 0 0 1-1-1Z" />
      <path d="M12 5v15" />
    </svg>
  );
}

function IconTasks({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.5 6 1.5 1.5L8 4.5" />
      <path d="m3.5 13 1.5 1.5L8 11.5" />
      <path d="m3.5 20 1.5 1.5L8 18.5" />
      <path d="M11 6h10" />
      <path d="M11 13h10" />
      <path d="M11 20h10" />
    </svg>
  );
}

function IconGenerator({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z" />
      <path d="M18.5 15.5 19.4 18l2.5.9-2.5.9-.9 2.5-.9-2.5L15 18l2.6-.9Z" />
    </svg>
  );
}

type TabDef = {
  key: TabKey;
  label: string;
  to: string;
  Icon: (p: IconProps) => JSX.Element;
};

const TABS: ReadonlyArray<TabDef> = [
  { key: "home", label: "Главная", to: "/", Icon: IconHome },
  { key: "lessons", label: "Уроки", to: "/lessons", Icon: IconLessons },
  { key: "tasks", label: "Задачи", to: "/tasks", Icon: IconTasks },
  { key: "generator", label: "Генератор", to: `/#${GENERATOR_HASH}`, Icon: IconGenerator },
];

function getActiveTab(pathname: string, hash: string): TabKey | null {
  const p = (pathname || "").replace(/\/+$/, "") || "/";
  if (p === "/lessons" || p.startsWith("/lessons/")) return "lessons";
  if (p === "/tasks" || p.startsWith("/subject/")) return "tasks";
  if (p === "/" && hash === `#${GENERATOR_HASH}`) return "generator";
  if (p === "/") return "home";
  return null;
}

/**
 * Нижняя навигация для мобильных. Видна только ≤ планшета (CSS), desktop не затрагивает.
 * Пункты: Главная · Уроки · Задачи · Генератор. Учитывает safe-area iOS.
 */
export default function MobileTabBar() {
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  const active = getActiveTab(pathname, hash);

  const onGeneratorClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (pathname === "/") {
      e.preventDefault();
      const el = document.getElementById(GENERATOR_HASH);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState(null, "", `/#${GENERATOR_HASH}`);
    }
  };

  return (
    <nav className="mobile-tabbar" aria-label="Мобильная навигация">
      <ul className="mobile-tabbar__list">
        {TABS.map(({ key, label, to, Icon }) => {
          const isActive = active === key;
          return (
            <li key={key} className="mobile-tabbar__item">
              <Link
                to={to}
                className={`mobile-tabbar__link${isActive ? " is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                aria-label={label}
                onClick={key === "generator" ? onGeneratorClick : undefined}
              >
                <span className="mobile-tabbar__icon" aria-hidden="true">
                  <Icon className="mobile-tabbar__icon-svg" />
                </span>
                <span className="mobile-tabbar__label">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
