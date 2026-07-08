import { useEffect, useMemo, useState } from "react";
import TaskSearchPanel from "../components/TaskSearchPanel";
import GeneratorCategoryCard from "../components/GeneratorCategoryCard";
import StepIndicator from "../components/StepIndicator";
import { formatTasksCount } from "../utils/formatTasksCount";
import "../styles/tool-workspace.css";

const GENERATOR_LEVELS = [
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
    id: "vpr",
    title: "Школьная база",
    classLabel: "7-10 класс",
    lead: "Базовые темы и задания для регулярной учебной практики.",
    fallbackCount: 184,
    to: "/subject/vpr",
  },
];

export default function GeneratorHubPage() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const loadStats = async () => {
      try {
        const overviewRes = await fetch("/api/generator/overview/", {
          credentials: "same-origin",
        });
        if (overviewRes.ok) {
          const payload = await overviewRes.json();
          if (!cancelled) {
            setStats(payload);
          }
          return;
        }
      } catch {
        // fallback to legacy endpoint below
      }

      try {
        const legacyRes = await fetch("/api/platform-stats/", {
          credentials: "same-origin",
        });
        const payload = legacyRes.ok ? await legacyRes.json() : null;
        if (!cancelled) {
          setStats(payload);
        }
      } catch {
        if (!cancelled) {
          setStats(null);
        }
      }
    };

    loadStats();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(
    () =>
      GENERATOR_LEVELS.map((level) => {
        const count = stats?.tasks_by_level?.[level.id];
        const tasksLabel = typeof count === "number" && count > 0
          ? formatTasksCount(count)
          : formatTasksCount(level.fallbackCount);
        return {
          ...level,
          tasksLabel,
        };
      }),
    [stats],
  );

  const steps = [
    { title: "Выбери направление", caption: "ОГЭ, ЕГЭ или школьная база" },
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

          <TaskSearchPanel className="generator-tool-page__search" />
        </main>
      </div>
    </div>
  );
}
