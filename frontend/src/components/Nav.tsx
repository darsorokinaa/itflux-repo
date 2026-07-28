import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getActiveNavTab, NAV_TABS } from "../config/navTabs";
import TaskSearchPanel from "./TaskSearchPanel";
import { displayName } from "../pages/CabinetAuthPage";
import { fetchCabinetSession, getCabinetHomePath } from "../utils/cabinetAuth";

function pickFirstNonEmptyString(values: unknown[]) {
  for (const value of values) {
    const str = typeof value === "string" ? value.trim() : "";
    if (str) return str;
  }
  return "";
}

function readUrlField(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const candidate = value as Record<string, unknown>;
  return pickFirstNonEmptyString([candidate.url, candidate.src, candidate.href]);
}

function normalizeAvatarUrl(url: string): string {
  if (!url) return "";
  if (typeof window === "undefined") return url;
  if (url.startsWith("http://127.0.0.1:8000")) return url.replace("http://127.0.0.1:8000", "");
  if (url.startsWith("http://localhost:8000")) return url.replace("http://localhost:8000", "");
  if (url.startsWith("//")) return `${window.location.protocol}${url}`;
  return url;
}

function resolveUserAvatarUrl(user: unknown): string {
  if (!user || typeof user !== "object") return "";
  const record = user as Record<string, unknown>;
  const profile = record.profile && typeof record.profile === "object"
    ? (record.profile as Record<string, unknown>)
    : null;

  const fromTop = pickFirstNonEmptyString([
    readUrlField(record.avatar),
    record.avatar_url,
    readUrlField(record.photo),
    record.photo_url,
    readUrlField(record.image),
    record.image_url,
    record.picture,
  ]);

  const fromProfile = profile
    ? pickFirstNonEmptyString([
      readUrlField(profile.avatar),
      profile.avatar_url,
      readUrlField(profile.photo),
      profile.photo_url,
      readUrlField(profile.image),
      profile.image_url,
      profile.picture,
    ])
    : "";

  return normalizeAvatarUrl(fromTop || fromProfile);
}

function LogoMark() {
  const src = `${import.meta.env.BASE_URL}favicon.png?v=1`;
  return (
    <img
      src={src}
      alt=""
      className="site-nav__logo"
      width={40}
      height={40}
      loading="eager"
      decoding="async"
    />
  );
}

type SessionUser = {
  role?: string;
  name?: string;
  surname?: string;
  username?: string;
  email?: string;
  avatar?: string | null;
};

function CabinetNavButton({ onNavigate }: { onNavigate?: () => void }) {
  const [cabinetAuthed, setCabinetAuthed] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchCabinetSession()
        .then((data) => {
          if (cancelled) return;
          const authed = !!data?.authenticated;
          const nextUser = (authed && data?.user ? data.user : null) as SessionUser | null;
          setCabinetAuthed(authed);
          setUser(nextUser);
          setAvatarUrl(authed ? resolveUserAvatarUrl(nextUser) : "");
        })
        .catch(() => {
          if (cancelled) return;
          setCabinetAuthed(false);
          setUser(null);
          setAvatarUrl("");
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
  const initial = name ? name.charAt(0).toUpperCase() : "?";
  const isTeacher = user?.role === "teacher";
  const showAvatarMode = cabinetAuthed && (isTeacher || Boolean(avatarUrl) || Boolean(name));
  const href = cabinetAuthed ? getCabinetHomePath(user) : "/cabinet/login";
  const label = cabinetAuthed
    ? (isTeacher ? `Кабинет учителя — ${name}` : `Личный кабинет — ${name}`)
    : "Личный кабинет";

  return (
    <Link
      to={href}
      className={`cabinet-nav-button${showAvatarMode ? " cabinet-nav-button--avatar" : ""}`}
      onClick={onNavigate}
      aria-label={label}
      title={label}
    >
      <span className="cabinet-nav-button__icon" aria-hidden="true">
        {cabinetAuthed && avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="cabinet-nav-button__avatar"
            loading="lazy"
            decoding="async"
            onError={() => setAvatarUrl("")}
          />
        ) : cabinetAuthed ? (
          <span className="cabinet-nav-button__avatar-fallback cabinet-nav-button__avatar-fallback--initials">
            {initial}
          </span>
        ) : (
          <span className="cabinet-nav-button__avatar-fallback">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21a8 8 0 0 0-16 0" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </span>
        )}
      </span>
      {showAvatarMode ? (
        <span className="cabinet-nav-button__text cabinet-nav-button__text--mobile">{name || "Кабинет"}</span>
      ) : (
        <span className="cabinet-nav-button__text">Личный кабинет</span>
      )}
    </Link>
  );
}

export default function Nav() {
  const { pathname, search, hash } = useLocation();
  const active = getActiveNavTab(pathname);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, search, hash]);

  return (
    <header className="site-header">
      <nav className="site-nav" aria-label="Основная навигация">
        <div className="site-nav__inner">
          <Link to="/" className="site-nav__brand">
            <LogoMark />
            <span className="site-nav__titles">
              <span className="brand-name">Цифровой поток</span>
              <span className="brand-sub">ОГЭ · ЕГЭ · Школьная программа</span>
            </span>
          </Link>

          <button
            type="button"
            className={`site-nav__menu-btn${menuOpen ? " is-open" : ""}`}
            aria-expanded={menuOpen}
            aria-controls="site-nav-mobile-panel"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="site-nav__menu-icon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="site-nav__menu-text">Меню</span>
          </button>

          <div
            id="site-nav-mobile-panel"
            className={`site-nav__panel${menuOpen ? " is-open" : ""}`}
          >
            <div className="site-nav__tabs" role="tablist" aria-label="Разделы платформы">
              {NAV_TABS.map((tab) => {
                const isActive = active === tab.key;
                const className = [
                  "site-nav__tab",
                  isActive ? "site-nav__tab--active" : "",
                  tab.key === "teachers" ? "site-nav__tab--teachers" : "",
                  tab.disabled ? "site-nav__tab--disabled" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                if (tab.disabled) {
                  return (
                    <span
                      key={tab.key}
                      className={className}
                      role="tab"
                      aria-selected={false}
                      aria-disabled="true"
                      title="Раздел в разработке"
                    >
                      <span className="site-nav__tab-label">{tab.label}</span>
                      {tab.badge ? (
                        <span className="site-nav__tab-badge site-nav__tab-badge--beta">{tab.badge}</span>
                      ) : tab.soon ? (
                        <span className="site-nav__tab-badge">скоро</span>
                      ) : null}
                    </span>
                  );
                }

                return (
                  <Link
                    key={tab.key}
                    to={tab.to || "/"}
                    className={className}
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className="site-nav__tab-label">{tab.label}</span>
                    {tab.badge ? (
                      <span className="site-nav__tab-badge site-nav__tab-badge--beta">{tab.badge}</span>
                    ) : tab.soon ? (
                      <span className="site-nav__tab-badge">скоро</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>

            <CabinetNavButton onNavigate={() => setMenuOpen(false)} />
          </div>

          <TaskSearchPanel className="site-nav__quick-search" />
        </div>
      </nav>
    </header>
  );
}
