import { useEffect, useMemo, useState } from "react";
import GeneratorCategoryCard from "../components/GeneratorCategoryCard";
import StepIndicator from "../components/StepIndicator";
import { getLevelDef, levelLabel } from "../data/levels";
import { formatTasksCount } from "../utils/formatTasksCount";
import "../styles/tool-workspace.css";

const FALLBACK_LEVELS = [
  {
    id: "oge",
    title: "ОГЭ",
    classLabel: "9 класс",
    lead: "Тренировочные варианты с заданиями в экзаменационном формате.",
    fallbackCount: 312,
    to: "/subject/oge",
  },
  {
    id: "ege",
    title: "ЕГЭ",
    classLabel: "11 класс",
    lead: "Сценарии для системной подготовки и отработки сложных тем.",
    fallbackCount: 278,
    to: "/subject/ege",
  },
  {
    id: "school",
    title: "Школьная программа",
    classLabel: "5-11 класс",
    lead: "Программирование и курсы школьной программы.",
    fallbackCount: 40,
    to: "/subject/school",
  },
  {
    id: "vpr",
    title: "ВПР",
    classLabel: "7-10 класс",
    lead: "Базовые темы и задания для регулярной учебной практики.",
    fallbackCount: 184,
    to: "/subject/vpr",
  },
];

export default function GeneratorHubPage() {
  const [stats, setStats] = useState(null);
  const [levels, setLevels] = useState(FALLBACK_LEVELS);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const overviewRes = await fetch("/api/generator/overview/", {
          credentials: "same-origin",
        });
        if (overviewRes.ok) {
          const payload = await overviewRes.json();
          if (!cancelled) {
            setStats(payload);
            const apiLevels = Array.isArray(payload?.levels) ? payload.levels : [];
            if (apiLevels.length) {
              setLevels(
                apiLevels.map((item) => {
                  const id = String(item?.id || "").trim().toLowerCase();
                  const def = getLevelDef(id);
                  const fallback = FALLBACK_LEVELS.find((row) => row.id === id);
                  return {
                    id,
                    title: String(item?.title || "").trim() || levelLabel(id, fallback?.title || id),
                    classLabel: def?.stripLabel || fallback?.classLabel || "",
                    lead: def?.description || fallback?.lead || "Задания и варианты для выбранного уровня.",
                    fallbackCount: def?.fallbackTaskCount || fallback?.fallbackCount || 0,
                    to: `/subject/${id}`,
                  };
                }),
              );
            }
          }
          return;
        }
      } catch {
        // fallback below
      }

      try {
        const [catalogRes, legacyRes] = await Promise.all([
          fetch("/api/catalog/", { credentials: "same-origin" }),
          fetch("/api/platform-stats/", { credentials: "same-origin" }),
        ]);
        const catalogPayload = catalogRes.ok ? await catalogRes.json() : null;
        const statsPayload = legacyRes.ok ? await legacyRes.json() : null;
        if (cancelled) return;
        setStats(statsPayload);
        const rows = Array.isArray(catalogPayload?.catalog) ? catalogPayload.catalog : [];
        if (rows.length) {
          setLevels(
            rows.map((row) => {
              const id = String(row?.level || "").trim().toLowerCase();
              const def = getLevelDef(id);
              const fallback = FALLBACK_LEVELS.find((item) => item.id === id);
              return {
                id,
                title: String(row?.level_rus || "").trim() || levelLabel(id, fallback?.title || id),
                classLabel: def?.stripLabel || fallback?.classLabel || "",
                lead: def?.description || fallback?.lead || "Задания и варианты для выбранного уровня.",
                fallbackCount: def?.fallbackTaskCount || fallback?.fallbackCount || 0,
                to: `/subject/${id}`,
              };
            }),
          );
        }
      } catch {
        if (!cancelled) {
          setStats(null);
          setLevels(FALLBACK_LEVELS);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(
    () =>
      levels.map((level) => {
        const count = stats?.tasks_by_level?.[level.id];
        const tasksLabel = typeof count === "number" && count > 0
          ? formatTasksCount(count)
          : formatTasksCount(level.fallbackCount);
        return {
          ...level,
          tasksLabel,
        };
      }),
    [levels, stats],
  );

  const steps = [
    { title: "Выбери направление", caption: "Уровень подготовки из базы" },
    { title: "Выбери предмет", caption: "Подходящий курс подготовки" },
    { title: "Настрой вариант", caption: "Темы, объём и сложность" },
    { title: "Начни решать", caption: "Результат и разбор ошибок" },
  ];

  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <main className="generator-tool-page">
          <header className="generator-tool-page__header">
            <span className="generator-tool-page__badge">Инструмент подготовки</span>
            <h1 className="generator-tool-page__title">Генератор вариантов</h1>
            <p className="generator-tool-page__lead">
              Соберите тренировочный вариант под свой уровень, предмет и формат.
            </p>
          </header>

          <StepIndicator items={steps} activeIndex={0} />

          <section className="generator-tool-page__section" aria-labelledby="generator-levels-title">
            <div className="generator-tool-page__section-head">
              <h2 id="generator-levels-title">Выбор направления</h2>
              <p>Начните с формата подготовки — дальше система покажет доступные предметы.</p>
            </div>
            <div className="generator-tool-page__grid">
              {cards.map((level) => (
                <GeneratorCategoryCard
                  key={level.id}
                  id={level.id}
                  title={level.title}
                  classLabel={level.classLabel}
                  description={level.lead}
                  tasksLabel={level.tasksLabel}
                  to={level.to}
                />
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
