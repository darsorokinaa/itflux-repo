import { useEffect, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  BookOpenCheck,
  Target,
  ClipboardList,
  CompassIcon,
  Users,
} from "lucide-react";
import HeroSection from "../components/HeroSection";
import HomePiggyBank from "../components/HomePiggyBank";
import TeacherQuotesBlock from "../components/TeacherQuotesBlock";
import SeasonalHeroSticker from "../seasonal/SeasonalHeroSticker";
import { useTariffPlans } from "../components/tutorLanding/useTariffPlans";
import { type LevelId } from "../data/levels";
import { trackActivationIntent } from "../cabinet/activationAnalytics";
import { readAcquisition } from "../cabinet/visitContext";
import { fetchCabinetSession } from "../utils/cabinetAuth";
import { formatTasksCount } from "../utils/formatTasksCount";
import { formatIntRu } from "../utils/formatIntRu";
import { trackValueGoal } from "../utils/valuePath";

/** Продающие куски (ссылка на тарифы в value paths и т.п.). Блоки после value paths снова всегда на главной. */
const SHOW_HOME_SALES = false;

type SampleLesson = {
  slug: string;
  title: string;
  subject: string;
  short_description: string;
  preview_path: string;
};

type PlatformStats = {
  total_tasks: number;
  subjects_count: number;
  generated_variants_count: number;
  tasks_by_level: Record<string, number>;
  sample_lesson?: SampleLesson | null;
};

const ONLINE_LESSON_PATH = "/cabinet/schedule?create=1";

function safeInternalPath(path: string | undefined, fallback: string) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}

