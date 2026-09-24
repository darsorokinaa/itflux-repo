import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { lessonHref } from "./collectionFormat";

function recordEvent(slug, eventName, lessonId) {
  if (!slug) return;
  import("../../utils/cabinetAuth").then(({ ensureCsrfCookie, getCsrfToken }) => {
    ensureCsrfCookie().then(() => {
      const headers = { Accept: "application/json", "Content-Type": "application/json" };
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRFToken"] = csrf;
      fetch(`/api/lesson-collections/${encodeURIComponent(slug)}/events/`, {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({ event_name: eventName, lesson_id: lessonId || null }),
      }).catch(() => {});
    });
  });
}

export default function LessonCollectionNavigation({ lesson }) {
  const context = lesson?.collection_context;
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!context?.slug) return null;
  const href = (slug) => lessonHref(context.slug, { slug });
  return (
    <nav className="lcol-nav" aria-label="Навигация по набору">
      <div className="lcol-nav__identity">
        <Link className="lcol-nav__title" to={context.url}>{context.title}</Link>
        <span className="lcol-nav__meta">Урок {context.lesson_number} из {context.lessons_count}</span>
      </div>
      <div className="lcol-nav__moves">
        {context.prev ? (
          <Link
            className="lcol-nav__move"
            to={href(context.prev.slug)}
            onClick={() => recordEvent(context.slug, "previous_collection_lesson_clicked", lesson.id)}
          >
            <span>Предыдущий</span>
            <strong>{context.prev.title}</strong>
          </Link>
        ) : null}
        <Link className="lcol-nav__all" to={context.url}>Все уроки</Link>
        {context.next ? (
          <Link
            className="lcol-nav__move lcol-nav__move--next"
            to={href(context.next.slug)}
            onClick={() => recordEvent(context.slug, "next_collection_lesson_clicked", lesson.id)}
          >
            <span>Следующий</span>
            <strong>{context.next.title}</strong>
          </Link>
        ) : null}
      </div>
      {context.also_count > 0 ? (
        <div className="lcol-nav__also" ref={menuRef}>
          <button
            type="button"
            className="lcol-nav__also-btn"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
          >
            Также входит ещё в {context.also_count}
          </button>
          {open ? (
            <div className="lcol-popover lcol-popover--menu" id={menuId} role="menu">
              {(context.also || []).map((item) => (
                <Link key={item.slug} role="menuitem" to={`/lessons/collections/${item.slug}`}>{item.title}</Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
