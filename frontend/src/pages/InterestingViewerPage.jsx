import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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

  return (
    <CatalogMaterialViewer
      title={item?.title || ""}
      backHref={previewUrl(slug || "")}
      backLabel="← К описанию"
      frameSrc={item && slug ? contentUrl(slug) : ""}
      loading={loading}
      error={error}
      engagement={item?.slug ? { kind: "interesting", slug: item.slug } : null}
      banner={item ? <LessonCollectionNavigation lesson={item} /> : null}
      footer={item ? <RelatedCollectionLessons lesson={item} /> : null}
    />
  );
}
