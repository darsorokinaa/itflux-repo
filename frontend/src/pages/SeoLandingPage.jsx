import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import MathContent from "../components/MathContent";
import SeoBoardDemo from "./SeoBoardDemo";
import { SEO_LANDINGS, seoLandingSlug, seoRegisterPath } from "./seoLandings";
import "./seo-landing.css";

function TaskCard({ item }) {
  return (
    <article className="seo-landing__task">
      <header>
        <span>Задание {item.task_number}</span>
        {item.subtopic ? <span>{item.subtopic}</span> : null}
      </header>
      <h3>{item.title}</h3>
      {item.html ? (
        <MathContent html={item.html} className="task-text seo-landing__task-html" plainHtml />
      ) : (
        <p>{item.text}</p>
      )}
      {item.href ? (
        <p><Link to={item.href}>Открыть в банке заданий</Link></p>
      ) : null}
    </article>
  );
}

export default function SeoLandingPage() {
  const { pathname } = useLocation();
  const slug = seoLandingSlug(pathname);
  const fallback = SEO_LANDINGS[slug];
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState("loading");
  const [demoTasks, setDemoTasks] = useState(null);
  const [sampleState, setSampleState] = useState("idle");
  const [lessonIndex, setLessonIndex] = useState(0);

  useEffect(() => {
    if (!slug) return undefined;
    const controller = new AbortController();
    fetch(`/api/seo/landing/${slug}/`, { signal: controller.signal, credentials: "omit" })
      .then((response) => (response.ok ? response.json() : Promise.reject(response)))
      .then((data) => {
        setPayload(data);
        setStatus("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [slug]);

  if (!fallback) return null;

  const page = payload || fallback;
  const materials = payload?.materials || [];
  const tasks = demoTasks || materials.filter((item) => item.kind === "task");
  const registerTo = seoRegisterPath(slug);
  const selectedLesson = materials[lessonIndex] || materials[0];

  async function loadSample() {
    setSampleState("loading");
    try {
      const response = await fetch(`/api/seo/landing/${slug}/sample/`, { credentials: "omit" });
      if (response.status === 429) {
        setSampleState("limited");
        return;
      }
      if (!response.ok) {
        setSampleState("error");
        return;
      }
      const data = await response.json();
      setDemoTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setSampleState(data.tasks?.length ? "ready" : "empty");
    } catch {
      setSampleState("error");
    }
  }

  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <article className="seo-landing">
          <p className="pain-landing__eyebrow">Цифровой поток</p>
          <h1 className="pain-landing__title">{page.h1}</h1>
          <p className="pain-landing__lead">{page.description || fallback.description}</p>
          <div className="pain-landing__actions">
            <Link className="pain-landing__cta" to={registerTo}>Зарегистрироваться</Link>
          </div>
          {(page.cta_note || fallback.ctaNote) ? (
            <p className="seo-landing__note">{page.cta_note || fallback.ctaNote}</p>
          ) : null}

          {status === "loading" ? <p className="seo-landing__status">Загружаем примеры…</p> : null}
          {status === "error" ? <p className="seo-landing__status">Не удалось загрузить примеры из каталога.</p> : null}

          {fallback.kind === "variant" ? (
            <section className="seo-landing__section" aria-label="Пример варианта">
              <div className="seo-landing__section-head">
                <h2>{fallback.h2}</h2>
                <button type="button" onClick={loadSample} disabled={sampleState === "loading"}>
                  {demoTasks ? "Собрать другой пример" : "Собрать пример"}
                </button>
              </div>
              <p className="seo-landing__note">{page.note || fallback.note}</p>
              {sampleState === "limited" ? <p className="seo-landing__status">Слишком много попыток. Попробуйте позже.</p> : null}
              {sampleState === "error" ? <p className="seo-landing__status">Не удалось собрать пример. Попробуйте ещё раз.</p> : null}
              {sampleState === "empty" ? <p className="seo-landing__status">В банке заданий нет подходящих заданий для примера.</p> : null}
              <div className="seo-landing__tasks">
                {tasks.map((item) => <TaskCard key={item.id} item={item} />)}
              </div>
            </section>
          ) : null}

          {fallback.kind === "lessons" ? (
            <section className="seo-landing__section" aria-label="Уроки">
              <h2>{fallback.h2}</h2>
              <p className="seo-landing__note">{page.note || fallback.note}</p>
              <div className="seo-landing__materials seo-landing__materials--cards">
                {materials.map((item, index) => (
                  <button
                    key={item.slug}
                    type="button"
                    className={`seo-landing__card${selectedLesson?.slug === item.slug ? " is-active" : ""}`}
                    aria-pressed={selectedLesson?.slug === item.slug}
                    onClick={() => setLessonIndex(index)}
                  >
                    <span>{[item.exam_label, item.task_number ? `№${item.task_number}` : ""].filter(Boolean).join(" · ")}</span>
                    <strong>{item.title}</strong>
                  </button>
                ))}
              </div>
              {selectedLesson ? (
                <article className="seo-landing__detail">
                  <h3>{selectedLesson.title}</h3>
                  {selectedLesson.topic ? <p>{selectedLesson.topic}</p> : null}
                  {selectedLesson.duration_minutes ? <p>{selectedLesson.duration_minutes} минут</p> : null}
                  {selectedLesson.text ? <p>{selectedLesson.text}</p> : null}
                  {selectedLesson.href ? <Link to={selectedLesson.href}>Страница урока</Link> : null}
                </article>
              ) : null}
            </section>
          ) : null}

          {fallback.kind === "interactive" ? (
            <section className="seo-landing__section" aria-label="Интерактив">
              <h2>{fallback.h2}</h2>
              <p className="seo-landing__note">{page.note || fallback.note}</p>
              <div className="seo-landing__materials seo-landing__materials--cards">
                {materials.map((item) => (
                  <article key={item.slug} className="seo-landing__card seo-landing__card--static">
                    {item.tag ? <span>{item.tag}</span> : null}
                    <strong>{item.title}</strong>
                    {item.text ? <p>{item.text}</p> : null}
                    {item.href ? <Link to={item.href}>Открыть страницу тренажёра</Link> : null}
                  </article>
                ))}
              </div>
              {payload?.play?.view_path ? (
                <iframe className="seo-landing__frame" title={payload.play.title || "Интерактив"} src={payload.play.view_path} />
              ) : status === "ready" ? (
                <p className="seo-landing__status">Сейчас в каталоге нет бесплатного тренажёра, который можно пройти без входа.</p>
              ) : null}
            </section>
          ) : null}

          {fallback.kind === "board" ? (
            <section className="seo-landing__section" aria-label="Доска">
              <h2>{fallback.h2}</h2>
              <p className="seo-landing__note">{page.extra || fallback.extra}</p>
              <div className="seo-landing__board-layout">
                <SeoBoardDemo />
                <div className="seo-landing__tasks">
                  {tasks.map((item) => <TaskCard key={item.id} item={item} />)}
                </div>
              </div>
            </section>
          ) : null}

          <nav className="seo-landing__more" aria-label="Другие страницы">
            {Object.entries(SEO_LANDINGS)
              .filter(([itemSlug]) => itemSlug !== slug)
              .map(([itemSlug, item]) => (
                <Link key={itemSlug} to={`/${itemSlug}`}>{item.h1}</Link>
              ))}
          </nav>
        </article>
      </div>
    </div>
  );
}
