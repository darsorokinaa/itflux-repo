import { Link } from "react-router-dom";
import { collectionMetaLine, formatDuration, lessonsLabel } from "./collectionFormat";

export default function CollectionHeader({ collection }) {
  const meta = collectionMetaLine(collection);
  const facts = [
    collection?.lessons_count ? `${collection.lessons_count} ${lessonsLabel(collection.lessons_count)}` : null,
    formatDuration(collection?.duration_minutes),
    collection?.author ? collection.author : null,
  ].filter(Boolean);

  return (
    <header className="lcol-hero">
      <div className="lcol-hero__copy">
        <nav className="lcol-crumbs" aria-label="Навигация">
          <Link to="/lessons">Каталог</Link>
          <span aria-hidden="true">/</span>
          <span>Наборы</span>
        </nav>
        {meta ? <p className="lcol-hero__kicker">{meta}</p> : null}
        <h1 className="lcol-hero__title">{collection?.title}</h1>
        {collection?.short_description ? <p className="lcol-hero__lead">{collection.short_description}</p> : null}
        {facts.length ? <p className="lcol-hero__facts">{facts.join(" · ")}</p> : null}
      </div>
    </header>
  );
}
