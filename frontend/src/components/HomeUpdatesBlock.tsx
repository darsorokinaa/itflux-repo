import { useEffect, useMemo, useState } from "react";
import {
  homeUpdatesVisibleCount,
  isExternalUpdateUrl,
  paginateItems,
  resolveUpdateHref,
  updateLinkText,
  type HomeUpdateItem,
} from "./homeUpdatesUtils";

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {direction === "left" ? (
        <path d="M15 6l-6 6 6 6" />
      ) : (
        <path d="M9 6l6 6-6 6" />
      )}
    </svg>
  );
}

function useVisibleUpdateCount(): 1 | 2 | 3 {
  const [count, setCount] = useState<1 | 2 | 3>(() =>
    homeUpdatesVisibleCount(typeof window !== "undefined" ? window.innerWidth : 1024),
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const tablet = window.matchMedia("(min-width: 768px)");
    const sync = () => {
      if (desktop.matches) setCount(3);
      else if (tablet.matches) setCount(2);
      else setCount(1);
    };
    sync();
    desktop.addEventListener("change", sync);
    tablet.addEventListener("change", sync);
    return () => {
      desktop.removeEventListener("change", sync);
      tablet.removeEventListener("change", sync);
    };
  }, []);

  return count;
}

function UpdateCard({ item }: { item: HomeUpdateItem }) {
  const href = resolveUpdateHref(item);
  const title = (item.title || "").trim();
  const text = (item.description || "").trim();
  const external = href ? isExternalUpdateUrl(href) : false;

  return (
    <article className={`home-updates__card${href ? " home-updates__card--linked" : ""}`}>
      <h3 className="home-updates__card-title">{title}</h3>
      {text ? <p className="home-updates__card-text">{text}</p> : null}
      {href ? (
        <a
          className="home-updates__more"
          href={href}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {updateLinkText(item.link_text)}
        </a>
      ) : null}
    </article>
  );
}

export default function HomeUpdatesBlock() {
  const [items, setItems] = useState<HomeUpdateItem[] | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const visibleCount = useVisibleUpdateCount();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/updates/", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.updates) ? data.updates : [];
        setItems(
          list.filter((item: HomeUpdateItem) => item && String(item.title || "").trim()),
        );
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pages = useMemo(
    () => paginateItems(items || [], visibleCount),
    [items, visibleCount],
  );
  const pageCount = pages.length;
  const page = Math.min(pageIndex, Math.max(0, pageCount - 1));
  const canNavigate = pageCount > 1;
  const atStart = page <= 0;
  const atEnd = page >= pageCount - 1;

  useEffect(() => {
    if (page !== pageIndex) setPageIndex(page);
  }, [page, pageIndex]);

  if (!items || items.length === 0) return null;

  return (
    <section className="home-updates" aria-label="Обновления">
      {canNavigate ? (
        <button
          type="button"
          className="home-updates__nav"
          aria-label="Предыдущие обновления"
          disabled={atStart}
          onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
        >
          <ChevronIcon direction="left" />
        </button>
      ) : null}

      <div className="home-updates__viewport">
        <div
          className="home-updates__track"
          style={{ transform: `translateX(-${page * 100}%)` }}
        >
          {pages.map((pageItems, index) => (
            <div className="home-updates__page" key={`page-${index}`}>
              {pageItems.map((item) => (
                <UpdateCard key={item.id} item={item} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {canNavigate ? (
        <button
          type="button"
          className="home-updates__nav"
          aria-label="Следующие обновления"
          disabled={atEnd}
          onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
        >
          <ChevronIcon direction="right" />
        </button>
      ) : null}
    </section>
  );
}
