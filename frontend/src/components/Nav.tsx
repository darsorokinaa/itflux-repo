import { type FormEvent, type MouseEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getActiveNavTab, GENERATOR_HASH, NAV_TABS } from "../config/navTabs";

function LogoMark() {
  const src = `${import.meta.env.BASE_URL}img/digital-flow-logo.png`;
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
  const navigate = useNavigate();
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

  const [taskQuery, setTaskQuery] = useState("");
  const [variantQuery, setVariantQuery] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(search);
    const q = params.get("q")?.trim() ?? "";
    if (pathname.startsWith("/search/tasks")) {
      setTaskQuery(q);
      setVariantQuery("");
    } else if (pathname.startsWith("/search-variant")) {
      setVariantQuery(q);
      setTaskQuery("");
    }
  }, [pathname, search]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, search, hash]);

  const onSearchSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const taskId = taskQuery.trim();
    const variantId = variantQuery.trim();
    if (variantId) {
      setMenuOpen(false);
      navigate(`/search-variant?q=${encodeURIComponent(variantId)}`);
      return;
    }
    if (taskId) {
      setMenuOpen(false);
      navigate(`/search/tasks?q=${encodeURIComponent(taskId)}`);
    }
  };

  return (
    <header className="site-header">
      <nav className="site-nav" aria-label="Основная навигация">
        <div className="site-nav__inner">
          <Link to="/" className="site-nav__brand">
            <LogoMark />
            <span className="site-nav__titles">
              <span className="brand-name">Цифровой поток</span>
              <span className="brand-sub">ОГЭ · ЕГЭ · информатика</span>
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

            <form
              className="site-nav__search"
              onSubmit={onSearchSubmit}
              aria-label="Поиск по ID"
            >
              <label className="site-nav__search-field">
                <span className="site-nav__search-label">Поиск задачи</span>
                <input
                  type="search"
                  className="site-nav__search-input"
                  placeholder="ID"
                  value={taskQuery}
                  onChange={(e) => setTaskQuery(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                />
              </label>
              <label className="site-nav__search-field">
                <span className="site-nav__search-label">Поиск варианта</span>
                <input
                  type="search"
                  className="site-nav__search-input"
                  placeholder="ID"
                  value={variantQuery}
                  onChange={(e) => setVariantQuery(e.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                />
              </label>
              <button type="submit" className="site-nav__search-btn">
                Найти
              </button>
            </form>
          </div>
        </div>
      </nav>
    </header>
  );
}
