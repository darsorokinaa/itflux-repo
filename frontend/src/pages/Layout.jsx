import { useEffect, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import Nav from "../components/Nav";
import MobileTabBar from "../components/MobileTabBar";
import { SUMMER_CLUB_NAV_LABEL, SUMMER_CLUB_URL } from "../config/summerClub";

const COOKIE_CONSENT_KEY = "cookie_consent_accepted";

function Layout() {
  const { pathname, search } = useLocation();
  /** Маркетинг и выбор заданий — свой Nav, без шапки/подвала генератора */
  const pathNorm = (pathname || "").replace(/\/+$/, "") || "/";
  const isTasksPrepPicker = /^\/(oge|ege|vpr)\/[^/]+$/.test(pathNorm);
  const isLessonViewerPage = /^\/lessons\/[^/]+\/view$/.test(pathNorm);
  const isInteractivePlayPage =
    /^\/cabinet\/interactives\/[^/]+\/play$/.test(pathNorm)
    || /^\/cabinet\/student\/interactives\/\d+\/play$/.test(pathNorm);
  const isStudentCabinet = pathname.startsWith("/cabinet/student");
  const isCabinetArea = pathname.startsWith("/cabinet");
  const isChromelessPage = isLessonViewerPage || isInteractivePlayPage;
  /** Экзамен/вариант: своя залипающая панель действий снизу — нижнюю навигацию там не показываем. */
  const isExamVariantPage = /^\/(oge|ege|vpr)\/[^/]+\/variant\//.test(pathNorm);
  const isMarketingHome =
    pathname === "/" ||
    pathname === "/tasks" ||
    pathname === "/generator" ||
    pathname === "/lessons" ||
    pathname === "/interesting" ||
    pathname === "/teachers" ||
    pathname === "/cabinet" ||
    pathname === "/cabinet/login" ||
    isStudentCabinet ||
    pathname === "/subject" ||
    pathname.startsWith("/subject/") ||
    pathname.startsWith("/search/tasks") ||
    pathname.startsWith("/search-variant") ||
    /^\/(oge|ege)$/.test(pathNorm) ||
    isTasksPrepPicker;
  const lessonJoinMode = pathname.startsWith("/lesson/join");
  const query = new URLSearchParams(search || "");
  const isHomeworkQuery =
    query.get("homework_mode") === "1" ||
    String(query.get("cabinet_session") || "").toLowerCase() === "homework" ||
    !!query.get("cabinet_assignment");
  const isHomeworkContext = isHomeworkQuery;
  const isLessonOrHomeworkContext =
    lessonJoinMode ||
    isHomeworkContext ||
    query.get("lesson_embed") === "1" ||
    query.get("lesson_embed") === "true";
  const isLessonEmbedAny =
    query.get("lesson_embed") === "1" || query.get("lesson_embed") === "true";
  const isHomeworkEmbedContext =
    isLessonEmbedAny && (
      query.get("homework_mode") === "1" ||
      String(query.get("cabinet_session") || "").toLowerCase() === "homework" ||
      !!query.get("cabinet_assignment")
    );

  const [cookieAccepted, setCookieAccepted] = useState(() => {
    try { return !!localStorage.getItem(COOKIE_CONSENT_KEY); } catch { return false; }
  });

  function acceptCookies() {
    try { localStorage.setItem(COOKIE_CONSENT_KEY, "1"); } catch { /* ignore */ }
    setCookieAccepted(true);
  }

  useEffect(() => {
    const run = () => {
      if (window.MathJax?.typesetPromise) {
        window.MathJax.typesetPromise().catch(() => {});
      } else {
        setTimeout(run, 100);
      }
    };
    const id = setTimeout(run, 100);
    return () => clearTimeout(id);
  }, [pathname]);

  const showMobileTabBar =
    !isLessonOrHomeworkContext && !isChromelessPage && !isExamVariantPage && !isCabinetArea;

  const showSiteFooter =
    !isChromelessPage &&
    !isLessonOrHomeworkContext &&
    (!isCabinetArea || pathname === "/cabinet/login");

  return (
    <div
      className={`app-shell${isChromelessPage ? " app-shell--lesson-viewer" : ""}${showMobileTabBar ? " app-shell--has-tabbar" : ""}`}
    >
      <div
        className="app-shell-pattern"
        aria-hidden="true"
        style={{
          backgroundImage: `url('${import.meta.env.BASE_URL}img/bg.png')`,
        }}
      />
      <div className="app-shell-content">
      {!isLessonOrHomeworkContext && !isChromelessPage && (!isCabinetArea || pathname === '/cabinet/login') && <Nav />}

      <aside>
        {/* боковое меню */}
      </aside>

      <main className={isMarketingHome || isChromelessPage ? "w-full" : "container mt-4"}>
        <Outlet />
      </main>

      {showSiteFooter ? (
      <footer className={`site-footer${isLessonOrHomeworkContext ? " site-footer--embed" : ""}`}>
        <div className="site-footer-inner">
          <span className="site-footer-copy">© 2026 Цифровой поток</span>
          {!isLessonOrHomeworkContext && (
          <div className="site-footer-links">
            <a
              href={SUMMER_CLUB_URL}
              className="site-footer-link site-footer-link--summer-club"
              target="_blank"
              rel="noopener noreferrer"
            >
              {SUMMER_CLUB_NAV_LABEL}
            </a>
            <span className="site-footer-sep" aria-hidden="true">·</span>
            <Link to="/privacy" className="site-footer-link">Политика конфиденциальности</Link>
            <span className="site-footer-sep" aria-hidden="true">·</span>
            <Link to="/privacy#pd" className="site-footer-link">Согласие на обработку ПД</Link>
          </div>
          )}
        </div>
      </footer>
      ) : null}

      {!cookieAccepted && !isLessonOrHomeworkContext && !isChromelessPage && (
        <div className="cookie-banner" role="alertdialog" aria-label="Уведомление об использовании файлов cookie">
          <div className="cookie-banner-inner">
            <p className="cookie-banner-text">
              Мы используем файлы cookie для корректной работы сайта. Продолжая использование сайта, вы соглашаетесь с{" "}
              <Link to="/privacy" className="cookie-banner-link">политикой конфиденциальности</Link> и обработкой персональных данных.
            </p>
            <button type="button" className="cookie-banner-btn" onClick={acceptCookies}>
              Принять
            </button>
          </div>
        </div>
      )}

      {showMobileTabBar ? <MobileTabBar /> : null}

      <script
        src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.min.js"
      ></script>
      </div>
    </div>
  );
}

export default Layout;
