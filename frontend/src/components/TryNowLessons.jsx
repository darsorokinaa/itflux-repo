import { Link } from "react-router-dom";
import { lessonPreviewUrl } from "../cabinet/lessonCardUtils";
import { trackValueGoal } from "../utils/valuePath";

export default function TryNowLessons({
  lessons = [],
  onOpen,
  title = "Можно провести уже сегодня",
  lead = "Готовые материалы: откройте и используйте на ближайшем занятии.",
}) {
  if (!lessons.length) return null;
  return (
    <section className="try-now-lessons" aria-labelledby="try-now-heading">
      <header className="try-now-lessons__head">
        <h2 id="try-now-heading">{title}</h2>
        <p>{lead}</p>
      </header>
      <div className="try-now-lessons__grid">
        {lessons.map((lesson) => (
          <article key={lesson.slug} className="try-now-lessons__card">
            <p className="try-now-lessons__meta">
              {[lesson.subject, lesson.grade ? `${lesson.grade} класс` : null, lesson.topic]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <h3>{lesson.title}</h3>
            <Link
              className="try-now-lessons__cta"
              to={lessonPreviewUrl(lesson.slug)}
              onClick={(event) => {
                event.preventDefault();
                trackValueGoal("lesson_card_opened", { source: "try_now", lesson_id: String(lesson.id || lesson.slug) });
                onOpen?.(lesson);
              }}
            >
              Открыть урок
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
