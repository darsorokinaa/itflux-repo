import { Link } from "react-router-dom";
import { Eye } from "lucide-react";
import { lessonPreviewUrl, getLessonViewerUrl } from "../cabinet/lessonCardUtils";
import { trackValueGoal } from "../utils/valuePath";

const patternInf = new URL("../assets/subject-patterns/inf.svg", import.meta.url).href;
const patternMath = new URL("../assets/subject-patterns/math.svg", import.meta.url).href;
const patternPhys = new URL("../assets/subject-patterns/phys.svg", import.meta.url).href;
const patternChem = new URL("../assets/subject-patterns/chem.svg", import.meta.url).href;
const patternRus = new URL("../assets/subject-patterns/rus.svg", import.meta.url).href;
const patternLit = new URL("../assets/subject-patterns/lit.svg", import.meta.url).href;
const patternHistory = new URL("../assets/subject-patterns/history.svg", import.meta.url).href;

const SUBJECT_THEMES = [
  { test: /информат/i, color: "#32B6C5", pattern: patternInf },
  { test: /математ/i, color: "#2B52F5", pattern: patternMath },
  { test: /физ/i, color: "#4A4FC4", pattern: patternPhys },
  { test: /хими/i, color: "#0F9E76", pattern: patternChem },
  { test: /русск/i, color: "#D8546E", pattern: patternRus },
  { test: /литератур/i, color: "#7D46E3", pattern: patternLit },
  { test: /истори/i, color: "#B45309", pattern: patternHistory },
];
const DEFAULT_SUBJECT_THEME = { color: "#2440B8", pattern: patternInf };

function getSubjectTheme(subjectName) {
  const name = String(subjectName || "");
  return SUBJECT_THEMES.find((theme) => theme.test.test(name)) || DEFAULT_SUBJECT_THEME;
}

function mediaUrl(url) {
  if (!url) return null;
  const idx = url.indexOf("/media/");
  if (idx >= 0) return url.slice(idx);
  return url;
}

export default function TryNowLessons({
  lessons = [],
  onOpen,
  title = "Можно провести уже сегодня",
  lead = "Подобрано по вашим ученикам и темам ближайших занятий. Готовые уроки без подготовки.",
  compact = false,
  source = "try_now",
}) {
  const headingId = compact ? "lessons-recent-heading" : "try-now-heading";

  if (!lessons.length) return null;
  return (
    <section
      className={`try-now-lessons${compact ? " try-now-lessons--compact" : ""}`}
      aria-labelledby={headingId}
    >
      <header className="try-now-lessons__head">
        <h2 id={headingId}>{title}</h2>
        {lead ? <p>{lead}</p> : null}
      </header>
      <div className="try-now-lessons__grid">
        {lessons.map((lesson) => {
          const coverUrl = mediaUrl(lesson.cover_image_url);
          const theme = getSubjectTheme(lesson.subject);
          
          const isPattern = !coverUrl;
          const bannerStyle = isPattern
            ? { backgroundImage: `url("${theme.pattern}")`, backgroundColor: theme.color }
            : { backgroundImage: `url("${coverUrl}")`, backgroundColor: theme.color };

          return (
            <article key={lesson.slug} className="try-now-lessons__card">
              <div 
                className={`try-now-lessons__cover ${isPattern ? "try-now-lessons__cover--pattern" : "try-now-lessons__cover--image"}`} 
                style={bannerStyle} 
              />
              <div className="try-now-lessons__body">
                <p className="try-now-lessons__meta">
                  {[lesson.subject, lesson.grade ? `${lesson.grade} класс` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <h3 className="try-now-lessons__title" title={lesson.title}>{lesson.title}</h3>
                
                <div className="try-now-lessons__actions">
                  <Link
                    className="try-now-lessons__btn try-now-lessons__btn--preview"
                    to={lessonPreviewUrl(lesson.slug)}
                    aria-label={compact ? "Просмотр" : "Предпросмотр"}
                    title={compact ? "Просмотр" : "Предпросмотр"}
                    onClick={(event) => {
                      event.preventDefault();
                      trackValueGoal("lesson_card_previewed", { source, lesson_id: String(lesson.id || lesson.slug) });
                      onOpen?.(lesson);
                    }}
                  >
                    <Eye size={compact ? 14 : 16} strokeWidth={2} aria-hidden="true" />
                    {compact ? "Просмотр" : null}
                  </Link>
                  {compact ? null : (
                    <Link
                      className="try-now-lessons__btn try-now-lessons__btn--open"
                      to={getLessonViewerUrl(lesson.slug)}
                      onClick={() => {
                        trackValueGoal("lesson_card_opened", { source, lesson_id: String(lesson.id || lesson.slug) });
                      }}
                    >
                      Открыть
                    </Link>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
