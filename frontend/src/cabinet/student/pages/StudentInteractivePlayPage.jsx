import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import InteractiveShell from "../../components/InteractiveShell";
import {
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
} from "../../interactiveAppearance";
import {
  fetchStudentInteractive,
  submitStudentInteractiveAttempt,
} from "../../../utils/cabinetAuth";
import "../../styles/interactive-play.css";
import "../../styles/interactive-appearance.css";

const STUDENT_BACK_HREF = "/cabinet/student/assignments";

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

  const handleComplete = useCallback(async (score, details) => {
    try {
      await submitStudentInteractiveAttempt(id, {
        score_percent: score,
        raw_answers: details ? {
          spins_count: details.spins_count,
          results: details.results,
          answers: details.answers,
          score: details.score,
          max_score: details.max_score,
          percent: details.percent,
          duration_sec: details.duration_sec,
        } : {},
        mistakes: details?.mistakes || [],
      });
    } catch (err) {
      if (import.meta.env.DEV) console.error("Submit interactive attempt failed:", err);
    }
  }, [id]);

  return (
    <div className="interactive-play-page interactive-play-page--shell">
      <InteractiveShell
        interactive={interactive}
        appearance={appearance}
        loading={loading}
        error={error || (!loading && !interactive ? "Интерактив недоступен" : "")}
        exitHref={STUDENT_BACK_HREF}
        exitLabel="К заданиям"
        onComplete={handleComplete}
        bare
        playing
        canRestart={interactive?.params?.allowRetry !== false}
      />
    </div>
  );
}
