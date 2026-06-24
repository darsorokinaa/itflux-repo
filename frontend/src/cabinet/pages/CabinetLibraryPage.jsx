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
  CabinetSectionGrid,
  CabinetEmptyState,
  useSoonToast,
} from "../CabinetSectionUi";

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

const MATERIALS = [
  {
    id: "m1", filter: ["all", "oge", "fipi"],
    title: "Алгебра логики — готовый урок",
    type: "Готовый урок", exam: "ОГЭ",
    topic: "Логика и алгоритмы",
    inside: "Теория · 12 заданий · тетрадь",
  },
  {
    id: "m2", filter: ["all", "ege"],
    title: "Задание 14 — системы счисления",
    type: "Банк задач", exam: "ЕГЭ",
    topic: "Системы счисления",
    inside: "3 уровня сложности · решения",
  },
];

export default function CabinetLibraryPage() {
  const [section, setSection] = useState("lessons");
  const [filter, setFilter] = useState("all");
  const [catalogLessons, setCatalogLessons] = useState([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonsError, setLessonsError] = useState(null);
  const { notifySoon, toast } = useSoonToast();

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

  const materials = useMemo(
    () => MATERIALS.filter((m) => m.filter.includes(filter)),
    [filter],
  );

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
      ) : materials.length === 0 ? (
        <CabinetEmptyState
          icon="folder"
          title="Материалы не найдены"
          text="Измените фильтры или попробуйте другой запрос."
        />
      ) : (
        <CabinetSectionGrid columns="2">
          {materials.map((m) => (
            <article key={m.id} className="cb-material-card">
              <div className="cb-material-card__head">
                <span className="cb-status-badge cb-status-badge--info">{m.type}</span>
                <span className="cb-status-badge cb-status-badge--gray">{m.exam}</span>
              </div>
              <h3 className="cb-material-card__title">{m.title}</h3>
              <p className="cb-material-card__topic">{m.topic}</p>
              <div className="cb-material-card__actions">
                {section === "tasks" ? (
                  <Link to="/tasks" className="cb-btn cb-btn--outline cb-btn--sm">Открыть</Link>
                ) : (
                  <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={notifySoon}>Открыть</button>
                )}
                <button type="button" className="cb-btn cb-btn--outline cb-btn--sm" onClick={notifySoon}>Сохранить себе</button>
                <button type="button" className="cb-btn cb-btn--primary cb-btn--sm" onClick={notifySoon}>Выдать ученикам</button>
              </div>
            </article>
          ))}
        </CabinetSectionGrid>
      )}

    </CabinetPageShell>
  );
}
