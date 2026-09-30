import { Link } from "react-router-dom";
import EducationalLoading, { LOADING_MESSAGES } from "./EducationalLoading";
import { useRegisterCatalogView } from "./CatalogEngagementBar";

/**
 * SPA-оболочка HTML-тренажёра/урока: контент в iframe, выход не уводит на /api/.
 */
export default function CatalogMaterialViewer({
  title = "",
  backHref,
  backLabel = "← Назад",
  frameSrc = "",
  loading = false,
  loadingMessage = LOADING_MESSAGES.material,
  error = "",
  engagement = null,
  banner = null,
  footer = null,
}) {
  useRegisterCatalogView(
    engagement?.kind,
    engagement?.slug,
    Boolean(engagement?.slug && frameSrc && !loading && !error),
  );
  if (loading) {
    return (
      <div className="lesson-viewer-page lesson-viewer-page--loading">
        <EducationalLoading message={loadingMessage} />
      </div>
    );
  }

  if (error || !frameSrc) {
    return (
      <div className="lesson-viewer-page lesson-viewer-page--error">
        <div className="lesson-viewer-page__error-card">
          <h2>Не удалось открыть</h2>
          <p>{error || "Материал недоступен"}</p>
          {backHref ? (
            <Link className="lesson-viewer-page__back" to={backHref}>{backLabel}</Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="lesson-viewer-page lesson-viewer-page--doc">
      {banner}
      <div className="lesson-viewer-page__doc-main">
        <iframe
          className="lesson-viewer-page__pdf-frame"
          src={frameSrc}
          title={title || "Материал"}
          allow="autoplay; fullscreen"
        />
      </div>
      {footer}
    </div>
  );
}
