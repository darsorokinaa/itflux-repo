/** r131: /razbor — список разборов по экзаменам и предметам. */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

export default function RazborListPage() {
  const [items, setItems] = useState<RazborItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Разборы заданий ОГЭ и ЕГЭ — Цифровой поток";
    fetch("/api/razbor/", { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setItems(d.items || []))
      .catch(() => setError("Не удалось загрузить разборы. Обновите страницу."));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, { exam: string; subject: string; title: string; items: RazborItem[] }>();
    for (const it of items || []) {
      const key = `${it.exam}/${it.subject}`;
      if (!map.has(key)) map.set(key, { exam: it.exam, subject: it.subject, title: `${it.exam_name} · ${it.subject_name}`, items: [] });
      map.get(key)!.items.push(it);
    }
    return [...map.values()];
  }, [items]);

  return (
    <main className="razbor-page">
      <div className="razbor-container">
        <header className="razbor-hero">
          <p className="razbor-kicker">Разборы</p>
          <h1>Разборы заданий ОГЭ и ЕГЭ</h1>
          <p className="razbor-lead">
            Теория простым языком, алгоритм решения и примеры из банка — отдельная страница на каждый номер экзамена.
          </p>
        </header>
        {error ? <p className="razbor-error">{error}</p> : null}
        {items === null && !error ? <p className="razbor-muted">Загрузка…</p> : null}
        {items && !items.length ? <p className="razbor-muted">Разборы скоро появятся.</p> : null}
        {groups.map((g) => (
          <section key={`${g.exam}/${g.subject}`} className="razbor-group" aria-label={g.title}>
            <h2>{g.title}</h2>
            <ul className="razbor-grid">
              {g.items.map((it) => (
                <li key={it.number}>
                  <Link to={it.url} className="razbor-card">
                    <span className="razbor-card__num">№{it.number}</span>
                    <span className="razbor-card__title">Разбор задания №{it.number}</span>
                    <span className="razbor-card__sub">{it.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
