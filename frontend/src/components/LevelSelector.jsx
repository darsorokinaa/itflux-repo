const LEVEL_OPTIONS = [
  {
    id: "vpr",
    title: "ВПР",
    grade: "7, 8, 10 класс",
    description: "Задания по темам, варианты, автопроверка.",
    route: "/vpr",
  },
  {
    id: "oge",
    title: "ОГЭ",
    grade: "9 класс",
    description: "Задания по типам, варианты для класса.",
    route: "/oge",
  },
  {
    id: "ege",
    title: "ЕГЭ",
    grade: "11 класс",
    description: "Профильная математика и информатика.",
    route: "/ege",
  },
];

function LevelSelector({ onNavigate }) {
  return (
    <section id="level-selector" className="index-levels" aria-label="Выбор уровня подготовки">
      <h2 className="index-levels-section-title">Выберите уровень подготовки</h2>
      <div className="index-level-pick-grid">
        {LEVEL_OPTIONS.map((level) => (
          <article
            key={level.id}
            className={`index-level-pick-card index-level-pick-card--${level.id}`}
          >
            <div className="index-level-pick-side" aria-hidden>
              <span className="index-level-pick-side-text">{level.grade}</span>
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
    </section>
  );
}

export default LevelSelector;
