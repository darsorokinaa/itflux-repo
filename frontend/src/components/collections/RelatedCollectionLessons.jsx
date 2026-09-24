import { Link } from "react-router-dom";
import { lessonHref, lessonsLabel } from "./collectionFormat";

function recordOpen(slug, lessonId) {
  import("../../utils/cabinetAuth").then(({ ensureCsrfCookie, getCsrfToken }) => {
    ensureCsrfCookie().then(() => {
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRFToken"] = csrf;
      fetch(`/api/lesson-collections/${encodeURIComponent(slug)}/events/`, {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ event_name: "related_collection_opened_from_lesson", lesson_id: lessonId || null }),
      }).catch(() => {});
    });
  });
}

export default function RelatedCollectionLessons({ lesson }) {
  const context = lesson?.collection_context;
  if (!context?.slug) return null;
  const neighbors = (context.neighbors || []).slice(0, 4);
  if (!context.has_access) {
    const rest = Math.max((context.lessons_count || 1) - 1, 0);
    return (
      <section className="lcol-related lcol-related--upsell">
        <h2>Продолжить тему</h2>
        <p>
          Этот урок входит в набор «{context.title}». В наборе ещё {rest} связанных {lessonsLabel(rest)}.
        </p>
        <Link to={context.url}>Посмотреть набор</Link>
      </section>
    );
  }
  if (!neighbors.length) return null;
  return (
    <section className="lcol-related" aria-label="Дальше в этом наборе">
      <h2>Дальше в этом наборе</h2>
      <div className="lcol-related__list">
        {neighbors.map((item) => (
          <Link key={item.slug} className="lcol-related__item" to={lessonHref(context.slug, item)}>
            <span>Урок {item.number || ""}</span>
            <strong>{item.title}</strong>
          </Link>
        ))}
      </div>
      <Link
        className="lcol-related__all"
        to={context.url}
        onClick={() => recordOpen(context.slug, lesson.id)}
      >
        Посмотреть все {context.lessons_count} {lessonsLabel(context.lessons_count)}
      </Link>
    </section>
  );
}
