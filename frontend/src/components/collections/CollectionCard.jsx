import { Link } from "react-router-dom";
import { Layers } from "lucide-react";
import CollectionAccessBadge from "./CollectionAccessBadge";
import { collectionMetaLine, lessonsLabel } from "./collectionFormat";

export default function CollectionCard({ item, coverStyle }) {
  const meta = collectionMetaLine(item);
  const count = item?.lessons_count || 0;
  return (
    <article className="lcol-card">
      <div className="lcol-card__cover" style={coverStyle}>
        <span className="lcol-card__badge"><Layers size={14} aria-hidden="true" /> Набор</span>
      </div>
      <div className="lcol-card__body">
        <p className="lcol-card__kicker">{meta || "Набор уроков"}</p>
        <h3 className="lcol-card__title">{item.title}</h3>
        {item.short_description ? <p className="lcol-card__text">{item.short_description}</p> : null}
        <p className="lcol-card__meta">{count} {lessonsLabel(count)}</p>
        <CollectionAccessBadge access={item.access} compact />
        <Link className="lcol-btn lcol-btn--block" to={item.url || `/lessons/collections/${item.slug}`}>
          Открыть набор
        </Link>
      </div>
    </article>
  );
}
