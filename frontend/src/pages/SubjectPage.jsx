import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import NotFoundPage from "./NotFoundPage";
import { SubjectExamCountdownCompactCard } from "../components/SubjectExamCountdowns";

const KNOWN_LEVELS = ["oge", "ege"];

function SvgStripMath() {
  return (
    <svg width="44" height="150" viewBox="0 0 44 150" fill="none" aria-hidden>
      <circle cx="22" cy="18" r="10" fill="rgba(255,255,255,0.12)" />
      <circle cx="10" cy="42" r="5" fill="rgba(255,255,255,0.08)" />
      <rect x="8" y="58" width="28" height="4" rx="2" fill="rgba(255,255,255,0.15)" />
      <rect x="14" y="70" width="16" height="4" rx="2" fill="rgba(255,255,255,0.1)" />
      <circle cx="30" cy="92" r="8" fill="rgba(255,255,255,0.1)" />
      <rect x="6" y="108" width="32" height="3" rx="1.5" fill="rgba(255,255,255,0.12)" />
      <circle cx="16" cy="124" r="4" fill="rgba(255,255,255,0.08)" />
      <rect x="10" y="136" width="24" height="3" rx="1.5" fill="rgba(255,255,255,0.1)" />
    </svg>
  );
}

function SvgStripInf() {
  return (
    <svg width="44" height="150" viewBox="0 0 44 150" fill="none" aria-hidden>
      <rect x="6" y="10" width="32" height="22" rx="4" fill="rgba(255,255,255,0.12)" />
      <rect x="10" y="16" width="10" height="3" rx="1.5" fill="rgba(255,255,255,0.2)" />
      <rect x="10" y="22" width="18" height="3" rx="1.5" fill="rgba(255,255,255,0.15)" />
      <rect x="8" y="44" width="28" height="3" rx="1.5" fill="rgba(255,255,255,0.1)" />
      <rect x="8" y="52" width="20" height="3" rx="1.5" fill="rgba(255,255,255,0.08)" />
      <circle cx="22" cy="78" r="12" stroke="rgba(255,255,255,0.15)" strokeWidth="2" fill="none" />
      <circle cx="22" cy="78" r="5" fill="rgba(255,255,255,0.1)" />
      <rect x="6" y="104" width="32" height="3" rx="1.5" fill="rgba(255,255,255,0.12)" />
      <rect x="12" y="112" width="20" height="3" rx="1.5" fill="rgba(255,255,255,0.08)" />
      <rect x="8" y="128" width="28" height="12" rx="3" fill="rgba(255,255,255,0.08)" />
    </svg>
  );
}

function SvgStripPhys() {
  return (
    <svg width="44" height="150" viewBox="0 0 44 150" fill="none" aria-hidden>
      <circle cx="22" cy="22" r="12" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" fill="none" />
      <ellipse cx="22" cy="22" rx="12" ry="5" stroke="rgba(255,255,255,0.12)" strokeWidth="1" fill="none" />
      <circle cx="22" cy="22" r="3" fill="rgba(255,255,255,0.2)" />
      <path
        d="M8 55 Q16 48 22 55 Q28 62 36 55"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M8 65 Q16 58 22 65 Q28 72 36 65"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="1"
        fill="none"
      />
      <line x1="22" y1="85" x2="22" y2="105" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
      <line x1="14" y1="95" x2="30" y2="95" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
      <circle cx="22" cy="95" r="6" stroke="rgba(255,255,255,0.12)" strokeWidth="1" fill="none" />
      <rect x="10" y="118" width="24" height="16" rx="4" fill="rgba(255,255,255,0.1)" />
      <line x1="22" y1="118" x2="22" y2="134" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <line x1="10" y1="126" x2="34" y2="126" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
    </svg>
  );
}

