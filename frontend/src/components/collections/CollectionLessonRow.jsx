import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Lock, Play } from "lucide-react";
import { formatLessonDuration, isDirectFileHref, lessonHref, lockReason } from "./collectionFormat";

function coverSrc(url) {
  if (!url) return null;
  const index = url.indexOf("/media/");
  return index >= 0 ? url.slice(index) : url;
}

function StatusIcon({ lesson, current }) {
  if (!lesson.can_open) return <Lock size={18} strokeWidth={2} aria-hidden="true" />;
  if (lesson.viewed) return <CheckCircle2 size={18} strokeWidth={2} aria-hidden="true" />;
  if (current) return <Play size={18} strokeWidth={2} aria-hidden="true" />;
  return <span className="lcol-row__dot" aria-hidden="true" />;
}

export default function CollectionLessonRow({ collection, lesson, current = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const popoverId = useId();
  const number = String(lesson.number || 0).padStart(2, "0");
  const duration = formatLessonDuration(lesson.duration_minutes);
  const reason = lockReason(collection?.access);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const coverUrl = lesson.kind === "lesson" || lesson.kind === "trainer" ? coverSrc(lesson.cover_url) : null;

  const body = (
    <>
      {coverUrl ? (
        <img className="lcol-row__cover" src={coverUrl} alt="" />
      ) : null}
      <span className="lcol-row__status">
        <StatusIcon lesson={lesson} current={current} />
        <span className="lcol-sr">{lesson.viewed ? "Просмотрен" : current ? "Текущий" : lesson.can_open ? "Доступен" : "Недоступен"}</span>
      </span>
      <span className="lcol-row__num">{number}</span>
      <span className="lcol-row__main">
        <span className="lcol-row__title">{lesson.title}</span>
        {lesson.short_description ? <span className="lcol-row__desc">{lesson.short_description}</span> : null}
      </span>
      <span className="lcol-row__side">
        {current ? <span className="lcol-pill">Продолжить здесь</span> : null}
        {lesson.kind === "trainer" ? <span className="lcol-pill">Тренажёр</span> : null}
        {lesson.kind === "file" ? <span className="lcol-pill">Файл</span> : null}
        {lesson.kind === "variant" ? <span className="lcol-pill">Вариант</span> : null}
        {lesson.is_demo && !collection?.access?.has_access ? <span className="lcol-pill lcol-pill--demo">Демо</span> : null}
        {duration ? <span className="lcol-row__time">{duration}</span> : null}
      </span>
    </>
  );

  const className = [
    "lcol-row",
    !lesson.can_open ? "lcol-row--locked" : "",
    lesson.viewed ? "lcol-row--done" : "",
    current ? "lcol-row--current" : "",
    lesson.is_demo ? "lcol-row--demo" : "",
    coverUrl ? "lcol-row--cover" : "",
  ].filter(Boolean).join(" ");

  if (!lesson.can_open) {
    return (
      <div className={className} ref={rootRef}>
        <button
          type="button"
          className="lcol-row__button"
          aria-expanded={open}
          aria-controls={popoverId}
          onClick={() => setOpen((value) => !value)}
        >
          {body}
        </button>
        {open ? (
          <div className="lcol-popover" id={popoverId} role="status">
            {reason}
          </div>
        ) : null}
      </div>
    );
  }

  const href = lessonHref(collection.slug, lesson);
  if (isDirectFileHref(href)) {
    return (
      <a className={className} href={href}>
        {body}
      </a>
    );
  }

  return (
    <Link className={className} to={href}>
      {body}
    </Link>
  );
}
