/** r131: /razbor/:exam/:subject/:number — один разбор (Markdown + LaTeX). */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { renderRazborMarkdown } from "../utils/razborMarkdown";
// @ts-ignore JS module without d.ts
import { typesetElement } from "../utils/loadMathJax";
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
  const bankHref = `/tasks?level=${data.exam}&subject=${data.subject}`;
  return (
    <main className="razbor-page">
      <div className="razbor-container razbor-container--article">
        <nav className="razbor-crumbs" aria-label="Навигация">
          <Link to="/razbor">Разборы</Link>
          <span aria-hidden="true">/</span>
          <span>{data.exam_name} · {data.subject_name}</span>
        </nav>
        <header className="razbor-hero razbor-hero--article">
          <p className="razbor-kicker">{data.exam_name} · {data.subject_name}</p>
          <h1>Разбор задания №{data.number}</h1>
          <p className="razbor-lead">{data.title}</p>
          {data.numbers.length > 1 ? (
            <div className="razbor-nums" role="navigation" aria-label="Другие номера">
              {data.numbers.map((n) => (
                <Link key={n} to={`${base}/${n}`} className={n === data.number ? "is-active" : ""} aria-current={n === data.number ? "page" : undefined}>
                  {n}
                </Link>
              ))}
            </div>
          ) : null}
        </header>
        <article className="razbor-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />
        <footer className="razbor-foot">
          {data.prev != null ? <Link className="razbor-btn" to={`${base}/${data.prev}`}>← Задание №{data.prev}</Link> : <span />}
          <Link className="razbor-btn razbor-btn--primary" to={bankHref}>Решать задачи в банке</Link>
          {data.next != null ? <Link className="razbor-btn" to={`${base}/${data.next}`}>Задание №{data.next} →</Link> : <span />}
        </footer>
      </div>
    </main>
  );
}
