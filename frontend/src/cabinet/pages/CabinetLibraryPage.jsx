import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import CabinetIcon from "../CabinetIcons";
import CabinetHomeworkCard from "../CabinetHomeworkCard";
import {
  getLessonOpenUrl,
  libraryLessonMatchesFilter,
  mapLessonToHomeworkCard,
} from "../lessonCardUtils";
import {
  CabinetPageShell,
  CabinetPageHeader,
  CabinetFilterBar,
  CabinetEmptyState,
  useSoonToast,
} from "../CabinetSectionUi";
import { fetchLibraryNewThisMonth } from "../../utils/cabinetAuth";

const SECTIONS = [
  { id: "lessons", label: "Готовые уроки", icon: "lessons", href: "/lessons" },
  { id: "tasks", label: "Банк задач", icon: "tasks", href: "/tasks" },
];

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
  { id: "python", label: "Python" },
  { id: "fipi", label: "ФИПИ" },
];

export default function CabinetLibraryPage() {
  const [section, setSection] = useState("lessons");
  const [filter, setFilter] = useState("all");
  const [catalogLessons, setCatalogLessons] = useState([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsError, setLessonsError] = useState(null);
  const [newItems, setNewItems] = useState([]);
  const { notifySoon, toast } = useSoonToast();

  useEffect(() => {
    fetchLibraryNewThisMonth()
      .then((data) => setNewItems(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setNewItems([]));
  }, []);

  const loadCatalogLessons = useCallback(() => {
    setLessonsLoading(true);
    setLessonsError(null);
    fetch("/api/lessons/", { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error("Не удалось загрузить каталог уроков");
        return res.json();
      })
      .then((data) => {
        setCatalogLessons(Array.isArray(data?.lessons) ? data.lessons : []);
      })
      .catch((err) => {
        setCatalogLessons([]);
        setLessonsError(err?.message || "Ошибка загрузки");
      })
      .finally(() => setLessonsLoading(false));
  }, []);

  useEffect(() => {
    if (section === "lessons") loadCatalogLessons();
  }, [section, loadCatalogLessons]);

  const lessonCards = useMemo(
    () => catalogLessons
      .filter((lesson) => libraryLessonMatchesFilter(lesson, filter))
      .map(mapLessonToHomeworkCard),
    [catalogLessons, filter],
  );

  const handleOpenLesson = useCallback((card) => {
    const url = getLessonOpenUrl(card.lesson);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    notifySoon();
  }, [notifySoon]);

  const showLessonCatalog = section === "lessons";

  return (
    <CabinetPageShell className="cb-section--library">
      {toast}
      <CabinetPageHeader title="Библиотека" />

      {newItems.length > 0 ? (
        <section className="cb-library-new" aria-labelledby="library-new-title">
          <h2 id="library-new-title" className="cb-page-hint" style={{ fontWeight: 700 }}>
            Новое в этом месяце
          </h2>
          <ul className="cb-library-new__list">
            {newItems.slice(0, 8).map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <span>{item.title}</span>
                {!item.allowed ? (
                  <Link to="/pricing" className="cb-btn cb-btn--outline cb-btn--sm">
                    от {item.min_plan || "тарифа"}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="cb-library-sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`cb-library-section${section === s.id ? " cb-library-section--active" : ""}`}
            onClick={() => setSection(s.id)}
          >
            <CabinetIcon name={s.icon} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <div className="cb-tool-bar">
        <CabinetFilterBar filters={FILTERS} active={filter} onChange={setFilter} />
        <div className="cb-tool-bar__actions">
          {showLessonCatalog ? (
            <Link to="/lessons" className="cb-btn cb-btn--outline cb-btn--sm">Каталог на сайте</Link>
          ) : (
            <Link to="/tasks" className="cb-btn cb-btn--outline cb-btn--sm">Поиск по ID</Link>
          )}
          <Link to="/generator" className="cb-btn cb-btn--primary cb-btn--sm">Создать вариант</Link>
        </div>
      </div>

      {showLessonCatalog ? (
        lessonsLoading ? (
          <p className="cb-page-hint">Загрузка готовых уроков…</p>
        ) : lessonsError ? (
          <CabinetEmptyState
            icon="folder"
            title="Не удалось загрузить уроки"
            text={lessonsError}
            actions={[
              { label: "Повторить", primary: true, onClick: loadCatalogLessons },
            ]}
          />
        ) : lessonCards.length === 0 ? (
          <CabinetEmptyState
            icon="lessons"
            title="Уроки не найдены"
            text="Измените фильтры или добавьте материалы в каталог."
          />
        ) : (
          <div className="cb-hw-grid">
            {lessonCards.map((item) => (
              <CabinetHomeworkCard
                key={item.id}
                coverImageUrl={item.coverImageUrl}
                coverBgColor={item.coverBgColor}
                deadlineLabel={item.deadlineLabel}
                deadlineTone={item.deadlineTone}
                subject={item.subject}
                title={item.title}
                description={item.description}
                progressLabel={item.progressLabel}
                hideProgressBar={item.hideProgressBar}
                actionLabel={item.actionLabel}
                actionPrimary={item.actionPrimary}
                onAction={() => handleOpenLesson(item)}
              />
            ))}
          </div>
        )
      ) : (
        <CabinetEmptyState
          icon="tasks"
          title="Банк задач"
          text="Откройте банк заданий ОГЭ и ЕГЭ: поиск по номеру, теме и типу — с готовыми решениями и вариантами для учеников."
          actions={[
            { label: "Перейти в банк задач", primary: true, href: "/tasks" },
          ]}
        />
      )}

    </CabinetPageShell>
  );
}
