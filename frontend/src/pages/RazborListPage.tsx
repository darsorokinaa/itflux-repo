/** r131: /razbor — список разборов. r136: фильтры (чипы) + поиск в URL, карточки, «скоро». */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { razborTopic, RAZBOR_TOTALS } from "../utils/razborTopic";
import "../styles/razbor.css";

export type RazborItem = {
  exam: string;
  exam_name: string;
  subject: string;
  subject_name: string;
  number: number;
  title: string;
  url: string;
};

const EXAMS = [
  { id: "", label: "Все" },
  { id: "oge", label: "ОГЭ" },
  { id: "ege", label: "ЕГЭ" },
];
const SUBJECTS = [
  { id: "", label: "Все" },
  { id: "math", label: "Математика" },
  { id: "inf", label: "Информатика" },
];
const ORDER = ["oge/math", "oge/inf", "ege/math", "ege/inf"];

type Cell = { number: number; item: RazborItem | null };
type Group = { key: string; exam: string; subject: string; examName: string; subjectName: string; cells: Cell[]; published: number; total: number };

export default function RazborListPage() {
  const [items, setItems] = useState<RazborItem[] | null>(null);
  const [error, setError] = useState("");
  const [sp, setSp] = useSearchParams();
  const exam = sp.get("exam") || "";
  const subject = sp.get("subject") || "";
  const q = sp.get("q") || "";

  useEffect(() => {
    document.title = "Разборы заданий ОГЭ и ЕГЭ — Цифровой поток";
    fetch("/api/razbor/", { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setItems(d.items || []))
      .catch(() => setError("Не удалось загрузить разборы. Обновите страницу."));
  }, []);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next, { replace: true });
  };

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const it of items || []) {
      const key = `${it.exam}/${it.subject}`;
      if (!map.has(key)) map.set(key, { key, exam: it.exam, subject: it.subject, examName: it.exam_name, subjectName: it.subject_name, cells: [], published: 0, total: 0 });
      const g = map.get(key)!;
      g.cells.push({ number: it.number, item: it });
      g.published += 1;
    }
    for (const g of map.values()) {
      const have = new Set(g.cells.map((c) => c.number));
      const max = Math.max(RAZBOR_TOTALS[g.key] || 0, ...g.cells.map((c) => c.number));
      for (let n = 1; n <= max; n++) if (!have.has(n)) g.cells.push({ number: n, item: null });
      g.cells.sort((a, b) => a.number - b.number);
      g.total = max;
    }
    const rank = (k: string) => (ORDER.indexOf(k) < 0 ? 99 : ORDER.indexOf(k));
    return [...map.values()].sort((a, b) => rank(a.key) - rank(b.key));
  }, [items]);

  const needle = q.trim().toLowerCase().replace(/^№\s*/, "");
  const isNum = /^\d+$/.test(needle);
  const filtered = useMemo(
    () =>
      groups
        .filter((g) => (!exam || g.exam === exam) && (!subject || g.subject === subject))
        .map((g) => ({
          ...g,
          cells: g.cells.filter((c) => {
            if (!needle) return true;
            if (!c.item) return false;
            if (isNum) return String(c.number) === needle;
            return `${c.item.title} ${razborTopic(c.item.title, c.number)}`.toLowerCase().includes(needle);
          }),
        }))
        .filter((g) => g.cells.length),
    [groups, exam, subject, needle, isNum],
  );
  const total = (items || []).length;
  const shown = filtered.reduce((s, g) => s + g.cells.filter((c) => c.item).length, 0);
  const hasFilters = !!(exam || subject || q);

  return (
    <main className="razbor-page">
      <div className="razbor-container">
        <header className="razbor-hero">
          <p className="razbor-kicker">Разборы</p>
          <h1>Разборы заданий ОГЭ и ЕГЭ</h1>
          <p className="razbor-lead">
            Теория простым языком, алгоритм решения и примеры из банка — отдельная страница на каждый номер экзамена.
          </p>
          {total ? <p className="razbor-hero__stat"><b>{total}</b> разборов опубликовано</p> : null}
        </header>

        <section className="razbor-filters" aria-label="Фильтры">
          <div className="razbor-filters__row">
            <span className="razbor-filters__label">Экзамен</span>
            <div className="razbor-chips" role="group" aria-label="Экзамен">
              {EXAMS.map((o) => (
                <button key={o.id || "all"} type="button" className={`razbor-chip${exam === o.id ? " is-active" : ""}`} aria-pressed={exam === o.id} onClick={() => setParam("exam", o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="razbor-filters__row">
            <span className="razbor-filters__label">Предмет</span>
            <div className="razbor-chips" role="group" aria-label="Предмет">
              {SUBJECTS.map((o) => (
                <button key={o.id || "all"} type="button" className={`razbor-chip${subject === o.id ? " is-active" : ""}`} aria-pressed={subject === o.id} onClick={() => setParam("subject", o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="razbor-search">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M10 4a6 6 0 1 0 3.7 10.7l4.8 4.8 1.4-1.4-4.8-4.8A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" /></svg>
            <input type="search" value={q} onChange={(e) => setParam("q", e.target.value)} placeholder="Номер или тема: 15, графы, проценты…" aria-label="Поиск по номеру или теме" />
            {hasFilters ? <button type="button" className="razbor-reset" onClick={() => setSp(new URLSearchParams(), { replace: true })}>Сбросить</button> : null}
          </div>
        </section>

        {error ? <p className="razbor-error">{error}</p> : null}
        {items === null && !error ? <p className="razbor-muted">Загрузка…</p> : null}
        {items && !total ? <p className="razbor-muted">Разборы скоро появятся.</p> : null}
        {items && total && !shown ? (
          <div className="razbor-empty">
            <p>Ничего не нашлось{q ? <> по запросу «{q}»</> : null}.</p>
            <button type="button" className="razbor-btn" onClick={() => setSp(new URLSearchParams(), { replace: true })}>Показать все разборы</button>
          </div>
        ) : null}

        {filtered.map((g) => (
          <section key={g.key} className="razbor-group" aria-label={`${g.examName} · ${g.subjectName}`}>
            <div className="razbor-group__head">
              <h2>
                <span className={`razbor-badge razbor-badge--${g.exam}`}>{g.examName}</span> {g.subjectName}
              </h2>
              <span className="razbor-group__count">{g.published} из {g.total} готово</span>
            </div>
            <ul className="razbor-grid">
              {g.cells.map((c) =>
                c.item ? (
                  <li key={c.number}>
                    <Link to={c.item.url} className="razbor-card">
                      <span className="razbor-card__top">
                        <span className="razbor-card__num"><small>№</small>{c.number}</span>
                        <span className={`razbor-badge razbor-badge--${g.exam} razbor-badge--sm`}>{g.examName} · {g.subject === "inf" ? "Инф" : "Мат"}</span>
                      </span>
                      <span className="razbor-card__title">{razborTopic(c.item.title, c.number)}</span>
                      <span className="razbor-card__more">Читать разбор →</span>
                    </Link>
                  </li>
                ) : (
                  <li key={c.number}>
                    <div className="razbor-card razbor-card--soon" aria-disabled="true">
                      <span className="razbor-card__top">
                        <span className="razbor-card__num"><small>№</small>{c.number}</span>
                        <span className="razbor-soon">скоро</span>
                      </span>
                      <span className="razbor-card__title">Разбор готовится</span>
                    </div>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
