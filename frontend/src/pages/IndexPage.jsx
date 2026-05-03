import { useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import LevelSelector from "../components/LevelSelector";
import IndexNews from "../components/IndexNews";

function IndexPage() {
  const navigate = useNavigate();

  useLayoutEffect(() => {
    document.body.classList.add("index");
    return () => document.body.classList.remove("index");
  }, []);

  return (
    <div className="index-edu-page">
      <div className="index-edu-shell">
        <section className="index-edu-hero" aria-label="О платформе">
          <div className="index-edu-hero-left">
            <h1>Платформа для подготовки к экзаменам</h1>
            <p className="index-edu-hero-lead">
              <span className="index-edu-hero-lead-line">
                Готовые задания по всем темам и типам экзамена.
              </span>
              <br />
              <span className="index-edu-hero-lead-line">
                Учителя собирают варианты и назначают задания классу.
              </span>
              <br />
              <span className="index-edu-hero-lead-line">
                Ученики решают сами — по темам, в своём темпе, с автопроверкой.
              </span>
            </p>
            <div className="index-edu-hero-actions">
              <button
                type="button"
                className="index-edu-btn index-edu-btn--primary"
                onClick={() => {
                  document.getElementById("level-selector")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Выбрать уровень
              </button>
            </div>
          </div>

          <div className="index-edu-hero-right" aria-hidden="true">
            <img
              src={`${import.meta.env.BASE_URL}img/hero-img.png`}
              alt=""
              className="index-edu-hero-image"
            />
          </div>
        </section>

        <LevelSelector onNavigate={(path) => navigate(path)} />

        <IndexNews />
      </div>
    </div>
  );
}

export default IndexPage;
