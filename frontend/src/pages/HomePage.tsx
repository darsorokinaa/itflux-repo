import { useEffect, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BookOpenCheck,
  Target,
  ClipboardList,
  CompassIcon,
} from "lucide-react";
import NewsBlock from "../components/NewsBlock";
import { type LevelId } from "../data/levels";
import { formatTasksCount } from "../utils/formatTasksCount";
import { formatIntRu } from "../utils/formatIntRu";

type PlatformStats = {
  total_tasks: number;
  subjects_count: number;
  tasks_by_level: Record<string, number>;
};

type HomeLevel = {
  id: LevelId;
  title: string;
  classLabel: string;
  description: string;
  icon: string;
  /** CSS class, отвечает за градиентный фон карточки. */
  styleVariant: "oge" | "ege" | "base";
  /** Если у уровня нет данных в БД и нечего показать в счётчике. */
  fallbackCountLabel?: string;
};

const HOME_LEVELS: ReadonlyArray<HomeLevel> = [
  {
    id: "oge",
    title: "ОГЭ",
    classLabel: "9 класс",
    description: "Все типы заданий, варианты и тренировка второй части",
    icon: "<>",
    styleVariant: "oge",
  },
  {
    id: "ege",
    title: "ЕГЭ",
    classLabel: "11 класс",
    description: "Логика, алгоритмы, анализ данных и программирование",
    icon: "◎",
    styleVariant: "ege",
    fallbackCountLabel: "запуск скоро",
  },
  {
    id: "vpr",
    title: "Школьная база",
    classLabel: "7–8 класс",
    description: "Тренировка базовых тем до уверенного уровня",
    icon: "∑",
    styleVariant: "base",
  },
];

