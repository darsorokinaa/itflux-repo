import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardList, PenLine, Presentation, Search, StickyNote } from "lucide-react";
import AccessGateBadge from "../components/AccessGateBadge";
import CatalogEngagementBar from "../components/CatalogEngagementBar";
import LessonPreviewModal from "../components/LessonPreviewModal";
import TryNowLessons from "../components/TryNowLessons";
import StateView from "../components/StateView";
import { isCatalogLocked } from "../accessGate/accessGate";
import { useAccessGate, useCabinetAuthed } from "../hooks/useAccessGate";
import {
  getLessonCardActionLabel,
  inferLessonIncludes,
  lessonCanPurchase,
  lessonExamLabel,
  lessonFormatLabel,
  lessonHasActiveDemo,
  lessonIsReadyToRun,
  lessonPreviewUrl,
  lessonPurchaseLabel,
} from "../cabinet/lessonCardUtils";
import { CATALOG_ORDERING_OPTIONS } from "../utils/catalogEngagement";
import { purchaseReadyLesson, fetchStudents, fetchScheduleEvents } from "../utils/cabinetAuth";
import { pickTryNowLessons, readRecentLessons } from "../utils/recentLessons";
import { mapApiStudent } from "../cabinet/cabinetMappers";
import { trackValueGoal } from "../utils/valuePath";
import "../styles/material-access.css";

const patternInf = new URL("../assets/subject-patterns/inf.svg", import.meta.url).href;
const patternMath = new URL("../assets/subject-patterns/math.svg", import.meta.url).href;
const patternPhys = new URL("../assets/subject-patterns/phys.svg", import.meta.url).href;
const patternChem = new URL("../assets/subject-patterns/chem.svg", import.meta.url).href;
const patternRus = new URL("../assets/subject-patterns/rus.svg", import.meta.url).href;
const patternLit = new URL("../assets/subject-patterns/lit.svg", import.meta.url).href;
const patternHistory = new URL("../assets/subject-patterns/history.svg", import.meta.url).href;

/** Единый предметный паттерн вместо случайных обложек: цвет + тематический SVG-узор. */
const SUBJECT_THEMES = [
  { test: /информат/i, color: "#32B6C5", pattern: patternInf },
  { test: /математ/i, color: "#2B52F5", pattern: patternMath },
  { test: /физ/i, color: "#4A4FC4", pattern: patternPhys },
  { test: /хими/i, color: "#0F9E76", pattern: patternChem },
  { test: /русск/i, color: "#D8546E", pattern: patternRus },
  { test: /литератур/i, color: "#7D46E3", pattern: patternLit },
  { test: /истори/i, color: "#B45309", pattern: patternHistory },
];
const DEFAULT_SUBJECT_THEME = { color: "#2440B8", pattern: patternInf };

function getSubjectTheme(subjectName) {
  const name = String(subjectName || "");
  return SUBJECT_THEMES.find((theme) => theme.test.test(name)) || DEFAULT_SUBJECT_THEME;
}

const DIFFICULTY_LABELS = {
  beginner: "Начальный",
  medium: "Средний",
  advanced: "Продвинутый",
};

const STATUS_LABELS = {
  draft: "Черновик",
  archived: "Архив",
};

const DURATION_BUCKETS = [
  { id: "short", label: "До 30 мин", test: (m) => m > 0 && m <= 30 },
  { id: "medium", label: "30–45 мин", test: (m) => m > 30 && m <= 45 },
  { id: "long", label: "45–60 мин", test: (m) => m > 45 && m <= 60 },
  { id: "xlong", label: "60+ мин", test: (m) => m > 60 },
];

function durationBucketId(minutes) {
  const value = Number(minutes);
  if (!value) return null;
  const bucket = DURATION_BUCKETS.find((b) => b.test(value));
  return bucket ? bucket.id : null;
}

function formatDuration(minutes) {
  if (!minutes) return null;
  return `${minutes} мин`;
}

