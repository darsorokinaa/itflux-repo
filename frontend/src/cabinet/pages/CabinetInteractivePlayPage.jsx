import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import InteractiveShell from "../components/InteractiveShell";
import {
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
} from "../interactiveAppearance";
import { canShareInteractive } from "../interactivesData";
import { mapApiInteractiveDetail } from "../interactivesApi";
import { fetchInteractive } from "../../utils/cabinetAuth";
import "../styles/interactive-play.css";
import "../styles/interactive-wheel.css";
import "../styles/interactive-appearance.css";

export default function CabinetInteractivePlayPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [interactive, setInteractive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { catalog } = useInteractiveAppearanceCatalog();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchInteractive(id)
      .then((data) => {
        if (!cancelled) setInteractive(mapApiInteractiveDetail(data));
      })
      .catch((err) => {
        if (!cancelled) {
          setInteractive(null);
          setError(err?.message || "Не удалось загрузить интерактив");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!loading && interactive && !canShareInteractive(interactive)) {
      navigate(`/cabinet/interactives/${id}`, { replace: true });
    }
  }, [loading, interactive, id, navigate]);

  const appearance = useMemo(
    () => (interactive ? resolveInteractiveAppearance(interactive, catalog) : null),
    [interactive, catalog],
  );

  return (
    <div
      className="interactive-play-page interactive-play-page--shell"
      onPointerDown={() => import("../interactiveSounds").then((m) => m.unlockInteractiveAudio())}
    >
      <InteractiveShell
        interactive={interactive}
        appearance={appearance}
        loading={loading}
        error={error}
        exitHref={`/cabinet/interactives/${id || ""}`}
        exitLabel="Назад"
        editHref={interactive ? `/cabinet/interactives/${interactive.id}/edit` : null}
        status={interactive?.status}
        bare
        playing={false}
        showIntro
        canRestart={interactive?.params?.allowRetry !== false}
      />
    </div>
  );
}
