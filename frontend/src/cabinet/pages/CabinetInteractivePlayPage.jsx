import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import InteractivePlayer from "../components/InteractivePlayer";
import {
  appearancePageClass,
  appearancePageStyle,
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
  const [interactive, setInteractive] = useState(null);
  const [loading, setLoading] = useState(true);
  const { catalog } = useInteractiveAppearanceCatalog();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInteractive(id)
      .then((data) => {
        if (!cancelled) setInteractive(mapApiInteractiveDetail(data));
      })
      .catch(() => {
        if (!cancelled) setInteractive(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const appearance = useMemo(
    () => (interactive ? resolveInteractiveAppearance(interactive, catalog) : null),
    [interactive, catalog],
  );

  if (loading) {
    return <p className="cb-loading">Загрузка…</p>;
  }

  if (!interactive) {
    return <Navigate to="/cabinet/interactives" replace />;
  }

  if (!canShareInteractive(interactive)) {
    return <Navigate to={`/cabinet/interactives/${id}`} replace />;
  }

  return (
    <div
      className={`interactive-play-page ${appearancePageClass(appearance)}`}
      style={appearancePageStyle(appearance)}
      onPointerDown={() => import("../interactiveSounds").then((m) => m.unlockInteractiveAudio())}
    >
      <InteractivePlayer interactive={interactive} appearance={appearance} bare />
    </div>
  );
}
