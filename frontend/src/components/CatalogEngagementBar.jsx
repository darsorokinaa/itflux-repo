import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, Heart } from "lucide-react";
import {
  asCount,
  formatCompactCount,
  registerCatalogView,
  toggleCatalogLike,
} from "../utils/catalogEngagement";

/**
 * Компактная статистика: просмотры + лайк.
 * kind: "lessons" | "interesting"
 */
export default function CatalogEngagementBar({
  kind,
  slug,
  viewsCount = 0,
  likesCount = 0,
  isLiked = false,
  onChange,
  className = "",
}) {
  const navigate = useNavigate();
  const [views, setViews] = useState(() => asCount(viewsCount));
  const [likes, setLikes] = useState(() => asCount(likesCount));
  const [liked, setLiked] = useState(Boolean(isLiked));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setViews(asCount(viewsCount));
    setLikes(asCount(likesCount));
    setLiked(Boolean(isLiked));
  }, [viewsCount, likesCount, isLiked, slug]);

  const emit = useCallback(
    (next) => {
      onChange?.(next);
    },
    [onChange],
  );

  const handleLike = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!slug || busy) return;

    const prev = { liked, likes };
    const nextLiked = !liked;
    const nextLikes = Math.max(0, likes + (nextLiked ? 1 : -1));
    setLiked(nextLiked);
    setLikes(nextLikes);
    setBusy(true);
    setNotice("");

    try {
      const data = await toggleCatalogLike(kind, slug);
      setLiked(Boolean(data.is_liked));
      setLikes(Number(data.likes_count) || 0);
      emit({
        views_count: views,
        likes_count: Number(data.likes_count) || 0,
        is_liked: Boolean(data.is_liked),
      });
    } catch (err) {
      setLiked(prev.liked);
      setLikes(prev.likes);
      if (err?.status === 401) {
        navigate("/cabinet/login", {
          state: {
            from: `${window.location.pathname}${window.location.search}`,
            message: "Войдите или зарегистрируйтесь, чтобы поставить лайк",
          },
        });
        return;
      }
      setNotice(err?.message || "Не удалось обновить лайк");
      window.setTimeout(() => setNotice(""), 3200);
    } finally {
      setBusy(false);
    }
  };

  const viewsTitle = `${views.toLocaleString("ru-RU")} просмотров`;
  const likesTitle = `${likes.toLocaleString("ru-RU")} отметок «Нравится»`;

  return (
    <div className={`catalog-engagement ${className}`.trim()}>
      <span className="catalog-engagement__stat" title={viewsTitle}>
        <Eye size={16} strokeWidth={2.1} aria-hidden="true" />
        <span aria-label={viewsTitle}>{formatCompactCount(views)}</span>
      </span>
      <button
        type="button"
        className={`catalog-engagement__like${liked ? " catalog-engagement__like--active" : ""}`}
        onClick={handleLike}
        disabled={busy}
        aria-label={liked ? "Убрать лайк" : "Поставить лайк"}
        aria-pressed={liked}
        title={likesTitle}
      >
        <Heart
          size={16}
          strokeWidth={2.1}
          fill={liked ? "currentColor" : "none"}
          aria-hidden="true"
        />
        <span>{formatCompactCount(likes)}</span>
      </button>
      {notice ? <span className="catalog-engagement__notice" role="status">{notice}</span> : null}
    </div>
  );
}

/** Один раз зарегистрировать просмотр (Strict Mode: ref + backend 30 мин). */
export function useRegisterCatalogView(kind, slug, enabled = true) {
  const sentRef = useRef(false);
  const [viewsCount, setViewsCount] = useState(null);

  useEffect(() => {
    sentRef.current = false;
  }, [kind, slug]);

  useEffect(() => {
    if (!enabled || !slug || sentRef.current) return undefined;
    sentRef.current = true;
    let cancelled = false;
    registerCatalogView(kind, slug)
      .then((data) => {
        if (!cancelled && data && data.views_count != null) {
          setViewsCount(asCount(data.views_count));
        }
      })
      .catch(() => {
        if (!cancelled) sentRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, kind, slug]);

  return viewsCount;
}
