import { useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import InteractivePlayer from "../components/InteractivePlayer";
import {
  appearancePageClass,
  appearancePageStyle,
  resolveInteractiveAppearance,
  useInteractiveAppearanceCatalog,
} from "../interactiveAppearance";
import { getInteractiveById, canShareInteractive } from "../interactivesData";
import "../styles/interactive-play.css";
import "../styles/interactive-appearance.css";

export default function CabinetInteractivePlayPage() {
  const { id } = useParams();
  const interactive = useMemo(() => getInteractiveById(id), [id]);
  const { catalog } = useInteractiveAppearanceCatalog();
  const appearance = useMemo(
    () => (interactive ? resolveInteractiveAppearance(interactive, catalog) : null),
    [interactive, catalog],
  );

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
