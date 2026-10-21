import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { enterLessonRoomEarly } from "../../../utils/cabinetAuth";
import { StudentLoadingState } from "../StudentSectionUi";

/**
 * Переходник раннего входа: в окне [начало −15 мин, конец] открывает комнату урока
 * (экран ожидания до прихода учителя) в этой же вкладке.
 */
export default function StudentLessonRoomEntryPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    enterLessonRoomEarly(eventId)
      .then((data) => {
        if (cancelled) return;
        const href = data?.pageUrl || "";
        if (href.startsWith("/cabinet/meetings/")) navigate(href, { replace: true });
        else setError("Не удалось открыть комнату урока");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Не удалось открыть комнату урока");
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, navigate]);

  if (!error) {
    return <StudentLoadingState message="Открываем комнату урока…" style={{ minHeight: 240 }} />;
  }
  return (
    <div className="st-empty" style={{ padding: 24, textAlign: "center" }}>
      <p>{error}</p>
      <Link to="/cabinet/student/lessons" className="cb-btn cb-btn--outline cb-btn--sm">
        К расписанию
      </Link>
    </div>
  );
}