function trackHeroClick(path: "lesson" | "tasks" | "students") {
  const acq = readAcquisition();
  const utm: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const) {
    if (acq[key]) utm[key] = acq[key];
  }
  trackValueGoal("value_path_selected", { path, source: "home_hero", ...utm });
}

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
    id: "school",
    title: "Школьная программа",
    classLabel: "5–11 класс",
    description: "Программирование и курсы школьной программы",
    icon: "</>",
    styleVariant: "base",
  },
  {
    id: "vpr",
    title: "ВПР",
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
  const [authedTeacher, setAuthedTeacher] = useState(false);
  const { plans } = useTariffPlans();
  const startPlan = plans?.find((plan) => plan.slug === "start")
    || plans?.find((plan) => plan.is_free);
  const freeStudentLimit = startPlan?.limits?.students;
  const freeLimitCaption = typeof freeStudentLimit === "number"
    ? `До ${formatIntRu(freeStudentLimit)} учеников на тарифе «${startPlan?.name || "Старт"}»`
    : "";
  const heroTasksCountLabel =
    stats != null && stats.total_tasks > 0 ? formatIntRu(stats.total_tasks) : "11 667";
  const heroSubjectsCountLabel =
    stats != null && typeof stats.subjects_count === "number" && stats.subjects_count > 0
      ? formatIntRu(stats.subjects_count)
      : "…";
  const heroGeneratedVariantsCountLabel =
    stats != null && stats.generated_variants_count >= 0
      ? formatIntRu(stats.generated_variants_count)
      : "0";

  useEffect(() => {
    let cancelled = false;
    fetchCabinetSession()
      .then((session: { authenticated?: boolean; user?: { role?: string } } | null) => {
        if (cancelled) return;
        setAuthedTeacher(Boolean(session?.authenticated && session?.user?.role === "teacher"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
          {/* До «Что вам нужно сейчас?» продающий TutorLanding/hero не возвращаем. */}
          <HomeFirstHero
            lessonHref={safeInternalPath(stats?.sample_lesson?.preview_path, "/lessons")}
            freeLimitCaption={freeLimitCaption}
            authedTeacher={authedTeacher}
          />
          <HomeValuePathsBlock />
          <HomePiggyBank />
          {/* Блоки, которые раньше шли ПОСЛЕ value paths — вернуть (кроме продающих из TutorLanding). */}
          <div className="home-section-divider" role="separator" aria-hidden />
          <HeroSection
            tasksCountLabel={heroTasksCountLabel}
            subjectsCountLabel={heroSubjectsCountLabel}
            generatedVariantsCountLabel={heroGeneratedVariantsCountLabel}
            headingLevel={2}
            includeSeasonalSticker={false}
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
          <TeacherQuotesBlock headingId="home-teacher-quotes-heading" />
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

type HomeValuePath = {
  id: "lesson" | "tasks" | "students";
  title: string;
  lead: string;
  cta: string;
  to: string;
  styleVariant: "blue" | "burgundy" | "orange";
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
};

const HOME_VALUE_PATHS: ReadonlyArray<HomeValuePath> = [
  {
    id: "lesson",
    title: "Мне нужен готовый урок",
    lead: "Выберите предмет, класс и тему — готовый урок уже собран.",
    cta: "Найти готовый урок",
    to: "/gotovye-uroki",
    styleVariant: "blue",
    Icon: BookOpenCheck,
  },
  {
    id: "tasks",
    title: "Мне нужны задания",
    lead: "Выберите экзамен, тему или номера заданий — соберите вариант за несколько минут.",
    cta: "Создать задания",
    to: "/generator",
    styleVariant: "burgundy",
    Icon: CompassIcon,
  },
  {
    id: "students",
    title: "Хочу вести учеников",
    lead: "Расписание, занятия, домашние задания, журнал и работа с учениками в одном кабинете.",
    cta: "Настроить работу",
    to: "/repetitor",
    styleVariant: "orange",
    Icon: Users,
  },
];

type HomeFirstHeroProps = {
  lessonHref: string;
  freeLimitCaption: string;
  authedTeacher: boolean;
};

function HomeFirstHero({ lessonHref, freeLimitCaption, authedTeacher }: HomeFirstHeroProps) {
  const onlineHref = authedTeacher
    ? ONLINE_LESSON_PATH
    : `/cabinet/login?mode=register&role=teacher&next=${encodeURIComponent(ONLINE_LESSON_PATH)}`;

  return (
    <section className="home-first" aria-labelledby="home-first-heading">
      <div className="home-first__top">
        <SeasonalHeroSticker />
      </div>
      <h1 id="home-first-heading" className="home-first__title">
        Готовьтесь к уроку за минуты, а не часы
      </h1>
      <p className="home-first__lead">
        Готовые уроки, 25 000+ заданий, интерактивы и генератор ОГЭ/ЕГЭ. Проводите занятия, выдавайте домашние работы и проверяйте результаты в одном месте.
      </p>
      <div className="home-first__actions">
        <div className="home-first__action">
          <Link
            to={lessonHref}
            className="home-first__button home-first__button--primary"
            onClick={() => trackHeroClick("lesson")}
          >
            Попробовать готовый урок
          </Link>
          <p className="home-first__caption">Без регистрации</p>
        </div>
        <div className="home-first__action">
          <Link
            to="/subject"
            className="home-first__button home-first__button--secondary"
            onClick={() => trackHeroClick("tasks")}
          >
            Создать вариант ОГЭ/ЕГЭ
          </Link>
          <p className="home-first__caption">Без регистрации</p>
        </div>
        <div className="home-first__action">
          <Link
            to={onlineHref}
            className="home-first__button home-first__button--ghost"
            onClick={() => {
              trackHeroClick("students");
              if (authedTeacher) {
                trackActivationIntent("lesson_creation_started", { source: "home_hero" });
              }
            }}
          >
            Провести онлайн-урок
          </Link>
          {freeLimitCaption ? <p className="home-first__caption">{freeLimitCaption}</p> : null}
        </div>
      </div>
    </section>
  );
}

function HomeValuePathsBlock() {
  return (
    <section className="home-value-paths" aria-labelledby="home-value-paths-heading">
      <h2 id="home-value-paths-heading" className="home-value-paths__heading">
        Что вам нужно сейчас?
      </h2>
      <div className="home-value-paths__grid">
        {HOME_VALUE_PATHS.map((item) => (
          <Link
            key={item.id}
            to={item.to}
            className={`home-value-path home-value-path--${item.styleVariant}`}
            aria-label={`${item.title}. ${item.cta}`}
            onClick={() => trackValueGoal("value_path_selected", { path: item.id })}
          >
            <span className="home-value-path__icon" aria-hidden>
              <item.Icon size={22} strokeWidth={2.1} color="currentColor" />
            </span>
            <span className="home-value-path__body">
              <h3 className="home-value-path__title">{item.title}</h3>
              <p className="home-value-path__lead">{item.lead}</p>
            </span>
            <span className="home-value-path__cta" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.4"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </Link>
        ))}
      </div>
      {SHOW_HOME_SALES ? (
        <p className="home-value-paths__pricing" style={{ margin: "16px 0 0", textAlign: "center", fontWeight: 600 }}>
          <Link to="/pricing">Тарифы и цены — от 0 ₽ →</Link>
        </p>
      ) : null}
    </section>
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
