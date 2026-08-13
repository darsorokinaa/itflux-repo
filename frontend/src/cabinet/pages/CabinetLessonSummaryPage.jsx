import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import LessonSummaryDrawer from "../components/LessonSummaryDrawer";

/**
 * Full-page «Итоги урока» — opens from schedule / meeting / journal in a new tab.
 */
export default function CabinetLessonSummaryPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromMeeting = searchParams.get("from") === "meeting";

  return (
    <LessonSummaryDrawer
      open
      presentation="page"
      eventId={eventId}
      fromMeeting={fromMeeting}
      onClose={() => {
        if (window.opener && !window.opener.closed) {
          window.close();
          return;
        }
        navigate("/cabinet/journal");
      }}
      onSaved={() => {
        /* stay on page; autosave toast lives in drawer status */
      }}
      onBillingPrompt={(id) => {
        navigate(`/cabinet/schedule?finalize=${id}`);
      }}
    />
  );
}
