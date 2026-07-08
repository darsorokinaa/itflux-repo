import { useEffect, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BookOpenCheck,
  Target,
  ClipboardList,
  CompassIcon,
} from "lucide-react";
import HeroSection from "../components/HeroSection";
import { type LevelId } from "../data/levels";
import { countAvailableSubjectIds } from "../data/subjects";
import { formatTasksCount } from "../utils/formatTasksCount";
import { formatIntRu } from "../utils/formatIntRu";

type PlatformStats = {
  total_tasks: number;
  subjects_count: number;
  generated_variants_count: number;
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
  const heroTasksCountLabel =
    stats != null && stats.total_tasks > 0 ? formatIntRu(stats.total_tasks) : "11 667";
  const heroSubjectsCountLabel = formatIntRu(countAvailableSubjectIds());
  const heroGeneratedVariantsCountLabel =
    stats != null && stats.generated_variants_count >= 0
      ? formatIntRu(stats.generated_variants_count)
      : "0";

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
          <HeroSection
            tasksCountLabel={heroTasksCountLabel}
            subjectsCountLabel={heroSubjectsCountLabel}
            generatedVariantsCountLabel={heroGeneratedVariantsCountLabel}
          />

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

          <TeacherWorkspaceBlock />
        </main>
      </div>
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

type TeacherWorkspaceItem = {
  title: string;
  text: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
};

const TEACHER_WORKSPACE_ITEMS: ReadonlyArray<TeacherWorkspaceItem> = [
  {
    title: "Банк задач",
    text: "Актуальные задания по темам, классам и форматам",
    Icon: Target,
  },
  {
    title: "Генератор вариантов",
    text: "Сборка вариантов и тренировок под нужный уровень",
    Icon: CompassIcon,
  },
  {
    title: "Готовые уроки",
    text: "Презентации, задания, рабочие листы и интерактивы",
    Icon: BookOpenCheck,
  },
  {
    title: "Домашние задания",
    text: "Выдача заданий ученикам и автоматическая проверка",
    Icon: ClipboardList,
  },
];

function TeacherWorkspaceBlock() {
  return (
    <section className="teacher-workspace-block" aria-labelledby="teacher-workspace-heading">
      <header className="section-head">
        <h2 id="teacher-workspace-heading" className="section-head__title">
          Всё для занятий в одном месте
        </h2>
        <p className="section-head__lead">
          Не нужно собирать материалы по разным вкладкам: задачи, варианты, уроки,
          домашние задания и проверка собраны в одном рабочем пространстве.
        </p>
      </header>

      <div className="teacher-workspace-grid">
        {TEACHER_WORKSPACE_ITEMS.map((item) => (
          <article key={item.title} className="teacher-workspace-card">
            <div className="teacher-workspace-card__icon" aria-hidden>
              <item.Icon size={18} strokeWidth={2.1} color="currentColor" />
            </div>
            <h3 className="teacher-workspace-card__title">{item.title}</h3>
            <p className="teacher-workspace-card__text">{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