function mediaUrl(url) {
  if (!url) return null;
  const idx = url.indexOf("/media/");
  if (idx >= 0) return url.slice(idx);
  return url;
}

const INCLUDE_ICONS = {
  theory: Presentation,
  practice: PenLine,
  interactive: Presentation,
  homework: ClipboardList,
  notes: StickyNote,
};

function LessonCard({ lesson, onEngagementChange, onLockedOpen, onPurchaseLesson }) {
  const subjectTheme = getSubjectTheme(lesson.subject);
  const status = lesson.status || "published";
  const statusLabel = STATUS_LABELS[status];
  const durationLabel = formatDuration(lesson.duration_minutes);
  const difficultyLabel = DIFFICULTY_LABELS[lesson.difficulty];
  const examLabel = lessonExamLabel(lesson);
  const locked = isCatalogLocked(lesson);
  const demoActive = lessonHasActiveDemo(lesson);
  const purchaseAvailable = lessonCanPurchase(lesson);
  const includes = inferLessonIncludes(lesson);
  const readyNow = lessonIsReadyToRun(lesson);
  const canOpenLesson = Boolean(
    lesson.slug && (lesson.archive_url || lesson.file_url || demoActive || locked),
  );
  const actionLabel = locked
    ? "Открыть урок"
    : demoActive
      ? "Продолжить урок"
      : canOpenLesson
        ? "Открыть урок"
        : "Скоро";
  const lessonUrl = lessonPreviewUrl(lesson.slug);
  const priceLabel = purchaseAvailable ? lessonPurchaseLabel(lesson) : "";
  const planName = lesson.access?.required_plan_name || "";

  const coverUrl = mediaUrl(lesson.cover_image_url);

  const handleOpen = (event) => {
    event.preventDefault();
    onLockedOpen?.(lesson);
  };

  const tags = [
    lesson.grade ? `${lesson.grade} класс` : null,
    examLabel || lesson.level || null,
    lesson.topic || null,
    lessonFormatLabel(lesson) || null,
    lesson.task_number ? `Задание ${lesson.task_number}` : null,
    durationLabel,
    difficultyLabel,
  ].filter(Boolean);

  const bannerStyle = coverUrl
    ? {
        backgroundColor: subjectTheme.color,
        backgroundImage: `url("${coverUrl}")`,
        backgroundSize: "cover",
      }
    : {
        backgroundColor: subjectTheme.color,
        backgroundImage: `url("${subjectTheme.pattern}")`,
      };

  return (
    <article className="lesson-card-v3">
      <div
        className={`lesson-card-v3__banner ${coverUrl ? "lesson-card-v3__banner--cover" : ""}`}
        style={bannerStyle}
      >
        {lesson.subject ? (
          <span className="lesson-card-v3__banner-subject">{lesson.subject}</span>
        ) : (
          <span />
        )}
        {statusLabel ? (
          <span className={`lesson-card-v3__status lesson-card-v3__status--${status}`}>
            {statusLabel}
          </span>
        ) : (
          <AccessGateBadge
            minPlan={lesson.access?.min_plan}
            accessLevel={lesson.access_level}
            allowed={lesson.access?.allowed}
          />
        )}
      </div>

      <div className="lesson-card-v3__body">
        {tags.length > 0 ? (
          <div className="lesson-card-v3__tags">
            {tags.map((tag) => (
              <span key={tag} className="lesson-card-v3__tag">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <h3 className="lesson-card-v3__title">{lesson.title}</h3>

        {lesson.short_description ? (
          <p className="lesson-card-v3__desc">{lesson.short_description}</p>
        ) : null}

        {includes.length > 0 ? (
          <div className="lesson-card-v3__includes" aria-label="Что входит в урок">
            {includes.map((item) => {
              const Icon = INCLUDE_ICONS[item.id] || Presentation;
              return (
                <span key={item.id} className="lesson-card-v3__include">
                  <Icon strokeWidth={2} aria-hidden="true" />
                  {item.label}
                </span>
              );
            })}
          </div>
        ) : null}

        {readyNow ? (
          <p className="lesson-card-v3__ready">Можно проводить сразу</p>
        ) : null}

        {priceLabel || (planName && locked) ? (
          <p className="lesson-card-v3__access">
            {priceLabel || null}
            {priceLabel && planName && locked ? " · " : null}
            {planName && locked ? `По тарифу «${planName}»` : null}
          </p>
        ) : null}

        <CatalogEngagementBar
          kind="lessons"
          slug={lesson.slug}
          viewsCount={lesson.views_count}
          likesCount={lesson.likes_count}
          isLiked={lesson.is_liked}
          onChange={(next) => onEngagementChange?.(lesson.slug, next)}
        />

        {locked ? (
          <a href={lessonUrl} className="lesson-card-v3__btn" onClick={handleOpen}>
            Открыть урок
          </a>
        ) : demoActive && purchaseAvailable ? (
          <div className="lesson-card-v3__actions">
            <a
              href={lessonUrl}
              className="lesson-card-v3__btn lesson-card-v3__btn--ghost"
              onClick={handleOpen}
            >
              Продолжить урок
            </a>
            <button
              type="button"
              className="lesson-card-v3__btn lesson-card-v3__btn--purchase"
              onClick={() => onPurchaseLesson?.(lesson)}
            >
              {lessonPurchaseLabel(lesson)}
            </button>
          </div>
        ) : canOpenLesson ? (
          <a
            href={lessonUrl}
            className="lesson-card-v3__btn"
            onClick={handleOpen}
          >
            {actionLabel}
          </a>
        ) : (
          <button type="button" className="lesson-card-v3__btn lesson-card-v3__btn--disabled" disabled>
            {getLessonCardActionLabel(lesson)}
          </button>
        )}
      </div>
    </article>
  );
}

export default function ReadyLessonsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const previewSlug = searchParams.get("preview") || "";
  const demoExpired = searchParams.get("demo_expired") === "1";
  const paymentId = searchParams.get("payment_id") || "";
  const paymentStatus = searchParams.get("status") || "";
  const forEvent = searchParams.get("for_event") || searchParams.get("event") || "";
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("");
  const [grade, setGrade] = useState("");
  const [taskNumber, setTaskNumber] = useState("");
  const [durationFilter, setDurationFilter] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [topic, setTopic] = useState("");
  const [ordering, setOrdering] = useState("newest");
  const authed = useCabinetAuthed();
  const { modal: accessGateModal, openGate } = useAccessGate({ authenticated: authed, sourcePage: "/lessons" });
  const [students, setStudents] = useState([]);
  const [recentTopics, setRecentTopics] = useState([]);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    
    // 1) Fetch active students
    fetchStudents({ status: "active" })
      .then((res) => {
        if (cancelled) return;
        const list = (Array.isArray(res) ? res : res?.results || []).map(mapApiStudent);
        setStudents(list);
      })
      .catch(() => {});
      
    // 2) Fetch upcoming schedule to find relevant topics
    // Getting events from today to +14 days
    const fromStr = new Date().toISOString().split("T")[0];
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + 14);
    const toStr = toDate.toISOString().split("T")[0];
    
    fetchScheduleEvents({ from: fromStr, to: toStr })
      .then((res) => {
        if (cancelled) return;
        const events = Array.isArray(res?.events) ? res.events : [];
        const topics = events
          .map(e => e.topic || e.title) // grab event topic or title
          .filter(Boolean)
          .map(t => t.trim().toLowerCase());
        setRecentTopics(topics);
      })
      .catch(() => {});
      
    return () => {
      cancelled = true;
    };
  }, [authed]);

  const [reloadKey, setReloadKey] = useState(0);
  const reloadLessons = useCallback(() => setReloadKey((k) => k + 1), []);

  const handleEngagementChange = useCallback((slug, next) => {
    setLessons((prev) =>
      prev.map((item) =>
        item.slug === slug
          ? {
              ...item,
              views_count: next.views_count,
              likes_count: next.likes_count,
              is_liked: next.is_liked,
            }
          : item,
      ),
    );
  }, []);

  const handleLockedOpen = useCallback((lesson) => {
    if (!lesson?.slug) return;
    trackValueGoal("lesson_card_opened", { lesson_id: String(lesson.id || lesson.slug) });
    const next = new URLSearchParams(searchParams);
    next.set("preview", lesson.slug);
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);

  const handlePurchaseLesson = useCallback(async (lesson) => {
    if (!lesson?.slug) return;
    if (!authed) {
      handleLockedOpen(lesson);
      return;
    }
    try {
      const result = await purchaseReadyLesson(lesson.slug, `les-${lesson.id}-${Date.now()}`);
      if (result?.payment_url) {
        window.location.href = result.payment_url;
        return;
      }
      reloadLessons();
    } catch {
      handleLockedOpen(lesson);
    }
  }, [authed, handleLockedOpen, reloadLessons]);

  const closePreview = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("preview");
    next.delete("demo_expired");
    next.delete("payment_id");
    next.delete("status");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams();
    if (ordering && ordering !== "newest") qs.set("ordering", ordering);
    const url = qs.toString() ? `/api/lessons/?${qs}` : "/api/lessons/";

    fetch(url, { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error("Не удалось загрузить каталог уроков");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setLessons(Array.isArray(data?.lessons) ? data.lessons : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
        setLessons([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey, ordering]);

  useEffect(() => {
    trackValueGoal("lesson_catalog_opened");
  }, []);

  const subjectOptions = useMemo(() => {
    const values = new Set();
    for (const lesson of lessons) {
      if (lesson.subject) values.add(lesson.subject);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "ru"));
  }, [lessons]);

  const levelOptions = useMemo(() => {
    const values = new Set();
    for (const lesson of lessons) {
      const exam = lessonExamLabel(lesson);
      if (exam) values.add(exam);
      if (lesson.level) values.add(lesson.level);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "ru"));
  }, [lessons]);

  const gradeOptions = useMemo(() => {
    const values = new Set();
    for (const lesson of lessons) {
      if (lesson.grade) values.add(String(lesson.grade));
    }
    return Array.from(values).sort((a, b) => Number(a) - Number(b));
  }, [lessons]);

  const taskNumberOptions = useMemo(() => {
    const values = new Set();
    for (const lesson of lessons) {
      if (lesson.task_number) values.add(String(lesson.task_number));
    }
    return Array.from(values).sort((a, b) => Number(a) - Number(b));
  }, [lessons]);

  const topicOptions = useMemo(() => {
    const values = new Set();
    for (const lesson of lessons) {
      if (lesson.topic) values.add(lesson.topic);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "ru"));
  }, [lessons]);

  const filteredLessons = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lessons.filter((lesson) => {
      if (subject && lesson.subject !== subject) return false;
      if (level) {
        const exam = lessonExamLabel(lesson);
        if (lesson.level !== level && exam !== level) return false;
      }
      if (topic && lesson.topic !== topic) return false;
      if (grade && String(lesson.grade) !== grade) return false;
      if (taskNumber && String(lesson.task_number) !== taskNumber) return false;
      if (durationFilter && durationBucketId(lesson.duration_minutes) !== durationFilter) return false;
      if (difficulty && lesson.difficulty !== difficulty) return false;
      if (!q) return true;
      const haystack = [
        lesson.title,
        lesson.topic,
        lesson.subtopic,
        lesson.short_description,
        lesson.subject,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [lessons, search, subject, level, topic, grade, taskNumber, durationFilter, difficulty]);

  const resetFilters = () => {
    setSearch("");
    setSubject("");
    setLevel("");
    setTopic("");
    setGrade("");
    setTaskNumber("");
    setDurationFilter("");
    setDifficulty("");
  };

  const hasActiveFilters = Boolean(
    search || subject || level || topic || grade || taskNumber || durationFilter || difficulty
  );

  const recentLessons = useMemo(() => {
    const slugs = new Set(readRecentLessons().map((row) => row.slug));
    return lessons.filter((lesson) => slugs.has(lesson.slug)).slice(0, 4);
  }, [lessons]);

  const tryNowLessons = useMemo(() => {
    // If we have students, pickTryNowLessons will use them. Otherwise fallback to preferredSubject
    const preferredSubject = subject || readRecentLessons()[0]?.subject || "";
    return pickTryNowLessons(lessons, { subject: preferredSubject, students, recentTopics, limit: 6 });
  }, [lessons, subject, students, recentTopics]);

  useEffect(() => {
    const duration = searchParams.get("duration") || "";
    const exam = searchParams.get("exam") || "";
    if (duration) setDurationFilter(duration);
    if (exam) setLevel(exam);
  }, [searchParams]);

  const applySituation = (chip) => {
    if (chip.to) {
      navigate(chip.to);
      return;
    }
    if (chip.duration) setDurationFilter(chip.duration);
    if (chip.exam) setLevel(chip.exam);
  };

  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <main className="lessons-page">
          <section className="lessons-hero-v3">
            <h1 className="lessons-hero-v3__title">Не тратить вечер на подготовку к уроку</h1>
            <p className="lessons-hero-v3__lead">
              Урок уже собран: теория, практика и ДЗ в одном материале. Откройте и используйте на ближайшем занятии.
            </p>
          </section>

          {authed && recentLessons.length ? (
            <section className="lessons-recent" aria-label="Недавно смотрели">
              <h2 className="lessons-recent__title">Недавно смотрели</h2>
              <div className="lessons-recent__list">
                {recentLessons.map((lesson) => (
                  <button
                    key={lesson.slug}
                    type="button"
                    className="lessons-recent__item"
                    onClick={() => handleLockedOpen(lesson)}
                  >
                    {lesson.title}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {tryNowLessons.length ? (
            <TryNowLessons lessons={tryNowLessons} onOpen={handleLockedOpen} />
          ) : null}

          <div className="lessons-situations" aria-label="Быстрый выбор">
            {[
              { id: "60", label: "Урок на 45–60 минут", duration: "long" },
              { id: "interesting", label: "Интересное", to: "/interesting" },
              { id: "oge", label: "ОГЭ", exam: "ОГЭ" },
              { id: "ege", label: "ЕГЭ", exam: "ЕГЭ" },
            ].map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="lessons-situation"
                onClick={() => applySituation(chip)}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <section className="lessons-toolbar" aria-label="Поиск и фильтры каталога">
            <label className="lessons-search">
              <Search className="lessons-search__icon" size={18} strokeWidth={2.2} aria-hidden="true" />
              <input
                type="search"
                className="lessons-search__input"
                placeholder="Название, тема, подтема"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>

            <details className="lessons-filters-disclosure">
              <summary className="lessons-filters-disclosure__summary">Фильтры</summary>
            <div className="lessons-filters-grid">
              <label className="lessons-filter">
                <span className="lessons-filter__label">Предмет</span>
                <select
                  className="lessons-filter__control"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  <option value="">Все</option>
                  {subjectOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="lessons-filter">
                <span className="lessons-filter__label">Класс</span>
                <select
                  className="lessons-filter__control"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                >
                  <option value="">Все</option>
                  {gradeOptions.map((value) => (
                    <option key={value} value={value}>
                      {value} класс
                    </option>
                  ))}
                </select>
              </label>

              <label className="lessons-filter">
                <span className="lessons-filter__label">Экзамен</span>
                <select
                  className="lessons-filter__control"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                >
                  <option value="">Все</option>
                  {levelOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="lessons-filter">
                <span className="lessons-filter__label">Тема</span>
                <select
                  className="lessons-filter__control"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                >
                  <option value="">Все</option>
                  {topicOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="lessons-filter">
                <span className="lessons-filter__label">Номер задания</span>
                <select
                  className="lessons-filter__control"
                  value={taskNumber}
                  onChange={(e) => setTaskNumber(e.target.value)}
                >
                  <option value="">Все</option>
                  {taskNumberOptions.map((value) => (
                    <option key={value} value={value}>
                      №{value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="lessons-filter">
                <span className="lessons-filter__label">Длительность</span>
                <select
                  className="lessons-filter__control"
                  value={durationFilter}
                  onChange={(e) => setDurationFilter(e.target.value)}
                >
                  <option value="">Любая</option>
                  {DURATION_BUCKETS.map((bucket) => (
                    <option key={bucket.id} value={bucket.id}>
                      {bucket.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="lessons-filter">
                <span className="lessons-filter__label">Уровень</span>
                <select
                  className="lessons-filter__control"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                >
                  <option value="">Все</option>
                  <option value="beginner">Начальный</option>
                  <option value="medium">Средний</option>
                  <option value="advanced">Продвинутый</option>
                </select>
              </label>

              <label className="lessons-filter">
                <span className="lessons-filter__label">Сортировка</span>
                <select
                  className="lessons-filter__control"
                  value={ordering}
                  onChange={(e) => setOrdering(e.target.value)}
                >
                  {CATALOG_ORDERING_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            </details>

            {hasActiveFilters ? (
              <div className="lessons-toolbar__footer">
                <button type="button" className="lessons-reset-btn" onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              </div>
            ) : null}
          </section>

          <section className="lessons-library-v3">
            <header className="lessons-library-v3__head">
              <h2 className="lessons-library-v3__title">Каталог уроков</h2>
              <p className="lessons-library-v3__meta">
                Найдено: <strong>{filteredLessons.length}</strong>
              </p>
            </header>

            {loading ? (
              <StateView variant="loading" title="Загружаем каталог" description="Это займёт пару секунд." />
            ) : error ? (
              <StateView
                variant="error"
                title="Не удалось загрузить уроки"
                description="Проверьте соединение и попробуйте ещё раз."
                action={
                  <button type="button" className="state-view__btn" onClick={reloadLessons}>
                    Повторить
                  </button>
                }
              />
            ) : filteredLessons.length === 0 ? (
              lessons.length === 0 ? (
                <StateView
                  variant="empty"
                  title="Пока нет уроков"
                  description="Опубликованные уроки появятся здесь, как только их добавят."
                />
              ) : (
                <StateView
                  variant="search"
                  title="Ничего не найдено"
                  description="По выбранным фильтрам уроков нет. Попробуйте смягчить условия."
                  action={
                    hasActiveFilters ? (
                      <button type="button" className="state-view__btn state-view__btn--ghost" onClick={resetFilters}>
                        Сбросить фильтры
                      </button>
                    ) : null
                  }
                />
              )
            ) : (
              <div className="lessons-library-v3__grid">
                {filteredLessons.map((lesson) => (
                  <LessonCard
                    key={lesson.slug || lesson.id}
                    lesson={lesson}
                    onEngagementChange={handleEngagementChange}
                    onLockedOpen={handleLockedOpen}
                    onPurchaseLesson={handlePurchaseLesson}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
      {accessGateModal}
      <LessonPreviewModal
        open={Boolean(previewSlug)}
        slug={previewSlug}
        onClose={closePreview}
        demoExpired={demoExpired}
        paymentId={paymentId}
        paymentStatus={paymentStatus}
        catalogLessons={lessons}
        forEventId={forEvent}
      />
    </div>
  );
}
