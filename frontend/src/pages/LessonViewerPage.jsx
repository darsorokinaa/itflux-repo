import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import CatalogMaterialViewer from "../components/CatalogMaterialViewer";
import { getLessonContentUrl, lessonPreviewUrl } from "../cabinet/lessonCardUtils";
import { fetchReadyLesson } from "../utils/cabinetAuth";

function previewExtras(searchParams) {
  const extra = {};
  if (searchParams.get("demo_expired") === "1") extra.demo_expired = "1";
  if (searchParams.get("payment_id")) extra.payment_id = searchParams.get("payment_id");
  if (searchParams.get("status")) extra.status = searchParams.get("status");
  return extra;
}

function canOpenLessonContent(lesson) {
  const access = lesson?.access || {};
  return access.can_view === true || access.demo_active === true;
}

/** HTML-тренажёр урока внутри SPA — «Назад» и F5 не попадают на /api/.../view/. */
export default function LessonViewerPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!slug) {
      navigate("/lessons", { replace: true });
      return undefined;
    }
    const extra = previewExtras(searchParams);
    if (extra.demo_expired) {
      navigate(lessonPreviewUrl(slug, extra), { replace: true });
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchReadyLesson(slug)
      .then((data) => {
        if (cancelled) return;
        if (!canOpenLessonContent(data)) {
          navigate(lessonPreviewUrl(slug, extra), { replace: true });
          return;
        }
        setLesson(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLesson(null);
          setError(err?.message || "Не удалось загрузить урок");
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
      title={lesson?.title || ""}
      backHref={lessonPreviewUrl(slug || "")}
      backLabel="← К описанию"
      frameSrc={lesson && slug ? getLessonContentUrl(slug) : ""}
      loading={loading}
      error={error}
    />
  );
}
