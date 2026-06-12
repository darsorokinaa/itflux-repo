import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import StateView from "../components/StateView";

const DIFFICULTY_LABELS = {
  beginner: "Начальный",
  medium: "Средний",
  advanced: "Продвинутый",
};

const STATUS_LABELS = {
  published: "Опубликован",
  draft: "Черновик",
  archived: "Архив",
};

function pickTheme(lesson) {
  const topic = `${lesson.topic || ""} ${lesson.subtopic || ""}`.toLowerCase();
  if (topic.includes("таблиц")) return "tables";
  if (topic.includes("алгоритм")) return "algorithms";
  if (topic.includes("логик")) return "logic";
  if (topic.includes("код") || topic.includes("программ")) return "code";
  if (lesson.exam_type === "oge") return "oge";
  return "coding";
}

function formatClassLabel(lesson) {
  if (lesson.grade) return `${lesson.grade} класс`;
  if (lesson.level) return lesson.level;
  return "—";
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

function LessonCard({ lesson }) {
  const theme = pickTheme(lesson);
  const status = lesson.status || "published";
  const statusLabel = STATUS_LABELS[status] || status;
  const durationLabel = formatDuration(lesson.duration_minutes);
  const difficultyLabel = DIFFICULTY_LABELS[lesson.difficulty] || lesson.difficulty;
  const coverUrl = mediaUrl(lesson.cover_image_url);
  const cardBgImageUrl = mediaUrl(lesson.card_background_image_url);
  const cardBgColor = lesson.card_background_color;
  const canOpenLesson = Boolean(lesson.slug && (lesson.archive_url || lesson.file_url));
  const fileExtLower = (lesson.file_url || "").toLowerCase().split("?")[0];
  const isReactViewer = Boolean(
    !lesson.archive_url && 
    lesson.file_url && 
    !fileExtLower.endsWith(".html")
  );
  const lessonUrl = isReactViewer
    ? `/lessons/${encodeURIComponent(lesson.slug)}/view`
    : `/api/lessons/${encodeURIComponent(lesson.slug)}/view/`;

  const cardStyle = {};
  if (cardBgImageUrl) {
    cardStyle.backgroundImage = `url(${cardBgImageUrl})`;
    cardStyle.backgroundSize = "contain";
    cardStyle.backgroundRepeat = "no-repeat";
    cardStyle.backgroundPosition = "center";
  } else if (cardBgColor) {
    cardStyle.backgroundColor = cardBgColor;
  }

  return (
    <article className={`lesson-card-v3 lesson-card-v3--${theme}`} style={cardStyle}>
      <div className="lesson-card-v3__layout">
        <div className="lesson-card-v3__content">
          <div className="lesson-card-v3__top">
            <span className="lesson-card-v3__class">{formatClassLabel(lesson)}</span>
            {status !== "published" ? (
              <span className={`lesson-card-v3__status lesson-card-v3__status--${status}`}>
                {statusLabel}
              </span>
            ) : null}
          </div>

          <h2 className="lesson-card-v3__title">{lesson.title}</h2>

          {lesson.short_description ? (
            <p className="lesson-card-v3__desc">{lesson.short_description}</p>
          ) : null}

          {lesson.topic ? (
            <span className="lesson-card-v3__format">{lesson.topic}</span>
          ) : null}

          <div className="lesson-card-v3__meta">
            {lesson.subject ? <span>{lesson.subject}</span> : null}
            {lesson.task_number ? <span>Задание {lesson.task_number}</span> : null}
            {durationLabel ? <span>{durationLabel}</span> : null}
            {difficultyLabel ? <span>{difficultyLabel}</span> : null}
          </div>

          <div className="lesson-card-v3__actions">
            {canOpenLesson ? (
              <a
                href={lessonUrl}
                className="lesson-card-v3__btn lesson-card-v3__btn--primary"
                target="_blank"
                rel="noopener noreferrer"
              >
                Открыть урок
              </a>
            ) : (
              <button type="button" className="lesson-card-v3__btn lesson-card-v3__btn--primary" disabled>
                Скоро
              </button>
            )}
          </div>
        </div>

        <div className="lesson-card-v3__preview" aria-hidden="true">
          {coverUrl ? (
            <div className="lesson-card-v3__preview-card lesson-card-v3__preview-card--cover">
              <img
                src={coverUrl}
                alt=""
                className="lesson-card-v3__cover-image"
                loading="lazy"
                decoding="async"
              />
            </div>
          ) : (
            <div className="lesson-card-v3__preview-card lesson-card-v3__preview-card--front">
              <span className="lesson-card-v3__topic-icon">
                <BookOpen strokeWidth={2.2} />
              </span>
              <div className="lesson-card-v3__preview-body">
                <span className="lesson-card-v3__preview-title">{lesson.title}</span>
                {lesson.subtopic ? (
                  <span className="lesson-card-v3__preview-meta">{lesson.subtopic}</span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function ReadyLessonsPage() {
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("");
  const [grade, setGrade] = useState("");
  const [difficulty, setDifficulty] = useState("");

  const [reloadKey, setReloadKey] = useState(0);
  const reloadLessons = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/lessons/", { credentials: "same-origin" })
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
  }, [reloadKey]);

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

  const filteredLessons = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lessons.filter((lesson) => {
      if (subject && lesson.subject !== subject) return false;
      if (level && lesson.level !== level) return false;
      if (grade && String(lesson.grade) !== grade) return false;
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
  }, [lessons, search, subject, level, grade, difficulty]);

  const resetFilters = () => {
    setSearch("");
    setSubject("");
    setLevel("");
    setGrade("");
    setDifficulty("");
  };

  const hasActiveFilters = Boolean(search || subject || level || grade || difficulty);

  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <main className="lessons-page">
          <section className="lessons-hero-v3">
            <h1 className="lessons-hero-v3__title">Готовые уроки</h1>
            <p className="lessons-hero-v3__lead">
              Каталог готовых материалов для уроков информатики: теория, практика и домашние задания
              для ОГЭ и ЕГЭ.
            </p>
          </section>

          <section className="lessons-filters lessons-filters--catalog" aria-label="Фильтры каталога">
            <label className="lessons-filter lessons-filter--search">
              <span className="lessons-filter__label">Поиск</span>
              <input
                type="search"
                className="lessons-filter__control"
                placeholder="Название, тема, подтема"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>

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
              <span className="lessons-filter__label">Уровень</span>
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
              <span className="lessons-filter__label">Сложность</span>
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
          </section>

          <section className="lessons-library-v3">
            <header className="lessons-library-v3__head">
              <h2 className="lessons-library-v3__title">Каталог уроков</h2>
              <p className="lessons-library-v3__meta">
                Найдено: <strong>{filteredLessons.length}</strong>
                {hasActiveFilters ? (
                  <>
                    {" "}
                    ·{" "}
                    <button
                      type="button"
                      className="lesson-card-v3__btn lesson-card-v3__btn--ghost"
                      onClick={resetFilters}
                    >
                      Сбросить фильтры
                    </button>
                  </>
                ) : null}
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
                  <LessonCard key={lesson.slug || lesson.id} lesson={lesson} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
