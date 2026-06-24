import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import InteractivePlayer from "../../components/InteractivePlayer";
import {
  appearancePageClass,
  appearancePageStyle,
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
} from "../../interactiveAppearance";
import {
  fetchStudentInteractive,
  submitStudentInteractiveAttempt,
} from "../../../utils/cabinetAuth";
import "../../styles/interactive-play.css";
import "../../styles/interactive-appearance.css";

export default function StudentInteractivePlayPage() {
  const { id } = useParams();
  const { catalog } = useInteractiveAppearanceCatalog();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchStudentInteractive(id)
      .then(setPayload)
      .catch((e) => setError(e.message || "Не удалось загрузить"))
      .finally(() => setLoading(false));
  }, [id]);

  const interactive = payload?.interactive;
  const appearance = useMemo(
    () => (interactive ? resolveInteractiveAppearance(interactive, catalog) : null),
    [interactive, catalog],
  );

  const handleComplete = useCallback(async (score) => {
    try {
      await submitStudentInteractiveAttempt(id, { score_percent: score });
    } catch { /* ignore */ }
  }, [id]);

  if (loading) {
    return <div className="interactive-play-page st-loading-screen">Загрузка…</div>;
  }

  if (error || !interactive) {
    return (
      <div className="interactive-play-page st-play-error">
        <p>{error || "Интерактив недоступен"}</p>
        <Link to="/cabinet/student/interactives" className="cb-btn cb-btn--outline">Назад</Link>
      </div>
    );
  }

  return (
    <div
      className={`interactive-play-page ${appearancePageClass(appearance)}`}
      style={appearancePageStyle(appearance)}
    >
      <div className="st-play-topbar">
        <Link to="/cabinet/student/interactives" className="st-play-back">← Назад</Link>
        <span>{payload.assignment?.title || interactive.title}</span>
      </div>
      <InteractivePlayer
        interactive={interactive}
        appearance={appearance}
        bare
        playing
        onComplete={handleComplete}
      />
    </div>
  );
}
