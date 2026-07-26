import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Map, Search } from "lucide-react";
import StateView from "../components/StateView";

function mediaUrl(url) {
  if (!url) return null;
  const idx = url.indexOf("/media/");
  if (idx >= 0) return url.slice(idx);
  return url;
}

function getOpenUrl(item) {
  if (!item?.slug) return null;
  if (item.archive_url || item.file_url) {
    return `/api/interesting/${encodeURIComponent(item.slug)}/view/`;
  }
  return null;
}

function InterestingCard({ item }) {
  const coverUrl = mediaUrl(item.cover_image_url);
  const openUrl = getOpenUrl(item);
  const accent = item.accent_color || "#1F3A8A";
  const bannerStyle = coverUrl
    ? {
        backgroundColor: accent,
        backgroundImage: `url("${coverUrl}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundColor: accent };

  return (
    <article className="interesting-card">
      <div
        className={`interesting-card__banner${coverUrl ? " interesting-card__banner--cover" : ""}`}
        style={bannerStyle}
      >
        {item.tag ? <span className="interesting-card__tag">{item.tag}</span> : null}
        {!coverUrl ? (
          <Map className="interesting-card__icon" size={48} strokeWidth={1.6} aria-hidden="true" />
        ) : null}
      </div>
      <div className="interesting-card__body">
        <h2 className="interesting-card__title">{item.title}</h2>
        {item.short_description ? (
          <p className="interesting-card__desc">{item.short_description}</p>
        ) : null}
        {openUrl ? (
          <a
            href={openUrl}
            className="interesting-card__btn"
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть
            <ExternalLink size={16} strokeWidth={2.2} aria-hidden="true" />
          </a>
        ) : (
          <button type="button" className="interesting-card__btn interesting-card__btn--disabled" disabled>
            Скоро
          </button>
        )}
      </div>
    </article>
  );
}

export default function InterestingPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/interesting/", { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error("Не удалось загрузить материалы");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtered = items.filter((item) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const haystack = [item.title, item.short_description, item.tag]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <main className="interesting-page">
          <section className="lessons-hero-v3">
            <h1 className="lessons-hero-v3__title">Интересное</h1>
            <p className="lessons-hero-v3__lead">
              Факты, интерактивы и материалы, которые делают информатику живой и наглядной.
            </p>
          </section>

          <section className="lessons-toolbar" aria-label="Поиск материалов">
            <label className="lessons-search">
              <Search className="lessons-search__icon" size={18} strokeWidth={2.2} aria-hidden="true" />
              <input
                type="search"
                className="lessons-search__input"
                placeholder="Название или описание"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </section>

          {loading ? (
            <StateView variant="loading" title="Загружаем материалы…" description="Это займёт пару секунд." />
          ) : error ? (
            <StateView
              variant="error"
              title="Не удалось загрузить"
              description={error}
              action={
                <button type="button" className="state-view__btn" onClick={reload}>
                  Повторить
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <StateView
              variant={search.trim() ? "search" : "empty"}
              title={search.trim() ? "Ничего не найдено" : "Пока пусто"}
              description={
                search.trim()
                  ? "Попробуйте другой запрос"
                  : "Скоро здесь появятся интерактивы и интересные факты"
              }
            />
          ) : (
            <section className="interesting-grid" aria-label="Материалы раздела">
              {filtered.map((item) => (
                <InterestingCard key={item.id} item={item} />
              ))}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
