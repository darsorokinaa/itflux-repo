import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { displayName } from "../../pages/CabinetAuthPage";
import {
  ensureCabinetPushSubscription,
  fetchCabinetSession,
  logoutCabinetAndDetachPush,
} from "../../utils/cabinetAuth";
import CabinetIcon from "../CabinetIcons";
import CabinetNotificationsBell from "../components/CabinetNotificationsBell";
import ConfirmActionModal from "../components/ConfirmActionModal";
import { UserAvatarMark } from "../components/ProfileAvatarEditor";
import PwaEnableNotificationsPrompt from "../pwa/PwaEnableNotificationsPrompt";
import PwaInstallPrompt from "../pwa/PwaInstallPrompt";
import {
  PARENT_MOBILE_NAV,
  PARENT_NAV,
  getParentSectionTitle,
  isParentMobileNavActive,
  isParentNavActive,
} from "../parent/parentNav";
import { PageTitleProvider } from "../hooks/usePageTitle";
import "../../styles/cabinet-dashboard.css";
import "../student/styles/student-cabinet.css";
import "../../styles/cabinet-mobile-system.css";
import "../styles/parent-cabinet.css";

function formatNavCount(count) {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

function NavSidebarItem({ item, active, badgeCount = 0 }) {
  const countLabel = formatNavCount(badgeCount);
  const ariaLabel = countLabel ? `${item.label}, ${countLabel}` : item.label;
  return (
    <Link
      to={item.path}
      className={`cabinet-nav-item${active ? " active" : ""}`}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
    >
      <span className="cabinet-nav-item__icon">
        <CabinetIcon name={item.icon} />
        {countLabel ? (
          <span className="cabinet-nav-item__badge cabinet-nav-item__badge--icon" aria-hidden="true">
            {countLabel}
          </span>
        ) : null}
      </span>
      <span className="cabinet-nav-item__label">{item.label}</span>
      {countLabel ? (
        <span className="cabinet-nav-item__badge cabinet-nav-item__badge--label" aria-hidden="true">
          {countLabel}
        </span>
      ) : null}
    </Link>
  );
}

export default function ParentCabinetPage() {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [isMobileShell, setIsMobileShell] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => {
      setIsMobileShell(mq.matches);
      if (!mq.matches) setNavOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((d) => { if (!cancelled) setUser(d?.authenticated ? d.user : null); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    ensureCabinetPushSubscription().catch(() => null);
    return undefined;
  }, [user]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutCabinetAndDetachPush();
    } catch {
      /* ignore */
    } finally {
      setLogoutConfirm(false);
      window.location.href = "/";
    }
  };

  const refreshUser = useCallback(async () => {
    try {
      const d = await fetchCabinetSession();
      setUser(d?.authenticated ? d.user : null);
    } catch {
      /* ignore */
    }
  }, []);

  if (loading) {
    return <div className="st-loading-screen">Загрузка…</div>;
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

  if (user.role !== "parent") {
    return <Navigate to={user.role === "student" ? "/cabinet/student" : "/cabinet"} replace />;
  }

  const isDashboard = location.pathname === "/cabinet/parent" || location.pathname === "/cabinet/parent/";
  const contentClass = isDashboard ? "cabinet-content" : "cabinet-content cabinet-content--page";
  const sectionTitle = getParentSectionTitle(location.pathname);
  const outletContext = { user, handleLogout, loggingOut, refreshUser };

  return (
    <PageTitleProvider defaultTitle={sectionTitle}>
    <div className={`cabinet-layout st-layout${navOpen ? " is-nav-open" : ""}`}>
      {navOpen ? (
        <button
          type="button"
          className="cabinet-nav-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside
        className={`cabinet-sidebar${navOpen ? " is-open" : ""}`}
        id="parent-sidebar-nav"
        aria-hidden={isMobileShell ? !navOpen : undefined}
        inert={isMobileShell && !navOpen ? true : undefined}
      >
        <div className="cabinet-sidebar__drawer-head">
          <p className="cabinet-sidebar__drawer-title">Меню</p>
          <button
            type="button"
            className="cabinet-sidebar__drawer-close"
            aria-label="Закрыть меню"
            onClick={() => setNavOpen(false)}
          >
            <CabinetIcon name="close" />
          </button>
        </div>
        <nav className="cabinet-nav" aria-label="Разделы кабинета родителя">
          {PARENT_NAV.map((item) => (
            <NavSidebarItem
              key={item.id}
              item={item}
              active={isParentNavActive(location.pathname, item)}
            />
          ))}
        </nav>
        <div className="cabinet-sidebar-bottom">
          <div className="cabinet-sidebar-bottom__row">
            <div
              className={`cabinet-user-avatar${user?.avatar ? " cabinet-user-avatar--photo" : ""}`}
              title={displayName(user)}
              aria-label="Профиль"
            >
              <UserAvatarMark user={user} fallbackName={displayName(user)} />
              <span className="cabinet-sidebar-bottom__label">Профиль</span>
            </div>
            <button
              type="button"
              className="cabinet-logout-btn"
              onClick={() => setLogoutConfirm(true)}
              disabled={loggingOut}
              aria-label="Выйти"
            >
              <CabinetIcon name="logout" />
              <span className="cabinet-sidebar-bottom__label">Выйти</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="cabinet-main">
        <header className="cabinet-header cabinet-header--student">
          <div className="cabinet-header-title">
            <button
              type="button"
              className="cabinet-header-menu-btn"
              aria-label={navOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={navOpen}
              aria-controls="parent-sidebar-nav"
              onClick={() => setNavOpen((v) => !v)}
            >
              <CabinetIcon name="menu" />
            </button>
            <h1 className="cabinet-header-section">{getParentSectionTitle(location.pathname)}</h1>
          </div>
          <div className="cabinet-header-right">
            <CabinetNotificationsBell studentMode />
            <div
              className={`cabinet-user-avatar cabinet-header-avatar${user?.avatar ? " cabinet-user-avatar--photo" : ""}`}
              title={displayName(user)}
              aria-label="Профиль"
            >
              <UserAvatarMark user={user} fallbackName={displayName(user)} />
            </div>
          </div>
        </header>

        <div className={contentClass}>
          {isDashboard ? (
            <>
              <PwaInstallPrompt role="parent" />
              <PwaEnableNotificationsPrompt role="parent" />
            </>
          ) : null}
          <Outlet context={outletContext} />
        </div>
      </main>

      <nav className="cb-mobile-nav st-mobile-nav" aria-label="Навигация">
        {PARENT_MOBILE_NAV.map((item) => (
          <Link
            key={item.id}
            to={item.path}
            aria-label={item.label}
            className={`cb-mobile-nav__item st-mobile-nav__item${isParentMobileNavActive(location.pathname, item) ? " is-active" : ""}`}
          >
            <span className="cb-mobile-nav__icon-wrap">
              <CabinetIcon name={item.icon} />
            </span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <ConfirmActionModal
        open={logoutConfirm}
        title="Выйти из аккаунта?"
        text="Вы уверены, что хотите выйти?"
        confirmLabel="Выйти"
        danger
        loading={loggingOut}
        onClose={() => setLogoutConfirm(false)}
        onConfirm={handleLogout}
      />
    </div>
    </PageTitleProvider>
  );
}
