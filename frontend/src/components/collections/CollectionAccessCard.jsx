import { Link } from "react-router-dom";
import { continueLabel, isDirectFileHref, lessonHref, lessonsLabel } from "./collectionFormat";
import CollectionProgress from "./CollectionProgress";

export default function CollectionAccessCard({ collection, onBuy, buying = false }) {
  const access = collection?.access || {};
  const count = collection?.lessons_count || 0;
  const progress = collection?.progress || { viewed: 0, total: count };
  const continueLesson = collection?.continue_lesson;
  const showTariff = !access.has_access && access.plans?.length && access.mode !== "purchase";
  const showPurchase = !access.has_access && access.can_purchase;

  return (
    <aside className="lcol-access" aria-label="Доступ к набору">
      {collection?.cover_url ? (
        <img className="lcol-access__cover" src={collection.cover_url} alt="" />
      ) : null}
      {access.has_access ? (
        <>
          <p className="lcol-access__status">Доступ открыт</p>
          {continueLesson?.slug || continueLesson?.url ? (
            isDirectFileHref(lessonHref(collection.slug, continueLesson)) ? (
              <a className="lcol-btn" href={lessonHref(collection.slug, continueLesson)}>
                {continueLabel(collection)}
              </a>
            ) : (
              <Link className="lcol-btn" to={lessonHref(collection.slug, continueLesson)}>
                {continueLabel(collection)}
              </Link>
            )
          ) : null}
          <CollectionProgress viewed={progress.viewed || 0} total={progress.total || count} />
        </>
      ) : (
        <>
          <p className="lcol-access__kicker">Полный набор</p>
          <p className="lcol-access__count">{count} готовых {lessonsLabel(count)}</p>
          {showPurchase ? (
            <p className="lcol-access__price">
              {access.compare_at_label ? <span className="lcol-access__old">{access.compare_at_label}</span> : null}
              {access.price_label}
            </p>
          ) : null}
          {showPurchase ? (
            <button type="button" className="lcol-btn" onClick={onBuy} disabled={buying}>
              {buying ? "Переходим к оплате" : "Получить набор"}
            </button>
          ) : null}
          {showTariff ? (
            <div className="lcol-access__tariff">
              <p>{showPurchase ? "Также входит в тариф" : "Входит в тариф"} {access.plans.map((plan) => plan.name).join(", ")}</p>
              <Link className={`lcol-btn ${showPurchase ? "lcol-btn--ghost" : ""}`} to="/pricing">Посмотреть тариф</Link>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
