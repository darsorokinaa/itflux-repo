import { type MouseEvent, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getActiveNavTab, GENERATOR_HASH, NAV_TABS } from "../config/navTabs";
import {
  SUMMER_CLUB_NAV_LABEL,
  SUMMER_CLUB_SEASON_BADGE,
  SUMMER_CLUB_TAGLINE,
  SUMMER_CLUB_URL,
} from "../config/summerClub";

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

export default function Nav() {
  const { pathname, search, hash } = useLocation();
  const active = getActiveNavTab(pathname, hash);
  const [menuOpen, setMenuOpen] = useState(false);

  const scrollToGenerator = (smooth = true) => {
    const el = document.getElementById(GENERATOR_HASH);
    if (!el) return;
    el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  };

  const onGeneratorClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (pathname === "/") {
      e.preventDefault();
      scrollToGenerator(true);
      window.history.replaceState(null, "", `/#${GENERATOR_HASH}`);
    }
    setMenuOpen(false);
  };

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
              <span className="brand-sub">ОГЭ · ЕГЭ · Информатика</span>
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

                const linkProps =
                  tab.key === "generator"
                    ? { onClick: onGeneratorClick }
                    : { onClick: () => setMenuOpen(false) };

                return (
                  <Link
                    key={tab.key}
                    to={tab.to || "/"}
                    className={className}
                    role="tab"
                    aria-selected={isActive}
                    {...linkProps}
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

            {/* Главный CTA шапки — летний IT-клуб в стиле summerclub-лендинга. */}
            <a
              href={SUMMER_CLUB_URL}
              className="summer-club-nav-button"
              target="_blank"
              rel="noopener noreferrer"
            >
              {SUMMER_CLUB_NAV_LABEL}
            </a>

            {/* Мобильное меню: отдельная промо-карточка клуба вместо обычной строки. */}
            <a
              href={SUMMER_CLUB_URL}
              className="mobile-summer-club-card"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              <span className="mobile-summer-club-card__badge">{SUMMER_CLUB_SEASON_BADGE}</span>
              <strong className="mobile-summer-club-card__title">
                {SUMMER_CLUB_NAV_LABEL}
              </strong>
              <p className="mobile-summer-club-card__text">{SUMMER_CLUB_TAGLINE}</p>
              <span className="mobile-summer-club-card__button" aria-hidden="true">
                {SUMMER_CLUB_NAV_LABEL}
              </span>
            </a>
          </div>
        </div>
      </nav>
    </header>
  );
}
