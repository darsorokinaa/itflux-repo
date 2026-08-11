import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { displayName } from "../pages/CabinetAuthPage";
import { fetchCabinetSession, fetchNavCounts, logoutCabinetAndDetachPush, ensureCabinetPushSubscription } from "../utils/cabinetAuth";
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
import { UserAvatarMark } from "./components/ProfileAvatarEditor";
import { useSubscription } from "./hooks/useSubscription";
import { PageTitleProvider } from "./hooks/usePageTitle";
import PwaEnableNotificationsPrompt from "./pwa/PwaEnableNotificationsPrompt";
import PwaInstallPrompt from "./pwa/PwaInstallPrompt";
import { useSeasonalTheme } from "../seasonal/SeasonalThemeProvider";
import { openSupport } from "./support";
import "../styles/cabinet-dashboard.css";
import "./styles/teacher-cabinet.css";
import "../styles/cabinet-mobile-system.css";

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
      aria-current={active && !item.soon ? "page" : undefined}
      target={item.newTab ? "_blank" : undefined}
      rel={item.newTab ? "noopener noreferrer" : undefined}
    >
      {content}
    </Link>
  );
}

export default function CabinetLayout() {
  const location = useLocation();
  const { openAppearancePanel, hasSeasonalAppearance } = useSeasonalTheme();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);
  const [isMobileShell, setIsMobileShell] = useState(false);
  const [navCounts, setNavCounts] = useState({ students: 0, reviews: 0 });
  const searchInputRef = useRef(null);
  const headerMoreRef = useRef(null);
  const subscription = useSubscription();
  const planName = subscription.currentPlan?.name || "";

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => {
      setIsMobileShell(mq.matches);
      if (!mq.matches) {
        setNavOpen(false);
        setHeaderMoreOpen(false);
      }
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
    setNavOpen(false);
    setHeaderMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

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

  useEffect(() => {
    if (!headerMoreOpen) return undefined;
    const onDoc = (e) => {
      if (headerMoreRef.current && !headerMoreRef.current.contains(e.target)) {
        setHeaderMoreOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setHeaderMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [headerMoreOpen]);

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

  const refreshUser = useCallback(async () => {
    try {
      const d = await fetchCabinetSession();
      setUser(d?.authenticated ? d.user : null);
    } catch {
      /* ignore */
    }
  }, []);
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
    try {
      await logoutCabinetAndDetachPush();
    } catch {
      /* ignore — still leave the cabinet UI */
    } finally {
      setLogoutConfirm(false);
      window.location.href = "/";
    }
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
    if (location.pathname.startsWith("/cabinet/settings/notifications")) {
      return <Navigate to="/cabinet/student/settings/notifications/" replace />;
    }
    return <Navigate to="/cabinet/student" replace />;
  }

  if (user.role === "parent") {
    return <Navigate to="/cabinet/parent" replace />;
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
    openSupport,
    refreshUser,
    currentPlan: subscription.currentPlan,
    subscription: subscription.subscription,
    subscriptionLoading: subscription.loading,
    refreshSubscription: subscription.refreshUsage,
    navCounts,
  };

  return (
    <PageTitleProvider defaultTitle={sectionTitle}>
    <CabinetCallProvider>
    <div className={`cabinet-layout cb-layout${navOpen ? " is-nav-open" : ""}`}>
      {navOpen ? (
        <button
          type="button"
          className="cabinet-nav-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside
        className={`cabinet-sidebar cb-layout__sidebar${navOpen ? " is-open" : ""}`}
        id="cabinet-sidebar-nav"
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
          <div className="cabinet-sidebar-bottom__row">
            <Link
              to="/cabinet/more"
              className={`cabinet-user-avatar${user?.avatar ? " cabinet-user-avatar--photo" : ""}`}
              title={displayName(user)}
              aria-label="Профиль"
            >
              <UserAvatarMark user={user} fallbackName={displayName(user)} />
              <span className="cabinet-sidebar-bottom__label">Профиль</span>
            </Link>
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
        <header className={`cabinet-header cabinet-header--teacher${isDashboard ? " cabinet-header--dashboard" : ""}`}>
          <div className="cabinet-header-title">
            <button
              type="button"
              className="cabinet-header-menu-btn"
              aria-label={navOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={navOpen}
              aria-controls="cabinet-sidebar-nav"
              onClick={() => setNavOpen((v) => !v)}
            >
              <CabinetIcon name="menu" />
            </button>
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
              className="cabinet-header-icon-btn cabinet-header-search-toggle"
              aria-label={searchOpen ? "Закрыть поиск" : "Поиск"}
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <CabinetIcon name="search" />
            </button>
            <div className="cabinet-header-more" ref={headerMoreRef}>
              <button
                type="button"
                className="cabinet-header-icon-btn cabinet-header-more-btn"
                aria-label="Дополнительные действия"
                aria-expanded={headerMoreOpen}
                onClick={() => setHeaderMoreOpen((v) => !v)}
              >
                <CabinetIcon name="more" />
              </button>
              {headerMoreOpen ? (
                <div className="cabinet-header-more__menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="cabinet-header-more__item"
                    onClick={() => {
                      setHeaderMoreOpen(false);
                      openGuide();
                    }}
                  >
                    <CabinetIcon name="bulb" />
                    <span>Инструкция</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="cabinet-header-more__item"
                    onClick={() => {
                      setHeaderMoreOpen(false);
                      setSearchOpen(true);
                    }}
                  >
                    <CabinetIcon name="search" />
                    <span>Поиск</span>
                  </button>
                  <Link
                    to="/cabinet/settings/notifications/"
                    role="menuitem"
                    className="cabinet-header-more__item"
                    onClick={() => setHeaderMoreOpen(false)}
                  >
                    <CabinetIcon name="settings" />
                    <span>Настройки</span>
                  </Link>
                  {hasSeasonalAppearance ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="cabinet-header-more__item"
                      onClick={() => {
                        setHeaderMoreOpen(false);
                        openAppearancePanel();
                      }}
                    >
                      <CabinetIcon name="spark" />
                      <span>Оформление</span>
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <Link
              to="/cabinet/more"
              className={`cabinet-user-avatar cabinet-header-avatar${user?.avatar ? " cabinet-user-avatar--photo" : ""}`}
              title={displayName(user)}
              aria-label="Профиль и настройки"
            >
              <UserAvatarMark user={user} fallbackName={displayName(user)} />
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
          {isDashboard ? (
            <>
              <PwaInstallPrompt role="teacher" />
              <PwaEnableNotificationsPrompt role="teacher" />
            </>
          ) : null}
          <Outlet context={outletContext} />
        </div>
      </main>

      <nav className="cb-mobile-nav cb-teacher-mobile-nav" aria-label="Мобильная навигация">
        {CABINET_MOBILE_NAV.map((item) => {
          const mobileBadge = item.id === "students"
            ? navCounts.students
            : item.id === "review"
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
                    className={`cb-mobile-nav__badge${item.id === "review" ? " cb-mobile-nav__badge--accent" : ""}`}
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
    </PageTitleProvider>
  );
}
