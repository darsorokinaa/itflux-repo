import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { displayName } from "../pages/CabinetAuthPage";
import { fetchCabinetSession, fetchNavCounts, logoutCabinet } from "../utils/cabinetAuth";
import CabinetIcon from "./CabinetIcons";
import {
  CABINET_MOBILE_NAV,
  CABINET_NAV_GROUPS,
  getCabinetSectionTitle,
  isCabinetMobileNavActive,
  isCabinetNavActive,
} from "./cabinetNav";
import { CabinetCallProvider } from "./CabinetCallContext";
import CabinetGlobalSearch from "./components/CabinetGlobalSearch";
import CabinetNotificationsBell from "./components/CabinetNotificationsBell";
import CabinetGuideModal from "./components/CabinetGuideModal";
import ConfirmActionModal from "./components/ConfirmActionModal";
import { useSubscription } from "./hooks/useSubscription";
import "../styles/cabinet-dashboard.css";
import "../styles/cabinet-mobile-system.css";
import "./styles/teacher-cabinet.css";

const PAGE_TITLE = "Кабинет учителя — Цифровой поток";
const GUIDE_SEEN_KEY = "cabinet-guide-seen-v1";
const GUIDE_OPEN_ON_REGISTER_KEY = "cabinet-guide-open-on-register";

