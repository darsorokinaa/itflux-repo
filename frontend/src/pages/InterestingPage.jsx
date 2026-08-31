import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Map, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import AccessGateBadge from "../components/AccessGateBadge";
import CatalogEngagementBar from "../components/CatalogEngagementBar";
import InterestingPreviewModal from "../components/InterestingPreviewModal";
import StateView from "../components/StateView";
import { isCatalogLocked } from "../accessGate/accessGate";
import { CATALOG_ORDERING_OPTIONS, registerCatalogView } from "../utils/catalogEngagement";
import "../styles/material-access.css";

function mediaUrl(url) {
  if (!url) return null;
  const idx = url.indexOf("/media/");
  if (idx >= 0) return url.slice(idx);
  return url;
}

function viewerUrl(slug) {
  return `/interesting/${encodeURIComponent(slug)}/view`;
}

function previewUrl(slug) {
  return `/interesting?preview=${encodeURIComponent(slug)}`;
}

function InterestingCard({ item, onEngagementChange, onLockedOpen }) {
  const coverUrl = mediaUrl(item.cover_image_url);
  const locked = isCatalogLocked(item);
  const openUrl = item?.slug ? (locked ? previewUrl(item.slug) : viewerUrl(item.slug)) : null;
  const accent = item.accent_color || "#1F3A8A";
  const bannerStyle = coverUrl
    ? {
        backgroundColor: accent,
        backgroundImage: `url("${coverUrl}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundColor: accent };

  const handleOpen = (event) => {
    if (locked) {
      event.preventDefault();
      onLockedOpen?.(item);
      return;
    }
    if (!item.slug) return;
    registerCatalogView("interesting", item.slug).catch(() => {});
  };

  return (
    <article className="interesting-card">
      <div
        className={`interesting-card__banner${coverUrl ? " interesting-card__banner--cover" : ""}`}
        style={bannerStyle}
      >
        {item.tag ? <span className="interesting-card__tag">{item.tag}</span> : null}
        <AccessGateBadge
          minPlan={item.access?.min_plan}
          accessLevel={item.access_level}
          allowed={item.access?.allowed}
        />
        {!coverUrl ? (
          <Map className="interesting-card__icon" size={48} strokeWidth={1.6} aria-hidden="true" />
        ) : null}
      </div>
      <div className="interesting-card__body">
        <h2 className="interesting-card__title">{item.title}</h2>
        {item.short_description ? (
          <p className="interesting-card__desc">{item.short_description}</p>
        ) : null}
        <CatalogEngagementBar
          kind="interesting"
          slug={item.slug}
          viewsCount={item.views_count}
          likesCount={item.likes_count}
          isLiked={item.is_liked}
          onChange={(next) => onEngagementChange?.(item.slug, next)}
        />
        {openUrl ? (
          <a
            href={openUrl}
            className="interesting-card__btn"
            target={locked ? undefined : "_blank"}
            rel={locked ? undefined : "noopener noreferrer"}
            onClick={handleOpen}
          >
            Открыть
            {locked ? null : <ExternalLink size={16} strokeWidth={2.2} aria-hidden="true" />}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const previewSlug = searchParams.get("preview") || "";
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [ordering, setOrdering] = useState("newest");
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const handleEngagementChange = useCallback((slug, next) => {
    setItems((prev) =>
      prev.map((item) =>
        item.slug === slug
          ? {
              ...item,
              views_count: next.views_count,
              likes_count: next.likes_count,
              is_liked: next.is_liked,
            }
          : item,
      ),
    );
  }, []);

  const handleLockedOpen = useCallback((item) => {
    if (!item?.slug) return;
    setSearchParams({ preview: item.slug }, { replace: false });
  }, [setSearchParams]);

  const closePreview = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("preview");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams();
    if (ordering && ordering !== "newest") qs.set("ordering", ordering);
    const url = qs.toString() ? `/api/interesting/?${qs}` : "/api/interesting/";

    fetch(url, { credentials: "same-origin" })
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
  }, [reloadKey, ordering]);

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

          <section className="lessons-toolbar interesting-toolbar" aria-label="Поиск и сортировка">
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
            <label className="lessons-filter interesting-toolbar__sort">
              <span className="lessons-filter__label">Сортировка</span>
              <select
                className="lessons-filter__control"
                value={ordering}
                onChange={(e) => setOrdering(e.target.value)}
              >
                {CATALOG_ORDERING_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
                <InterestingCard
                  key={item.id}
                  item={item}
                  onEngagementChange={handleEngagementChange}
                  onLockedOpen={handleLockedOpen}
                />
              ))}
            </section>
          )}
        </main>
      </div>
      <InterestingPreviewModal
        open={Boolean(previewSlug)}
        slug={previewSlug}
        onClose={closePreview}
      />
    </div>
  );
}
