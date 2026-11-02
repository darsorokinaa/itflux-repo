/** r131: /razbor/:exam/:subject/:number — один разбор (Markdown + LaTeX). */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { renderRazborMarkdown } from "../utils/razborMarkdown";
// @ts-ignore JS module without d.ts
import { typesetElement } from "../utils/loadMathJax";
import { razborTopic } from "../utils/razborTopic";
import "../styles/razbor.css";

// r133: как _RAZBOR_SUBJ_PREP в seo.py
const SUBJ_PREP: Record<string, string> = { math: "математике", math_base: "базовой математике", inf: "информатике" };

type RazborDetail = {
  ok: boolean;
  exam: string;
  exam_name: string;
  subject: string;
  subject_name: string;
  number: number;
  title: string;
  content_md: string;
  numbers: number[];
  prev: number | null;
  next: number | null;
};

export default function RazborPage() {
  const { exam = "", subject = "", number = "" } = useParams();
  const [data, setData] = useState<RazborDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "notfound" | "error">("loading");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [topics, setTopics] = useState<Record<number, string>>({});

  // r136: темы соседних номеров для кнопок «предыдущий/следующий»
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/razbor/?exam=${encodeURIComponent(exam)}&subject=${encodeURIComponent(subject)}`, { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const m: Record<number, string> = {};
        for (const it of d.items || []) if (it.exam === exam && it.subject === subject) { const tp = razborTopic(it.title, it.number); if (!tp.startsWith("Разбор задания")) m[it.number] = tp; }
        setTopics(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [exam, subject]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch(`/api/razbor/${encodeURIComponent(exam)}/${encodeURIComponent(subject)}/${encodeURIComponent(number)}/`, { credentials: "omit" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 404) return setStatus("notfound");
        if (!r.ok) return setStatus("error");
        const d = (await r.json()) as RazborDetail;
        setData(d);
        setStatus("ok");
        document.title = `Разбор задания №${d.number} ${d.exam_name} по ${SUBJ_PREP[d.subject] ?? d.subject_name.toLowerCase()} | Цифровой поток`;
      })
      .catch(() => !cancelled && setStatus("error"));
    window.scrollTo(0, 0);
    return () => {
      cancelled = true;
    };
  }, [exam, subject, number]);

  const html = useMemo(() => (data ? renderRazborMarkdown(data.content_md) : ""), [data]);

  useEffect(() => {
    let cancelled = false;
    if (html && bodyRef.current) typesetElement(bodyRef.current, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [html]);

  if (status === "loading") return <main className="razbor-page"><div className="razbor-container"><p className="razbor-muted">Загрузка…</p></div></main>;
  if (status !== "ok" || !data) {
    return (
      <main className="razbor-page">
        <div className="razbor-container">
          <h1>{status === "notfound" ? "Разбор не найден" : "Не удалось загрузить разбор"}</h1>
          <p><Link to="/razbor">Все разборы →</Link></p>
        </div>
      </main>
    );
  }

  const base = `/razbor/${data.exam}/${data.subject}`;
  const bankHref = `/tasks?level=${data.exam}&subject=${data.subject}&num=${data.number}`;
  const topicRaw = razborTopic(data.title, data.number);
  const topic = topicRaw.startsWith("Разбор задания") ? data.title : topicRaw;
  return (
    <main className="razbor-page">
      <div className="razbor-container razbor-container--article">
        <nav className="razbor-crumbs" aria-label="Хлебные крошки">
          <Link to="/razbor">Разборы</Link>
          <span aria-hidden="true">›</span>
          <Link to={`/razbor?exam=${data.exam}`}>{data.exam_name}</Link>
          <span aria-hidden="true">›</span>
          <Link to={`/razbor?exam=${data.exam}&subject=${data.subject}`}>{data.subject_name}</Link>
          <span aria-hidden="true">›</span>
          <span aria-current="page">Задание №{data.number}</span>
        </nav>
        <header className="razbor-hero razbor-hero--article">
          <p className="razbor-kicker">{data.exam_name} · {data.subject_name}</p>
          <h1>Разбор задания №{data.number}</h1>
          <p className="razbor-lead">{topic}</p>
          <div className="razbor-hero__actions">
            <Link className="razbor-btn razbor-btn--lime" to={bankHref}>Решать задачи этого номера →</Link>
          </div>
          {data.numbers.length > 1 ? (
            <div className="razbor-nums" role="navigation" aria-label="Другие номера">
              {data.numbers.map((n) => (
                <Link key={n} to={`${base}/${n}`} title={topics[n] || `Задание №${n}`} className={n === data.number ? "is-active" : ""} aria-current={n === data.number ? "page" : undefined}>
                  {n}
                </Link>
              ))}
            </div>
          ) : null}
        </header>
        <article className="razbor-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />
        <div className="razbor-cta">
          <div>
            <b>Закрепите на практике</b>
            <span>Задачи №{data.number} {data.exam_name} из банка — с проверкой ответа.</span>
          </div>
          <Link className="razbor-btn razbor-btn--primary" to={bankHref}>Решать задачи этого номера</Link>
        </div>
        <nav className="razbor-pager" aria-label="Соседние номера">
          {data.prev != null ? (
            <Link className="razbor-pager__item" to={`${base}/${data.prev}`}>
              <small>← Предыдущий</small>
              <b>№{data.prev}{topics[data.prev] ? `. ${topics[data.prev]}` : ""}</b>
            </Link>
          ) : <span />}
          {data.next != null ? (
            <Link className="razbor-pager__item razbor-pager__item--next" to={`${base}/${data.next}`}>
              <small>Следующий →</small>
              <b>№{data.next}{topics[data.next] ? `. ${topics[data.next]}` : ""}</b>
            </Link>
          ) : <span />}
        </nav>
      </div>
    </main>
  );
}
