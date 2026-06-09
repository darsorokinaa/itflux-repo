import { Link } from "react-router-dom";
import { getLevelDef } from "../data/levels";

const GENERATOR_LEVELS = [
  {
    id: "oge",
    title: "ОГЭ",
    lead: "Собрать вариант для 9 класса",
    styleVariant: "oge",
    to: "/oge",
  },
  {
    id: "ege",
    title: "ЕГЭ",
    lead: "Собрать вариант для 11 класса",
    styleVariant: "ege",
    to: "/ege",
  },
];

export default function GeneratorHubPage() {
  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <main className="nav-hub-page">
          <header className="section-head section-head--page">
            <h1 className="section-head__title">Генератор вариантов</h1>
            <p className="section-head__lead">
              Выберите экзамен и предмет, отметьте задания — получите ссылку на готовый вариант для класса.
            </p>
          </header>

          <div className="home-levels-grid nav-hub-page__levels">
            {GENERATOR_LEVELS.map((level) => {
              const def = getLevelDef(level.id);
              return (
                <Link
                  key={level.id}
                  to={level.to}
                  className={`home-level-card home-level-card--${level.styleVariant} nav-hub-page__level-link`}
                  style={{ "--level-accent": def.bg }}
                >
                  <span className="home-level-card__inner">
                    <span className="home-level-card__line">
                      <span className="home-level-card__title">{level.title}</span>
                      <span className="home-level-card__desc">{level.lead}</span>
                    </span>
                  </span>
                  <span className="home-level-card__right">
                    <span className="home-level-card__arrow" aria-hidden>
                      →
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>

          <p className="nav-hub-page__hint">
            Для школьной базы (ВПР) генератор доступен после выбора предмета в разделе{" "}
            <Link to="/subject/vpr">Школьная база</Link>.
          </p>
        </main>
      </div>
    </div>
  );
}
