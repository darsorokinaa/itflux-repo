import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { lessonPreviewUrl } from "../cabinet/lessonCardUtils";

/** Always open the description preview; content starts from the modal. */
export default function LessonViewerPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!slug) {
      navigate("/lessons", { replace: true });
      return;
    }
    const extra = {};
    if (searchParams.get("demo_expired") === "1") extra.demo_expired = "1";
    if (searchParams.get("payment_id")) extra.payment_id = searchParams.get("payment_id");
    if (searchParams.get("status")) extra.status = searchParams.get("status");
    navigate(lessonPreviewUrl(slug, extra), { replace: true });
  }, [slug, searchParams, navigate]);

  return <div className="material-viewer material-viewer--loading">Загрузка…</div>;
}
