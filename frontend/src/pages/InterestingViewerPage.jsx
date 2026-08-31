import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchInterestingItem } from "../utils/cabinetAuth";

function contentUrl(slug) {
  return `/api/interesting/${encodeURIComponent(slug)}/view/`;
}

function previewUrl(slug) {
  return `/interesting?preview=${encodeURIComponent(slug)}`;
}

/** Redirects to content or opens preview modal on /interesting */
export default function InterestingViewerPage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!slug) {
      navigate("/interesting", { replace: true });
      return;
    }
    let cancelled = false;
    fetchInterestingItem(slug)
      .then((item) => {
        if (cancelled) return;
        if (item?.access?.allowed !== false && item?.locked !== true) {
          window.location.replace(contentUrl(slug));
          return;
        }
        navigate(previewUrl(slug), { replace: true });
      })
      .catch(() => {
        if (!cancelled) navigate(previewUrl(slug), { replace: true });
      });
    return () => { cancelled = true; };
  }, [slug, navigate]);

  return <div className="material-viewer material-viewer--loading">Загрузка…</div>;
}
