import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import CatalogMaterialViewer from "../components/CatalogMaterialViewer";
import { fetchInterestingItem } from "../utils/cabinetAuth";

function previewUrl(slug) {
  return `/interesting?preview=${encodeURIComponent(slug)}`;
}

function contentUrl(slug) {
  return `/api/interesting/${encodeURIComponent(slug)}/view/`;
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
    fetchInterestingItem(slug)
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
  }, [slug, navigate]);

  return (
    <CatalogMaterialViewer
      title={item?.title || ""}
      backHref={previewUrl(slug || "")}
      backLabel="← К описанию"
      frameSrc={item && slug ? contentUrl(slug) : ""}
      loading={loading}
      error={error}
      engagement={item?.slug ? {
        kind: "interesting",
        slug: item.slug,
        viewsCount: item.views_count,
        likesCount: item.likes_count,
        isLiked: item.is_liked,
      } : null}
    />
  );
}
