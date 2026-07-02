import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { displayName } from "../pages/CabinetAuthPage";
import { fetchCabinetSession, logoutCabinet } from "../utils/cabinetAuth";
import CabinetIcon from "./CabinetIcons";
import {
  CABINET_MOBILE_NAV,
  CABINET_NAV,
  getCabinetSectionTitle,
  isCabinetMobileNavActive,
  isCabinetNavActive,
} from "./cabinetNav";
import { CabinetCallProvider } from "./CabinetCallContext";
import CabinetGlobalSearch from "./components/CabinetGlobalSearch";
import CabinetNotificationsBell from "./components/CabinetNotificationsBell";
import "../styles/cabinet-dashboard.css";
import "../styles/cabinet-mobile-system.css";

const PAGE_TITLE = "Кабинет учителя — Цифровой поток";

function SoonBadge() {
  return <span className="cabinet-soon-badge">скоро</span>;
}

function NavSidebarItem({ item, active }) {
  const className = [
    "cabinet-nav-item",
    active && !item.soon ? "active" : "",
    active && item.soon ? "cabinet-nav-item--soon-active" : "",
    item.soon ? "cabinet-nav-item--soon" : "",
    item.disabled ? "cabinet-nav-item--disabled" : "",
  ].filter(Boolean).join(" ");

  const content = (
    <>
      <span className="cabinet-nav-item__icon">
        <CabinetIcon name={item.icon} />
        {item.soon ? <span className="cabinet-nav-soon-dot" aria-hidden="true" /> : null}
      </span>
      <span className="cabinet-nav-item__label">{item.label}</span>
      {item.soon ? (
        <span className="cabinet-nav-item__soon">
          <SoonBadge />
        </span>
      ) : null}
    </>
  );

  if (item.disabled) {
    return (
      <span className={className} aria-label={item.label} aria-disabled="true" title="Скоро">
        {content}
      </span>
    );
  }

  return (
    <Link to={item.path} className={className} aria-label={item.label}>
      {content}
    </Link>
  );
}

export default function CabinetLayout() {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => { document.title = PAGE_TITLE; }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((d) => { if (!cancelled) setUser(d?.authenticated ? d.user : null); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try { await logoutCabinet(); window.location.href = "/"; }
    catch { /* ignore */ }
    finally { setLoggingOut(false); }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f2f4ff", color: "#94A3B8", fontSize: "0.9rem" }}>
        Загрузка…
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/cabinet/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  if (user.role === "student") {
    return <Navigate to="/cabinet/student" replace />;
  }

  const isDashboard = location.pathname === "/cabinet" || location.pathname === "/cabinet/";
  const contentClass = isDashboard
    ? "cabinet-content"
    : "cabinet-content cabinet-content--page";
  const sectionTitle = getCabinetSectionTitle(location.pathname);
  const outletContext = { user, handleLogout, loggingOut };

  return (
    <CabinetCallProvider>
    <div className="cabinet-layout cb-layout">
      <aside className="cabinet-sidebar cb-layout__sidebar">
        <nav className="cabinet-nav" aria-label="Разделы кабинета">
          {CABINET_NAV.map((item) => (
            <NavSidebarItem
              key={item.id}
              item={item}
              active={isCabinetNavActive(location.pathname, item)}
            />
          ))}
        </nav>
        <div className="cabinet-sidebar-bottom">
          <button type="button" className="cabinet-nav-item" aria-label="Настройки">
            <span className="cabinet-nav-item__icon">
              <CabinetIcon name="settings" />
            </span>
            <span className="cabinet-nav-item__label">Настройки</span>
          </button>
          <div className="cabinet-user-avatar" title={displayName(user)} onClick={handleLogout}>
            {displayName(user).charAt(0).toUpperCase()}
          </div>
          <button type="button" className="cabinet-logout-btn" onClick={handleLogout} disabled={loggingOut} aria-label="Выйти">
            <CabinetIcon name="logout" />
          </button>
        </div>
      </aside>

      <main className="cabinet-main">
        <header className={`cabinet-header${isDashboard ? " cabinet-header--dashboard" : ""}`}>
          <div className="cabinet-header-title">
            <p className="cabinet-header-section">{sectionTitle}</p>
          </div>
          <div className="cabinet-header-right">
            <CabinetGlobalSearch className="cabinet-header-search--desktop" />
            <CabinetNotificationsBell />
            <button
              type="button"
              className="cabinet-header-icon-btn"
              aria-label={searchOpen ? "Закрыть поиск" : "Поиск"}
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <CabinetIcon name="search" />
            </button>
            <Link
              to="/cabinet/more"
              className="cabinet-user-avatar cabinet-header-avatar"
              title={displayName(user)}
              aria-label="Профиль и настройки"
            >
              {displayName(user).charAt(0).toUpperCase()}
            </Link>
          </div>
          {searchOpen ? (
            <CabinetGlobalSearch
              className="cabinet-header-search--mobile is-open"
              inputRef={searchInputRef}
              mobile
              onClose={() => setSearchOpen(false)}
            />
          ) : null}
        </header>

        <div className={contentClass}>
          <Outlet context={outletContext} />
        </div>
      </main>

      <nav className="cb-mobile-nav" aria-label="Мобильная навигация">
        {CABINET_MOBILE_NAV.map((item) => (
          <Link
            key={item.id}
            to={item.path}
            className={`cb-mobile-nav__item${isCabinetMobileNavActive(location.pathname, item) ? " is-active" : ""}`}
          >
            <CabinetIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
    </CabinetCallProvider>
  );
}
