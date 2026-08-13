import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { displayName } from "../pages/CabinetAuthPage";
import { fetchCabinetSession, getCabinetHomePath } from "../utils/cabinetAuth";

type TabKey = "home" | "lessons" | "tasks" | "generator" | "cabinet";

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

function IconCabinet({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

type SessionUser = {
  role?: string;
  name?: string;
  surname?: string;
  username?: string;
  email?: string;
};

function userInitials(user: SessionUser | null): string {
  const first = (user?.name || "").trim();
  const last = (user?.surname || "").trim();
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase();
  const full = displayName(user) || "";
  const parts = String(full).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function useCabinetTab() {
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchCabinetSession()
        .then((data: { authenticated?: boolean; user?: SessionUser } | null) => {
          if (cancelled) return;
          const nextUser = data?.authenticated && data?.user ? data.user : null;
          setAuthed(!!data?.authenticated);
          setUser(nextUser);
        })
        .catch(() => {
          if (cancelled) return;
          setAuthed(false);
          setUser(null);
        });
    };

    load();
    const onFocus = () => load();
    const onVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const name = user ? displayName(user) : "";
  const href = authed ? getCabinetHomePath(user) : "/cabinet/login";
  const label = authed
    ? (user?.role === "teacher" ? `Кабинет учителя — ${name}` : `Личный кабинет — ${name}`)
    : "Личный кабинет";

  return {
    authed,
    href,
    label,
    initials: authed ? userInitials(user) : "",
  };
}

type TabDef = {
  key: Exclude<TabKey, "cabinet">;
  label: string;
  to: string;
  Icon: (p: IconProps) => JSX.Element;
};

const LEFT_TABS: ReadonlyArray<TabDef> = [
  { key: "home", label: "Главная", to: "/", Icon: IconHome },
  { key: "tasks", label: "Задачи", to: "/tasks", Icon: IconTasks },
];

const RIGHT_TABS: ReadonlyArray<TabDef> = [
  { key: "generator", label: "Генератор", to: "/generator", Icon: IconGenerator },
  { key: "lessons", label: "Уроки", to: "/lessons", Icon: IconLessons },
];

function getActiveTab(pathname: string): TabKey | null {
  const p = (pathname || "").replace(/\/+$/, "") || "/";
  if (p === "/lessons" || p.startsWith("/lessons/")) return "lessons";
  if (p === "/tasks") return "tasks";
  if (p === "/generator" || p === "/subject" || p.startsWith("/subject/")) return "generator";
  if (p === "/cabinet" || p.startsWith("/cabinet/")) return "cabinet";
  if (p === "/") return "home";
  return null;
}

function TabLink({
  tab,
  isActive,
}: {
  tab: TabDef;
  isActive: boolean;
}) {
  const { label, to, Icon } = tab;
  return (
    <li className="mobile-tabbar__item">
      <Link
        to={to}
        className={`mobile-tabbar__link${isActive ? " is-active" : ""}`}
        aria-current={isActive ? "page" : undefined}
        aria-label={label}
      >
        <span className="mobile-tabbar__icon" aria-hidden="true">
          <Icon className="mobile-tabbar__icon-svg" />
        </span>
        <span className="mobile-tabbar__label">{label}</span>
      </Link>
    </li>
  );
}

/**
 * Нижняя навигация для мобильных. Видна только ≤ планшета (CSS), desktop не затрагивает.
 * Пункты: Главная · Задачи · Личный кабинет · Генератор · Уроки. Учитывает safe-area iOS.
 */
export default function MobileTabBar() {
  const { pathname } = useLocation();
  const active = getActiveTab(pathname);
  const cabinetActive = active === "cabinet";
  const cabinet = useCabinetTab();

  return (
    <nav className="mobile-tabbar" aria-label="Мобильная навигация">
      <ul className="mobile-tabbar__list">
        {LEFT_TABS.map((tab) => (
          <TabLink key={tab.key} tab={tab} isActive={active === tab.key} />
        ))}
        <li className="mobile-tabbar__item mobile-tabbar__item--center" aria-hidden="true" />
        {RIGHT_TABS.map((tab) => (
          <TabLink key={tab.key} tab={tab} isActive={active === tab.key} />
        ))}
      </ul>
      <Link
        to={cabinet.href}
        className={`mobile-tabbar__cabinet${cabinetActive ? " is-active" : ""}${cabinet.authed ? " is-authed" : ""}`}
        aria-current={cabinetActive ? "page" : undefined}
        aria-label={cabinet.label}
        title={cabinet.label}
      >
        {cabinet.authed ? (
          <span className="mobile-tabbar__cabinet-initials" aria-hidden="true">
            {cabinet.initials}
          </span>
        ) : (
          <IconCabinet className="mobile-tabbar__cabinet-icon" />
        )}
      </Link>
    </nav>
  );
}
