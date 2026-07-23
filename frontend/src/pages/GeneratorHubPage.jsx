import { useEffect, useMemo, useState } from "react";
import GeneratorCategoryCard from "../components/GeneratorCategoryCard";
import StepIndicator from "../components/StepIndicator";
import { getLevelDef, levelLabel } from "../data/levels";
import { fetchExamCatalog } from "../utils/examCatalog";
import { formatTasksCount } from "../utils/formatTasksCount";
import "../styles/tool-workspace.css";

export default function GeneratorHubPage() {
  const [stats, setStats] = useState(null);
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);

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
                  return {
                    id,
                    title: String(item?.title || "").trim() || levelLabel(id, id),
                    classLabel: def?.stripLabel || "",
                    lead: def?.description || "Задания и варианты для выбранного уровня.",
                    fallbackCount: Number(item?.tasks_count) || def?.fallbackTaskCount || 0,
                    to: `/subject/${id}`,
                  };
                }),
              );
              setLoading(false);
              return;
            }
          }
        }
      } catch {
        // fallback below
      }

      try {
        const [catalogRows, legacyRes] = await Promise.all([
          fetchExamCatalog(),
          fetch("/api/platform-stats/", { credentials: "same-origin" }),
        ]);
        const statsPayload = legacyRes.ok ? await legacyRes.json() : null;
        if (cancelled) return;
        setStats(statsPayload);
        setLevels(
          catalogRows.map((row) => {
            const def = getLevelDef(row.id);
            return {
              id: row.id,
              title: row.label || levelLabel(row.id, row.id),
              classLabel: def?.stripLabel || "",
              lead: def?.description || "Задания и варианты для выбранного уровня.",
              fallbackCount: def?.fallbackTaskCount || 0,
              to: `/subject/${row.id}`,
            };
          }),
        );
      } catch {
        if (!cancelled) {
          setStats(null);
          setLevels([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
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
            {loading ? (
              <p className="generator-tool-page__empty">Загрузка уровней…</p>
            ) : cards.length === 0 ? (
              <p className="generator-tool-page__empty">Уровни пока не добавлены в базу.</p>
            ) : (
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
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
