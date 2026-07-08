import { Link } from "react-router-dom";

const ICONS = {
  oge: "<>",
  ege: "◎",
  vpr: "∑",
};

export default function GeneratorCategoryCard({
  id,
  title,
  description,
  tasksLabel,
  to,
  classLabel,
}) {
  return (
    <Link to={to} className={`generator-category-card generator-category-card--${id}`}>
      <div className="generator-category-card__head">
        <span className="generator-category-card__icon" aria-hidden>
          {ICONS[id] || "•"}
        </span>
        {classLabel ? <span className="generator-category-card__class">{classLabel}</span> : null}
      </div>

      <div className="generator-category-card__content">
        <h3 className="generator-category-card__title">{title}</h3>
        <p className="generator-category-card__description">{description}</p>
      </div>

      <div className="generator-category-card__footer">
        <span className="generator-category-card__count">{tasksLabel}</span>
        <span className="generator-category-card__cta">
          Открыть
          <span aria-hidden>→</span>
        </span>
      </div>
    </Link>
  );
}
