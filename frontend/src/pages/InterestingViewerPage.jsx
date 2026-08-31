import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

function previewUrl(slug) {
  return `/interesting?preview=${encodeURIComponent(slug)}`;
}

/** Opens the catalog preview modal with the material description. */
export default function InterestingViewerPage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!slug) {
      navigate("/interesting", { replace: true });
      return;
    }
    navigate(previewUrl(slug), { replace: true });
  }, [slug, navigate]);

  return <div className="material-viewer material-viewer--loading">Загрузка…</div>;
}
