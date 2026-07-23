import { useEffect, useState } from "react";
import { getLevelDef, levelLabel } from "../data/levels";
import { fetchExamCatalog } from "../utils/examCatalog";

function LevelSelector({ onNavigate }) {
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchExamCatalog()
      .then((rows) => {
        if (cancelled) return;
        setLevels(
          rows.map((row) => {
            const def = getLevelDef(row.id);
            return {
              id: row.id,
              title: row.label || levelLabel(row.id, row.id),
              grade: def?.stripLabel || "",
              description: def?.description || "Задания и варианты для выбранного уровня.",
              route: `/subject/${row.id}`,
            };
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setLevels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="level-selector" className="index-levels" aria-label="Выбор уровня подготовки">
      <h2 className="index-levels-section-title">Выберите уровень подготовки</h2>
      {loading ? (
        <p className="index-levels-empty">Загрузка уровней…</p>
      ) : levels.length === 0 ? (
        <p className="index-levels-empty">Уровни пока не добавлены в базу.</p>
      ) : (
        <div className="index-level-pick-grid">
          {levels.map((level) => (
            <article
              key={level.id}
              className={`index-level-pick-card index-level-pick-card--${level.id}`}
            >
              <div className="index-level-pick-side" aria-hidden>
                <span className="index-level-pick-side-text">{level.grade || level.title}</span>
              </div>
              <div className="index-level-pick-main">
                <div className="index-level-pick-main-inner">
                  <h3 className="index-level-pick-title">{level.title}</h3>
                  <p className="index-level-pick-desc">{level.description}</p>
                  <button
                    type="button"
                    className="index-level-pick-btn"
                    onClick={() => onNavigate?.(level.route)}
                  >
                    Перейти →
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default LevelSelector;
