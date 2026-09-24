import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CollectionAccessCard from "../components/collections/CollectionAccessCard";
import CollectionHeader from "../components/collections/CollectionHeader";
import CollectionLessonList from "../components/collections/CollectionLessonList";
import StateView from "../components/StateView";
import { useCabinetAuthed } from "../hooks/useAccessGate";
import { ensureCsrfCookie, getCsrfToken } from "../utils/cabinetAuth";
import "./lesson-collections.css";

async function postCollection(path, body) {
  await ensureCsrfCookie();
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRFToken"] = csrf;
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error("Не удалось выполнить запрос");
    error.status = res.status;
    throw error;
  }
  return data;
}

function CollectionSkeleton() {
  return (
    <div className="lcol-page" aria-hidden="true">
      <div className="lcol-skeleton">
        <div className="lcol-skeleton__block" />
        <div className="lcol-skeleton__block" />
      </div>
      <div className="lcol-skeleton__rows">
        <div className="lcol-skeleton__row" />
        <div className="lcol-skeleton__row" />
        <div className="lcol-skeleton__row" />
        <div className="lcol-skeleton__row" />
      </div>
    </div>
  );
}

export default function LessonCollectionPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const authed = useCabinetAuthed();
  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    setMissing(false);
    fetch(`/api/lesson-collections/${encodeURIComponent(slug)}/`, { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status === 404) {
          setMissing(true);
          return null;
        }
        if (!res.ok) throw new Error("load");
        return res.json();
      })
      .then((data) => {
        if (data) setCollection(data.collection || null);
      })
      .catch(() => setError("Не удалось загрузить набор"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [slug]);

  const buy = async () => {
    if (!authed) {
      navigate(`/cabinet/login?next=/lessons/collections/${slug}`);
      return;
    }
    setBuying(true);
    try {
      await postCollection(`/api/lesson-collections/${encodeURIComponent(slug)}/events/`, {
        event_name: "collection_purchase_click",
      });
      const result = await postCollection(`/api/lesson-collections/${encodeURIComponent(slug)}/purchase/`, {
        idempotency_key: `col-${collection?.id}-${Date.now()}`,
      });
      if (result?.payment_url) window.location.href = result.payment_url;
    } catch {
      setBuyError("Не удалось перейти к оплате. Попробуйте ещё раз.");
    } finally {
      setBuying(false);
    }
  };

  if (loading) {
    return (
      <div className="digital-flow-page">
        <div className="digital-flow-page__wrap">
          <main className="lessons-page"><CollectionSkeleton /></main>
        </div>
      </div>
    );
  }

  if (missing) {
    return (
      <div className="digital-flow-page">
        <div className="digital-flow-page__wrap">
          <StateView
            variant="empty"
            title="Набор не найден"
            description="Возможно, ссылка устарела или набор ещё не опубликован."
            action={<Link className="lcol-btn" to="/lessons">В каталог</Link>}
          />
        </div>
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="digital-flow-page">
        <div className="digital-flow-page__wrap">
          <StateView
            variant="error"
            title="Не удалось загрузить набор"
            description="Проверьте соединение и попробуйте ещё раз."
            action={<button type="button" className="lcol-btn" onClick={load}>Повторить</button>}
          />
        </div>
      </div>
    );
  }

  const empty = !(collection.lessons || []).length;

  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <main className="lessons-page lcol-page">
          <div className="lcol-top">
            <CollectionHeader collection={collection} />
            <div>
              <CollectionAccessCard collection={collection} onBuy={buy} buying={buying} />
              {buyError ? <p className="lcol-hero__facts">{buyError}</p> : null}
            </div>
          </div>
          {collection.description ? <p className="lcol-description">{collection.description}</p> : null}
          {empty ? (
            <StateView
              variant={collection.status === "draft" ? "draft" : "empty"}
              title={collection.status === "draft" ? "В наборе пока нет уроков" : "В этом наборе пока нет уроков"}
              description={collection.status === "draft" ? "Добавьте готовые уроки, порядок и разделы в админке." : "Материалы появятся здесь, когда набор будет собран."}
              action={collection.status === "draft" ? (
                <a className="lcol-btn" href={`/admin/Generator/lessoncollection/${collection.id}/change/`}>Добавить уроки</a>
              ) : null}
            />
          ) : (
            <CollectionLessonList collection={collection} />
          )}
          {collection.next_collection ? (
            <section className="lcol-next">
              <div>
                <p>Продолжить обучение</p>
                <strong>{collection.next_collection.title}</strong>
              </div>
              <Link className="lcol-btn lcol-btn--ghost" to={collection.next_collection.url}>Открыть следующий набор</Link>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
