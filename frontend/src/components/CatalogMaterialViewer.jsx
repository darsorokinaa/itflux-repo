import { Link } from "react-router-dom";
import CatalogEngagementBar, { useRegisterCatalogView } from "./CatalogEngagementBar";

/**
 * SPA-оболочка HTML-тренажёра/урока: контент в iframe, выход не уводит на /api/.
 */
export default function CatalogMaterialViewer({
  title = "",
  backHref,
  backLabel = "← Назад",
  frameSrc = "",
  loading = false,
  error = "",
  engagement = null,
}) {
  const registeredViews = useRegisterCatalogView(
    engagement?.kind,
    engagement?.slug,
    Boolean(engagement?.slug && frameSrc && !loading && !error),
  );
  const viewsCount = registeredViews ?? engagement?.viewsCount ?? 0;
  if (loading) {
    return (
      <div className="lesson-viewer-page lesson-viewer-page--loading">
        <p className="lesson-viewer-page__status">Загрузка…</p>
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
      <div className="lesson-viewer-page__toolbar">
        {backHref ? (
          <Link className="lesson-viewer-page__back" to={backHref}>{backLabel}</Link>
        ) : null}
        {title ? <h1 className="lesson-viewer-page__title">{title}</h1> : null}
        {engagement?.slug ? (
          <CatalogEngagementBar
            kind={engagement.kind}
            slug={engagement.slug}
            viewsCount={viewsCount}
            likesCount={engagement.likesCount}
            isLiked={engagement.isLiked}
          />
        ) : null}
      </div>
      <div className="lesson-viewer-page__doc-main">
        <iframe
          className="lesson-viewer-page__pdf-frame"
          src={frameSrc}
          title={title || "Материал"}
          allow="autoplay; fullscreen"
        />
      </div>
    </div>
  );
}
