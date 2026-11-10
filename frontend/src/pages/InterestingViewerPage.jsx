import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import CatalogMaterialViewer from "../components/CatalogMaterialViewer";
import LessonCollectionNavigation from "../components/collections/LessonCollectionNavigation";
import RelatedCollectionLessons from "../components/collections/RelatedCollectionLessons";
import { fetchInterestingItem } from "../utils/cabinetAuth";
import "./lesson-collections.css";

function previewUrl(slug) {
  return `/interesting?preview=${encodeURIComponent(slug)}`;
}

function contentUrl(slug) {
  return `/api/interesting/${encodeURIComponent(slug)}/view/`;
}

/** r33: грузим HTML iframe параллельно с метаданными (кэш браузера + ETag/304),
 *  и сразу предзагружаем вынесенные из него большие скрипты (MathJax). */
const warmedFrames = new Set();
function warmFrame(slug) {
  const url = contentUrl(slug);
  if (warmedFrames.has(url) || typeof fetch !== "function") return;
  warmedFrames.add(url);
  fetch(url, { credentials: "same-origin" })
    .then((r) => (r.ok ? r.text() : ""))
    .then((html) => {
      const re = /<script src="(\/static\/interesting-inline\/[a-f0-9]+\.js)"/g;
      let m;
      while ((m = re.exec(html))) {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "script";
        link.href = m[1];
        document.head.appendChild(link);
      }
    })
    .catch(() => {});
}

function canOpenInteresting(item) {
  const access = item?.access || {};
  if (item?.locked) return false;
  if (access.allowed === false) return false;
  return true;
}

/** HTML-материал «Интересное» внутри SPA — выход и обновление не дают API 403. */
export default function InterestingViewerPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!slug) {
      navigate("/interesting", { replace: true });
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const collection = searchParams.get("collection") || "";
    warmFrame(slug);
    fetchInterestingItem(slug, { collection })
      .then((data) => {
        if (cancelled) return;
        if (!canOpenInteresting(data)) {
          navigate(previewUrl(slug), { replace: true });
          return;
        }
        setItem(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setItem(null);
          setError(err?.message || "Не удалось загрузить материал");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, searchParams, navigate]);

  const demoActive = Boolean(item?.access?.demo_active);
  const expiresAt = item?.access?.demo_expires_at;
  useEffect(() => {
    if (!demoActive || !expiresAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [demoActive, expiresAt]);
  const remaining = expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000)) : 0;
  const demoOver = Boolean(item && (item.access?.demo_expired || (demoActive && remaining <= 0 && expiresAt)));

  if (!loading && demoOver && !item?.access?.is_full) {
    return (
      <div className="digital-flow-page">
        <div className="digital-flow-page__wrap">
          <main className="lessons-page material-preview">
            <h1>{item?.title || "Тренажёр"}</h1>
            <p className="material-paywall__message">Демо закончилось. Материал снова закрыт.</p>
            <div className="material-paywall__actions">
              <Link className="material-access-btn material-access-btn--primary" to={previewUrl(slug || "")}>
                Купить или открыть по тарифу
              </Link>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const minutesLeft = Math.ceil(remaining / 60);

  return (
    <CatalogMaterialViewer
      title={item?.title || ""}
      backHref={previewUrl(slug || "")}
      backLabel="← К описанию"
      frameSrc={item && slug ? contentUrl(slug) : ""}
      loading={loading}
      error={error}
      engagement={item?.slug ? { kind: "interesting", slug: item.slug } : null}
      banner={item ? (
        <>
          {demoActive && remaining > 0 ? (
            <p className="material-paywall__message">Демо: осталось {minutesLeft} мин. После этого тренажёр закроется.</p>
          ) : null}
          <LessonCollectionNavigation lesson={item} />
        </>
      ) : null}
      footer={item ? <RelatedCollectionLessons lesson={item} /> : null}
    />
  );
}
