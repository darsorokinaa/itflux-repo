import { Fragment, useEffect, useState } from "react";

function formatNewsDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function IndexNews() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/updates/", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.updates) ? data.updates : [];
        setItems(list);
        setError(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="news" className="index-news" aria-label="Новости и обновления">
      <h2 className="index-levels-section-title">Новости и обновления</h2>
      <div className="index-news-feed">
        {loading ? (
          <p className="index-news-status">Загрузка…</p>
        ) : error ? (
          <p className="index-news-status" role="alert">
            Не удалось загрузить обновления. Попробуйте обновить страницу позже.
          </p>
        ) : items.length === 0 ? (
          <p className="index-news-status">Пока нет опубликованных обновлений.</p>
        ) : (
          items.map((item, index) => (
            <Fragment key={item.id}>
              {index > 0 ? <div className="index-news-separator" aria-hidden="true" /> : null}
              <article className="index-news-row">
                <time className="index-news-row-date" dateTime={item.created_iso || undefined}>
                  {formatNewsDate(item.created_iso)}
                </time>
                <div className="index-news-row-main">
                  <h3 className="index-news-row-title">{item.title}</h3>
                  {item.description ? (
                    <p className="index-news-row-desc">{item.description}</p>
                  ) : null}
                </div>
              </article>
            </Fragment>
          ))
        )}
      </div>
    </section>
  );
}

export default IndexNews;
