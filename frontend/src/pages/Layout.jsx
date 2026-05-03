import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import {
  readPersistedTheme,
} from "../utils/themeStorage";
import { LK_PUBLIC_URL } from "../config/publicUrls";

const COOKIE_CONSENT_KEY = "cookie_consent_accepted";

function Layout() {
  const { pathname, search } = useLocation();
  const lessonJoinMode = pathname.startsWith("/lesson/join");
  const query = new URLSearchParams(search || "");
  const isLessonOrHomeworkContext =
    lessonJoinMode ||
    query.get("lesson_embed") === "1" ||
    query.get("homework_mode") === "1" ||
    String(query.get("cabinet_session") || "").toLowerCase() === "homework" ||
    !!query.get("cabinet_assignment");
  const isHomeworkContext =
    query.get("homework_mode") === "1" ||
    String(query.get("cabinet_session") || "").toLowerCase() === "homework" ||
    !!query.get("cabinet_assignment");
  const isLessonEmbedAny = query.get("lesson_embed") === "1";
  const isHomeworkEmbedContext =
    isLessonEmbedAny &&
    (
      query.get("homework_mode") === "1" ||
      String(query.get("cabinet_session") || "").toLowerCase() === "homework" ||
      !!query.get("cabinet_assignment")
    );
  const isLessonEmbedContext = isLessonEmbedAny && !isHomeworkEmbedContext;
  const isLessonTeacherEmbedContext = isLessonEmbedContext && query.get("lesson_student") !== "1";

  const handleLessonFinishClick = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: "exam-embedded-lesson", type: "lesson_finish_click" }, "*");
    }
  };
  /** URL ЛК: сначала из сборки (VITE_LK_PUBLIC_URL / VITE_LK_URL), после запроса — с сервера (Django LK_PUBLIC_URL), чтобы не открывалась главная генератора по ошибке. */
  const [lkHref, setLkHref] = useState(LK_PUBLIC_URL);
  const [lkNavGateRequired, setLkNavGateRequired] = useState(false);
  const [lkNavUnlocked, setLkNavUnlocked] = useState(false);
  const [lkModalOpen, setLkModalOpen] = useState(false);
  const [lkModalPassword, setLkModalPassword] = useState("");
  const [lkModalError, setLkModalError] = useState("");
  const [themeData, setThemeData] = useState(() => readPersistedTheme().themeData);
  const [cookieAccepted, setCookieAccepted] = useState(() => {
    try { return !!localStorage.getItem(COOKIE_CONSENT_KEY); } catch { return false; }
  });

  function acceptCookies() {
    try { localStorage.setItem(COOKIE_CONSENT_KEY, "1"); } catch { /* ignore */ }
    setCookieAccepted(true);
  }
  const [activeThemeId, setActiveThemeId] = useState(() => readPersistedTheme().activeThemeId);

  const themeDataRef = useRef(themeData);
  const activeThemeIdRef = useRef(activeThemeId);
  useEffect(() => {
    themeDataRef.current = themeData;
  }, [themeData]);
  useEffect(() => {
    activeThemeIdRef.current = activeThemeId;
  }, [activeThemeId]);

  const syncTheme = useCallback(() => {
    const next = readPersistedTheme();
    setThemeData(next.themeData);
    setActiveThemeId(next.activeThemeId);
  }, []);

  /** После смены календарного дня (вкладка была в фоне) подтянуть актуальное хранилище. */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const next = readPersistedTheme();
      if (
        JSON.stringify(themeDataRef.current) !== JSON.stringify(next.themeData) ||
        activeThemeIdRef.current !== next.activeThemeId
      ) {
        setThemeData(next.themeData);
        setActiveThemeId(next.activeThemeId);
        window.dispatchEvent(new Event("theme-change"));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    window.addEventListener("theme-change", syncTheme);
    return () => window.removeEventListener("theme-change", syncTheme);
  }, [syncTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (themeData?.decor) {
      root.style.setProperty("--theme-decor-url", `url(${themeData.decor})`);
      root.classList.add("theme-decor-active");
    } else {
      root.style.removeProperty("--theme-decor-url");
      root.classList.remove("theme-decor-active");
    }
    return () => {
      root.style.removeProperty("--theme-decor-url");
      root.classList.remove("theme-decor-active");
    };
  }, [themeData?.decor]);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/site-config/", { credentials: "same-origin", signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const u = data?.lk_nav_url || data?.lk_public_url;
        if (typeof u === "string" && u.trim()) {
          const v = u.trim().replace(/\/$/, "");
          if (/^https?:\/\//i.test(v)) setLkHref(v);
        }
        setLkNavGateRequired(!!data?.lk_nav_password_required);
        setLkNavUnlocked(!!data?.lk_nav_unlocked);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
      });
    return () => ac.abort();
  }, []);

  /** Не даём href стать пустым, если /api/site-config/ не отдал URL */
  const cabinetHref =
    typeof lkHref === "string" && lkHref.trim() ? lkHref.trim() : LK_PUBLIC_URL;

  const openCabinetInNewTab = useCallback((preOpenedWindow = null) => {
    if (preOpenedWindow && !preOpenedWindow.closed) {
      preOpenedWindow.location.href = cabinetHref;
      return;
    }
    window.open(cabinetHref, "_blank", "noopener,noreferrer");
  }, [cabinetHref]);

  /** Без `<a href>` — иначе браузер может предзагрузить ЛК (страница входа) при открытии главной. */
  function handleCabinetClick() {
    if (lkNavGateRequired && !lkNavUnlocked) {
      setLkModalError("");
      setLkModalPassword("");
      setLkModalOpen(true);
      return;
    }
    openCabinetInNewTab();
  }

  async function submitLkNavUnlock() {
    setLkModalError("");
    const pendingWindow = window.open("", "_blank");
    if (pendingWindow) pendingWindow.opener = null;
    try {
      const r = await fetch("/api/lk-nav-unlock/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: lkModalPassword.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
        setLkModalError(data.error || "Неверный пароль");
        return;
      }
      setLkNavUnlocked(true);
      setLkModalOpen(false);
      setLkModalPassword("");
      openCabinetInNewTab(pendingWindow);
    } catch {
      if (pendingWindow && !pendingWindow.closed) pendingWindow.close();
      setLkModalError("Не удалось проверить пароль");
    }
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

  return (
    <div className="app-shell">
      <div
        className="app-shell-pattern"
        aria-hidden="true"
        style={{
          backgroundImage: `url('${import.meta.env.BASE_URL}img/bg.png')`,
        }}
      />
      {themeData?.overlay && (
        <div
          className="app-shell-theme-overlay"
          aria-hidden="true"
          style={{ backgroundImage: `url(${themeData.overlay})` }}
        />
      )}
      <div className="app-shell-content">
      <header
        className={themeData?.headerBg ? "header--themed" : undefined}
        style={themeData?.headerBg ? { backgroundImage: `url(${themeData.headerBg})` } : undefined}
      >
    <div className="header-wrapper">
      <div className="logo-block">
        <Link to="/" className="logo-link">
          <img
            className="logo-theme-icon"
            src={themeData?.logo || `${import.meta.env.BASE_URL}img/logum-logo.svg?v=2`}
            alt="Логум"
            onError={(e) => {
              e.currentTarget.src = `${import.meta.env.BASE_URL}img/logum-logo.svg?v=2`;
            }}
          />
          <span className="logo-text">Логум</span>
        </Link>
      </div>
      <nav className="header-nav">
        {isHomeworkContext ? null : isLessonEmbedAny ? (
          isLessonTeacherEmbedContext ? (
            <button
              type="button"
              className="header-nav-finish"
              onClick={handleLessonFinishClick}
            >
              Завершить
            </button>
          ) : null
        ) : (
          <>
            {!lessonJoinMode ? (
              <>
                <button
                  type="button"
                  className="header-nav-link header-nav-cabinet"
                  onClick={handleCabinetClick}
                >
                  <span className="header-nav-cabinet__icon-circle" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                    </svg>
                  </span>
                  Личный кабинет
                </button>
              </>
            ) : null}
          </>
        )}
      </nav>
    </div>
</header>


      <aside>
        {/* боковое меню */}
      </aside>

      <main className="container mt-4">
        <Outlet />
      </main>

      <footer className={`site-footer${isLessonOrHomeworkContext ? " site-footer--embed" : ""}`}>
        <div className="site-footer-inner">
          <span className="site-footer-copy">© 2026 Логум</span>
          {!isLessonOrHomeworkContext && (
          <div className="site-footer-links">
            <button type="button" className="site-footer-link" onClick={handleCabinetClick}>
              Личный кабинет
            </button>
            <span className="site-footer-sep" aria-hidden="true">·</span>
            <Link to="/privacy" className="site-footer-link">Политика конфиденциальности</Link>
            <span className="site-footer-sep" aria-hidden="true">·</span>
            <Link to="/privacy#pd" className="site-footer-link">Согласие на обработку ПД</Link>
          </div>
          )}
        </div>
      </footer>

      {lkModalOpen && (
        <div
          className="lk-nav-gate-overlay"
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20000,
            background: "rgba(2, 6, 23, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setLkModalOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setLkModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lk-nav-gate-title"
            className="lk-nav-gate-card"
            style={{
              width: "min(420px, 94vw)",
              background: "#fff",
              borderRadius: 16,
              padding: "20px 18px",
              boxShadow: "0 20px 56px rgba(2, 6, 23, 0.32)",
              border: "1px solid #e2e8f0",
              textAlign: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="lk-nav-gate-title" style={{ fontSize: "1.05rem", marginBottom: 8, color: "#0f172a" }}>
              Личный кабинет
            </h2>
            <p style={{ color: "#64748b", fontSize: "0.88rem", marginBottom: 14, lineHeight: 1.45 }}>
              Введите пароль, чтобы открыть ссылку в новой вкладке.
            </p>
            <input
              type="password"
              value={lkModalPassword}
              onChange={(e) => setLkModalPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitLkNavUnlock();
                }
              }}
              autoComplete="current-password"
              placeholder="Пароль"
              style={{
                width: "100%",
                maxWidth: 300,
                margin: "0 auto 12px",
                display: "block",
                padding: "10px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                font: "inherit",
                textAlign: "center",
              }}
            />
            {lkModalError ? (
              <p style={{ color: "#b91c1c", fontSize: "0.82rem", marginBottom: 10 }}>{lkModalError}</p>
            ) : null}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={submitLkNavUnlock}>
                Открыть
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLkModalOpen(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {!cookieAccepted && !isLessonOrHomeworkContext && (
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

      <script
        src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.min.js"
      ></script>
      </div>
    </div>
  );
}

export default Layout;