function formatNavCount(count) {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

function SoonBadge() {
  return <span className="cabinet-soon-badge">скоро</span>;
}

function NavSidebarItem({ item, active, badgeCount = 0 }) {
  const className = [
    "cabinet-nav-item",
    item.accent ? "cabinet-nav-item--accent" : "",
    active && !item.soon ? "active" : "",
    active && item.soon ? "cabinet-nav-item--soon-active" : "",
    item.soon ? "cabinet-nav-item--soon" : "",
    item.disabled ? "cabinet-nav-item--disabled" : "",
  ].filter(Boolean).join(" ");

  const countLabel = formatNavCount(badgeCount);
  const ariaLabel = countLabel ? `${item.label}, ${countLabel}` : item.label;
  const badgeAccent = item.id === "review";

  const content = (
    <>
      <span className="cabinet-nav-item__icon">
        <CabinetIcon name={item.icon} />
        {item.soon ? <span className="cabinet-nav-soon-dot" aria-hidden="true" /> : null}
        {countLabel ? (
          <span
            className={`cabinet-nav-item__badge cabinet-nav-item__badge--icon${badgeAccent ? " cabinet-nav-item__badge--accent" : ""}`}
            aria-hidden="true"
          >
            {countLabel}
          </span>
        ) : null}
      </span>
      <span className="cabinet-nav-item__label">{item.label}</span>
      {item.soon ? (
        <span className="cabinet-nav-item__soon">
          <SoonBadge />
        </span>
      ) : countLabel ? (
        <span
          className={`cabinet-nav-item__badge cabinet-nav-item__badge--label${badgeAccent ? " cabinet-nav-item__badge--accent" : ""}`}
          aria-hidden="true"
        >
          {countLabel}
        </span>
      ) : null}
    </>
  );

  if (item.disabled) {
    return (
      <span className={className} aria-label={ariaLabel} aria-disabled="true" title="Скоро">
        {content}
      </span>
    );
  }

  return (
    <Link
      to={item.path}
      className={className}
      aria-label={ariaLabel}
      target={item.newTab ? "_blank" : undefined}
      rel={item.newTab ? "noopener noreferrer" : undefined}
    >
      {content}
    </Link>
  );
}

export default function CabinetLayout() {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [navCounts, setNavCounts] = useState({ students: 0, reviews: 0 });
  const searchInputRef = useRef(null);
  const subscription = useSubscription();
  const planName = subscription.currentPlan?.name || "";

  useEffect(() => { document.title = PAGE_TITLE; }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((d) => { if (!cancelled) setUser(d?.authenticated ? d.user : null); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const loadNavCounts = useCallback(async () => {
    try {
      const data = await fetchNavCounts();
      setNavCounts({
        students: Number(data?.students_count) || 0,
        reviews: Number(data?.reviews_count) || 0,
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (loading || !user || user.role === "student") return undefined;
    loadNavCounts();
    const id = setInterval(loadNavCounts, 60000);
    const onRefresh = () => loadNavCounts();
    window.addEventListener("cabinet:nav-counts-refresh", onRefresh);
    window.addEventListener("focus", onRefresh);
    return () => {
      clearInterval(id);
      window.removeEventListener("cabinet:nav-counts-refresh", onRefresh);
      window.removeEventListener("focus", onRefresh);
    };
  }, [loading, user, loadNavCounts, location.pathname]);

  useEffect(() => {
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    if (loading || !user || user.role === "student") return;
    try {
      if (window.sessionStorage.getItem(GUIDE_OPEN_ON_REGISTER_KEY) === "1") {
        window.sessionStorage.removeItem(GUIDE_OPEN_ON_REGISTER_KEY);
        setGuideOpen(true);
        return;
      }
      if (window.localStorage.getItem(GUIDE_SEEN_KEY) !== "1") {
        setGuideOpen(true);
      }
    } catch {
      setGuideOpen(true);
    }
  }, [loading, user]);

  const openGuide = () => setGuideOpen(true);
  const closeGuide = () => {
    try {
      window.localStorage.setItem(GUIDE_SEEN_KEY, "1");
    } catch {
      /* ignore localStorage errors */
    }
    setGuideOpen(false);
  };
  const completeGuide = () => {
    try {
      window.localStorage.setItem(GUIDE_SEEN_KEY, "1");
    } catch {
      /* ignore localStorage errors */
    }
    setGuideOpen(false);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try { await logoutCabinet(); window.location.href = "/"; }
    catch { /* ignore */ }
    finally { setLoggingOut(false); setLogoutConfirm(false); }
  };

  if (loading) {
    return <div className="cb-loading-screen">Загрузка…</div>;
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
  const navBadgeForItem = (itemId) => {
    if (itemId === "students") return navCounts.students;
    if (itemId === "review") return navCounts.reviews;
    return 0;
  };

  const outletContext = {
    user,
    handleLogout,
    loggingOut,
    openGuide,
    currentPlan: subscription.currentPlan,
    subscriptionLoading: subscription.loading,
    navCounts,
  };

  return (
    <CabinetCallProvider>
    <div className="cabinet-layout cb-layout">
      <aside className="cabinet-sidebar cb-layout__sidebar">
        <nav className="cabinet-nav" aria-label="Разделы кабинета">
          {CABINET_NAV_GROUPS.map((group) => (
            <div key={group.id} className="cabinet-nav-group">
              <p className="cabinet-nav-group__label">{group.label}</p>
              <div className="cabinet-nav-group__items">
                {group.items.map((item) => (
                  <NavSidebarItem
                    key={item.id}
                    item={item}
                    active={isCabinetNavActive(location.pathname, item)}
                    badgeCount={navBadgeForItem(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="cabinet-sidebar-bottom">
          <Link
            to="/cabinet/upgrade"
            className="cabinet-plan-chip"
            title={planName ? `Тариф «${planName}»` : "Тарифы"}
            aria-label={planName ? `Тариф ${planName}` : "Тарифы"}
          >
            <span className="cabinet-plan-chip__icon" aria-hidden="true">
              <CabinetIcon name="wallet" />
            </span>
            <span className="cabinet-plan-chip__body">
              <span className="cabinet-plan-chip__label">Тариф</span>
              <span className="cabinet-plan-chip__name">
                {subscription.loading ? "…" : (planName || "Не выбран")}
              </span>
            </span>
          </Link>
          <Link
            to="/cabinet/settings/notifications/"
            className="cabinet-nav-item"
            aria-label="Настройки уведомлений"
          >
            <span className="cabinet-nav-item__icon">
              <CabinetIcon name="settings" />
            </span>
            <span className="cabinet-nav-item__label">Настройки</span>
          </Link>
          <Link
            to="/cabinet/more"
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
        <header className={`cabinet-header cabinet-header--teacher${isDashboard ? " cabinet-header--dashboard" : ""}`}>
          <div className="cabinet-header-title">
            <button
              type="button"
              className="cabinet-header-guide-btn"
              aria-label="Открыть инструкцию"
              title="Инструкция"
              onClick={openGuide}
            >
              <CabinetIcon name="bulb" />
            </button>
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

      <nav className="cb-mobile-nav cb-teacher-mobile-nav" aria-label="Мобильная навигация">
        {CABINET_MOBILE_NAV.map((item) => {
          const mobileBadge = item.id === "students"
            ? navCounts.students
            : item.id === "more"
              ? navCounts.reviews
              : 0;
          const mobileCount = formatNavCount(mobileBadge);
          const ariaLabel = mobileCount ? `${item.label}, ${mobileCount}` : item.label;
          return (
            <Link
              key={item.id}
              to={item.path}
              aria-label={ariaLabel}
              className={`cb-mobile-nav__item cb-teacher-mobile-nav__item${isCabinetMobileNavActive(location.pathname, item) ? " is-active" : ""}`}
            >
              <span className="cb-mobile-nav__icon-wrap">
                <CabinetIcon name={item.icon} />
                {mobileCount ? (
                  <span
                    className={`cb-mobile-nav__badge${item.id === "more" ? " cb-mobile-nav__badge--accent" : ""}`}
                    aria-hidden="true"
                  >
                    {mobileCount}
                  </span>
                ) : null}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <CabinetGuideModal open={guideOpen} onClose={closeGuide} onComplete={completeGuide} />
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
    </CabinetCallProvider>
  );
}
