import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { fetchReadyLesson } from "../utils/cabinetAuth";
import { getLessonContentUrl, lessonPreviewUrl } from "../cabinet/lessonCardUtils";

/** Legacy route: redirects to content or opens preview modal on /lessons */
export default function LessonViewerPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!slug) {
      navigate("/lessons", { replace: true });
      return;
    }
    let cancelled = false;
    fetchReadyLesson(slug)
      .then((lesson) => {
        if (cancelled) return;
        if (lesson?.access?.can_view) {
          window.location.replace(getLessonContentUrl(slug));
          return;
        }
        const extra = {};
        if (searchParams.get("demo_expired") === "1") extra.demo_expired = "1";
        if (searchParams.get("payment_id")) extra.payment_id = searchParams.get("payment_id");
        if (searchParams.get("status")) extra.status = searchParams.get("status");
        navigate(lessonPreviewUrl(slug, extra), { replace: true });
      })
      .catch(() => {
        if (!cancelled) navigate(lessonPreviewUrl(slug), { replace: true });
      });
    return () => { cancelled = true; };
  }, [slug, searchParams, navigate]);

  return <div className="material-viewer material-viewer--loading">Загрузка…</div>;
}