export default function HomePage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [selected, setSelected] = useState<LevelId | null>(null);
  const [stats, setStats] = useState<PlatformStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/platform-stats/", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PlatformStats | null) => {
        if (cancelled || !data || typeof data.total_tasks !== "number") return;
        setStats(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hash) return;
    const id = hash.replace(/^#/, "");
    if (!id) return;
    const tryScroll = (attempt = 0) => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (attempt < 20) {
        window.setTimeout(() => tryScroll(attempt + 1), 50);
      }
    };
    tryScroll();
  }, [hash]);

  const handleLevelNavigate = (id: LevelId) => {
    setSelected(id);
    window.setTimeout(() => navigate(`/subject/${id}`), 140);
  };

  return (
    <div className="digital-flow-page relative min-h-screen overflow-x-hidden">

      <div className="digital-flow-page__wrap">
        <main className="home-page__main">
        <Hero stats={stats} />

        <section id="home-levels" className="home-levels">
          <header className="section-head">
            <h2 className="section-head__title">Выберите формат подготовки</h2>
            <p className="section-head__lead">
              Подберите уровень — задания, темы и варианты подстроятся под него.
            </p>
          </header>

          <div className="home-levels-grid">
            {HOME_LEVELS.map((level) => {
              const count = stats?.tasks_by_level?.[level.id];
              const countLabel =
                count != null && count > 0
                  ? formatTasksCount(count)
                  : level.fallbackCountLabel ?? "…";
              return (
                <LevelCardHome
                  key={level.id}
                  level={level}
                  countLabel={countLabel}
                  selected={selected === level.id}
                  dimmed={selected !== null && selected !== level.id}
                  onClick={() => handleLevelNavigate(level.id)}
                />
              );
            })}
          </div>
        </section>

        <ValueBlock />

        <div className="home-page__updates">
          <NewsBlock />
        </div>
      </main>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function Hero({ stats }: { stats: PlatformStats | null }) {
  const totalLabel = stats != null ? formatIntRu(stats.total_tasks) : "…";
  const subjectsLabel = stats != null ? String(stats.subjects_count) : "…";

  return (
    <section className="hero-section" aria-labelledby="home-hero-heading">
      <div className="hero-section__inner">
        <div className="hero-section__copy">
          <span className="hero-eyebrow">Подготовка к экзаменам по информатике</span>

          <h1 id="home-hero-heading" className="hero-h1">
            Готовься не наугад: решай задания, проверяй ответы и закрывай{" "}
            <span className="hero-accent">ошибки.</span>
          </h1>

          <p className="hero-desc">
            Платформа помогает готовиться системно: по темам, типам заданий,
            вариантам и результатам проверки. Подходит для самостоятельной
            подготовки и занятий с преподавателем.
          </p>

          <div className="hero-btns">
            <CtaPrimary href="#home-levels">Начать подготовку</CtaPrimary>
          </div>
        </div>

        <aside className="hero-aside" aria-label="Статистика платформы">
          <StatCard number={totalLabel} label="задания" />
          <StatCard number={subjectsLabel} label="типов ОГЭ" />
          <StatCard number="ФИПИ" label="темы экзамена" />
        </aside>
      </div>
    </section>
  );
}

function CtaPrimary({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="cta-primary btn-hero-primary inline-flex items-center justify-center gap-1.5"
    >
      {children}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6"/>
      </svg>
    </a>
  );
}

function StatCard({ number, label }: { number: string; label: string }) {
  return (
    <div className="hero-stat">
      <span className="hero-stat-num">{number}</span>
      <span className="hero-stat-label">{label}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

type LevelCardHomeProps = {
  level: HomeLevel;
  countLabel: string;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
};

function LevelCardHome({
  level,
  countLabel,
  selected,
  dimmed,
  onClick,
}: LevelCardHomeProps) {
  const cardStyle: CSSProperties = {
    boxShadow: selected
      ? "var(--shadow-card), 0 0 0 3px rgba(111, 141, 255, 0.75)"
      : "var(--shadow-card)",
    opacity: dimmed ? 0.55 : 1,
    transform: dimmed ? "scale(0.985)" : "scale(1)",
  };

  const iconClass =
    level.icon === "∑"
      ? "home-level-card__icon-glyph home-level-card__icon-glyph--sum"
      : level.icon === "<>"
        ? "home-level-card__icon-glyph home-level-card__icon-glyph--code"
        : "home-level-card__icon-glyph";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`home-level-card home-level-card--${level.styleVariant}`}
      style={cardStyle}
      aria-label={`${level.title}, ${level.classLabel}`}
    >
      <span className="home-level-card__inner">
        <span className="home-level-card__icon" aria-hidden>
          <span className={iconClass}>{level.icon}</span>
        </span>
        <span className="home-level-card__line">
          <span className="home-level-card__title">{level.title}</span>
          <span className="home-level-card__desc">{level.description}</span>
        </span>
      </span>

      <span className="home-level-card__right">
        <span className="home-level-card__badge">{countLabel}</span>
        <span className="home-level-card__arrow" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────── */

type ValueItem = {
  title: string;
  text: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
};

const VALUE_ITEMS: ReadonlyArray<ValueItem> = [
  {
    title: "Решать по темам",
    text: "Тренировка конкретных заданий, которые нужно подтянуть.",
    Icon: Target,
  },
  {
    title: "Видеть ошибки",
    text: "После проверки понятно, где потеряны баллы.",
    Icon: ClipboardList,
  },
  {
    title: "Проходить варианты",
    text: "Практика в формате экзамена и сбор устойчивого результата.",
    Icon: BookOpenCheck,
  },
  {
    title: "Готовиться системно",
    text: "Не случайное нарешивание, а фокус на слабые места.",
    Icon: CompassIcon,
  },
];

function ValueBlock() {
  return (
    <section className="features-block" aria-labelledby="value-block-heading">
      <header className="section-head">
        <h2 id="value-block-heading" className="section-head__title">
          Как платформа помогает готовиться
        </h2>
        <p className="section-head__lead">
          Готовим по проверенной схеме: тема → практика → проверка → разбор
          ошибок. Системно, без хаоса, с результатом.
        </p>
      </header>

      <div className="features-grid">
        {VALUE_ITEMS.map((item) => (
          <article key={item.title} className="feature-card">
            <div className="feature-card__icon" aria-hidden>
              <item.Icon size={20} strokeWidth={2} color="currentColor" />
            </div>
            <h3 className="feature-card__title">{item.title}</h3>
            <p className="feature-card__desc">{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
