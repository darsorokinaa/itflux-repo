import { useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { displayName } from "../../pages/CabinetAuthPage";
import {
  fetchCabinetSession,
  isTeacherRole,
  logoutCabinet,
} from "../../utils/cabinetAuth";
import CabinetIcon from "../CabinetIcons";
import CabinetNotificationsBell from "../components/CabinetNotificationsBell";
import ConfirmActionModal from "../components/ConfirmActionModal";
import {
  STUDENT_MOBILE_NAV,
  STUDENT_NAV,
  getStudentSectionTitle,
  isStudentMobileNavActive,
  isStudentNavActive,
} from "./studentNav";
import "../../styles/cabinet-dashboard.css";
import "../../styles/cabinet-mobile-system.css";
import "./styles/student-cabinet.css";

const PAGE_TITLE = "Кабинет ученика — Цифровой поток";

function NavSidebarItem({ item, active }) {
  return (
    <Link
      to={item.path}
      className={`cabinet-nav-item${active ? " active" : ""}`}
      aria-label={item.label}
    >
      <span className="cabinet-nav-item__icon">
        <CabinetIcon name={item.icon} />
      </span>
      <span className="cabinet-nav-item__label">{item.label}</span>
    </Link>
  );
}

export default function StudentCabinetLayout() {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);

  useEffect(() => { document.title = PAGE_TITLE; }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((d) => { if (!cancelled) setUser(d?.authenticated ? d.user : null); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try { await logoutCabinet(); window.location.href = "/"; }
    catch { /* ignore */ }
    finally { setLoggingOut(false); setLogoutConfirm(false); }
  };

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

  if (isTeacherRole(user)) {
    return <Navigate to="/cabinet" replace />;
  }

  const isDashboard  = location.pathname === "/cabinet/student" || location.pathname === "/cabinet/student/";
  const contentClass = isDashboard ? "cabinet-content" : "cabinet-content cabinet-content--page";
  const isPlayPage   = /^\/cabinet\/student\/interactives\/\d+\/play$/.test(location.pathname);

  if (isPlayPage) return <Outlet />;

  const outletContext = { user, handleLogout, loggingOut };

  return (
    <div className="cabinet-layout st-layout">
      {/* Sidebar — visible only on desktop */}
      <aside className="cabinet-sidebar">
        <nav className="cabinet-nav" aria-label="Разделы кабинета ученика">
          {STUDENT_NAV.map((item) => (
            <NavSidebarItem
              key={item.id}
              item={item}
              active={isStudentNavActive(location.pathname, item)}
            />
          ))}
        </nav>
        <div className="cabinet-sidebar-bottom">
          <Link
            to="/cabinet/student/profile"
            className="cabinet-user-avatar"
            title={displayName(user)}
            aria-label="Профиль"
          >
            {displayName(user).charAt(0).toUpperCase()}
          </Link>
          <button
            type="button"
            className="cabinet-logout-btn"
            onClick={() => setLogoutConfirm(true)}
            disabled={loggingOut}
            aria-label="Выйти"
          >
            <CabinetIcon name="logout" />
          </button>
        </div>
      </aside>

      <main className="cabinet-main">
        <header className="cabinet-header cabinet-header--student">
          <div className="cabinet-header-title">
            <h1 className="cabinet-header-section">{getStudentSectionTitle(location.pathname)}</h1>
          </div>
          <div className="cabinet-header-right">
            <CabinetNotificationsBell studentMode />
            <Link
              to="/cabinet/student/profile"
              className="cabinet-user-avatar cabinet-header-avatar"
              title={displayName(user)}
              aria-label="Профиль"
            >
              {displayName(user).charAt(0).toUpperCase()}
            </Link>
          </div>
        </header>

        <div className={contentClass}>
          <Outlet context={outletContext} />
        </div>
      </main>

      {/* Mobile bottom navigation — 5 tabs */}
      <nav className="cb-mobile-nav st-mobile-nav" aria-label="Навигация">
        {STUDENT_MOBILE_NAV.map((item) => (
          <Link
            key={item.id}
            to={item.path}
            className={`cb-mobile-nav__item st-mobile-nav__item${isStudentMobileNavActive(location.pathname, item) ? " is-active" : ""}`}
          >
            <CabinetIcon name={item.icon} />
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
  );
}