function SubjectPage() {
  const { level } = useParams();
  const navigate = useNavigate();
  const [blockedNotice, setBlockedNotice] = useState(false);
  const blockedNoticeTimeoutRef = useRef(null);

  useLayoutEffect(() => {
    document.body.classList.add("subject-page");
    return () => document.body.classList.remove("subject-page");
  }, []);

  if (!KNOWN_LEVELS.includes(level)) return <NotFoundPage />;

  const mathTitle = level === "ege" ? "Математика (профиль)" : "Математика";

  function handleSearchTask(e) {
    e.preventDefault();
    const form = e.target;
    const query = form.query.value?.trim();
    if (query) {
      navigate(`/search/tasks?q=${encodeURIComponent(query)}`);
    }
  }

  function handleSearchVariant(e) {
    e.preventDefault();
    const form = e.target;
    const query = form.query.value?.trim();
    if (query) {
      navigate(`/search-variant?q=${encodeURIComponent(query)}`);
    }
  }

  function handleLockedSubjectClick(e) {
    e.preventDefault();
    if (blockedNoticeTimeoutRef.current) {
      window.clearTimeout(blockedNoticeTimeoutRef.current);
    }
    setBlockedNotice(true);
    blockedNoticeTimeoutRef.current = window.setTimeout(() => {
      setBlockedNotice(false);
      blockedNoticeTimeoutRef.current = null;
    }, 2200);
  }

  useEffect(() => {
    return () => {
      if (blockedNoticeTimeoutRef.current) {
        window.clearTimeout(blockedNoticeTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="subject-page sc-subject-v2">
      <div className="container subject-page-container">
        <div className="sc-subject-root">
          <header className="sc-top">
            <div className="sc-top-text">
              <h1 className="sc-top-title">Выберите предмет</h1>
              <p className="sc-top-lead">
                Готовые задания и варианты для уроков,
                <br />
                контрольных и экзаменов
              </p>
            </div>
            <div className="sc-top-searches">
              <form className="sc-search-row" onSubmit={handleSearchTask}>
                <input
                  name="query"
                  type="search"
                  className="sc-search-input"
                  placeholder="Поиск задачи..."
                  autoComplete="off"
                />
                <button type="submit" className="sc-search-btn">
                  Найти
                </button>
              </form>
              <form className="sc-search-row" onSubmit={handleSearchVariant}>
                <input
                  name="query"
                  type="search"
                  className="sc-search-input"
                  placeholder="Поиск варианта..."
                  autoComplete="off"
                />
                <button type="submit" className="sc-search-btn">
                  Найти
                </button>
              </form>
            </div>
          </header>

          {blockedNotice ? (
            <div className="sc-lock-notice" role="status" aria-live="polite">
              Доступ заблокирован. Предмет скоро появится.
            </div>
          ) : null}

          <section className="sc-section sc-section--available" aria-labelledby="sc-available-heading">
            <h2 id="sc-available-heading" className="sc-section-label">
              Доступно сейчас
            </h2>
            <div className="sc-available-grid">
              <Link to={`/${level}/math`} className="sc-card sc-card--math">
                <div className="sc-strip" aria-hidden="true">
                  <SvgStripMath />
                </div>
                <div className="sc-body">
                  <h3 className="sc-body-title">{mathTitle}</h3>
                  <p className="sc-body-desc">
                    Алгебра, геометрия и задачи
                    <br />
                    с реальными экзаменационными форматами
                  </p>
                  <span className="sc-body-cta">Перейти →</span>
                </div>
              </Link>

              <Link to={`/${level}/inf`} className="sc-card sc-card--inf">
                <div className="sc-strip" aria-hidden="true">
                  <SvgStripInf />
                </div>
                <div className="sc-body">
                  <h3 className="sc-body-title">Информатика</h3>
                  <p className="sc-body-desc">
                    Алгоритмы, программирование
                    <br />и практические задания по логике решений
                  </p>
                  <span className="sc-body-cta">Перейти →</span>
                </div>
              </Link>

              <Link
                to={`/${level}/phys`}
                className="sc-card sc-card--phys"
                onClick={handleLockedSubjectClick}
                aria-disabled="true"
              >
                <div className="sc-strip" aria-hidden="true">
                  <SvgStripPhys />
                </div>
                <div className="sc-body">
                  <h3 className="sc-body-title">Физика</h3>
                  <p className="sc-body-desc">
                    Механика, электродинамика
                    <br />и расчётные задачи с пояснением шагов
                  </p>
                  <span className="sc-body-cta">Перейти →</span>
                </div>
              </Link>
            </div>
          </section>

          <section
            className="sc-section sc-section--countdowns"
            aria-labelledby="sc-countdowns-heading"
          >
            <div className="sc-countdowns-intro">
              <h2 id="sc-countdowns-heading" className="sc-countdowns-title">
                До экзаменов осталось
              </h2>
              <p className="sc-countdowns-lead">
                Следите за сроками и переходите к подготовке по нужному предмету.
              </p>
            </div>
            <div className="sc-countdown-grid">
              <SubjectExamCountdownCompactCard
                level={level}
                subjectKey="math"
                to={`/${level}/math`}
              />
              <SubjectExamCountdownCompactCard
                level={level}
                subjectKey="inf"
                to={`/${level}/inf`}
              />
              <SubjectExamCountdownCompactCard
                level={level}
                subjectKey="phys"
                to={`/${level}/phys`}
                locked
                onLockedClick={handleLockedSubjectClick}
              />
            </div>
          </section>

          <section className="sc-section sc-section--soon" aria-labelledby="sc-soon-heading">
            <h2 id="sc-soon-heading" className="sc-section-label">
              Скоро
            </h2>
            <div className="sc-soon-grid">
              <div className="sc-soon-card">
                <div className="sc-soon-left">
                  <span className="sc-soon-icon sc-soon-icon--chem" aria-hidden="true">
                    🧪
                  </span>
                  <div>
                    <div className="sc-soon-name">Химия</div>
                    <div className="sc-soon-sub">Неорганика, органика</div>
                  </div>
                </div>
                <span className="sc-soon-tag">2026</span>
              </div>
              <div className="sc-soon-card">
                <div className="sc-soon-left">
                  <span className="sc-soon-icon sc-soon-icon--bio" aria-hidden="true">
                    🧬
                  </span>
                  <div>
                    <div className="sc-soon-name">Биология</div>
                    <div className="sc-soon-sub">Клетка, генетика, экология</div>
                  </div>
                </div>
                <span className="sc-soon-tag">2026</span>
              </div>
              <div className="sc-soon-card">
                <div className="sc-soon-left">
                  <span className="sc-soon-icon sc-soon-icon--hist" aria-hidden="true">
                    🏛️
                  </span>
                  <div>
                    <div className="sc-soon-name">История</div>
                    <div className="sc-soon-sub">Россия и Мир</div>
                  </div>
                </div>
                <span className="sc-soon-tag">2026</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default SubjectPage;
