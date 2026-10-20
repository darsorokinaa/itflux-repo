import { lazy, Suspense, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import ErrorBoundary from "../../components/ErrorBoundary";
import { importWithRetry } from "../../utils/importWithRetry";
import { resolvePersistentMeetingView, useActiveLiveMeeting } from "../liveMeetingSession";
import { useFloatingDrag } from "../useFloatingDrag";
import "../styles/meeting-persist.css";

const VideoMeetingPage = lazy(() => importWithRetry(() => import("../pages/VideoMeetingPage")));

/**
 * Постоянный слой звонка (r92b). Структура DOM одинакова в обоих режимах —
 * меняются только классы/стили, поэтому iframe Jitsi не перемонтируется.
 */
export default function PersistentMeetingHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = useActiveLiveMeeting();
  const inIframe = typeof window !== "undefined" && window.self !== window.top;
  const view = inIframe ? null : resolvePersistentMeetingView({ pathname: location.pathname, activeUuid: active });
  const mini = view?.mode === "mini";
  const { nodeRef, style, onPointerDown } = useFloatingDrag({
    enabled: mini,
    resizable: false,
    storageKey: "meeting-persist-mini",
    handleSelector: ".meeting-persist__bar",
  });

  useEffect(() => {
    if (!mini) return;
    // Полноэкранный fallback комнаты не должен перекрывать другие страницы.
    document.body.classList.remove("vl-room-fullscreen");
  }, [mini]);

  if (!view) return null;
  const meetingPath = `/cabinet/meetings/${encodeURIComponent(view.uuid)}`;
  return (
    <div
      ref={nodeRef}
      className={`meeting-persist ${mini ? "meeting-persist--mini" : "meeting-persist--full"}`}
      style={mini ? style : undefined}
      data-testid="meeting-persist"
      data-mode={view.mode}
    >
      {mini ? (
        <div className="meeting-persist__bar" onPointerDown={onPointerDown}>
          <span className="meeting-persist__live" aria-hidden="true" />
          <span className="meeting-persist__title">Идёт урок</span>
          <button
            type="button"
            className="meeting-persist__return"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => navigate(meetingPath)}
          >
            Вернуться в урок
          </button>
        </div>
      ) : null}
      <div
        className="meeting-persist__viewport"
        onClick={mini ? () => navigate(meetingPath) : undefined}
        role={mini ? "button" : undefined}
        aria-label={mini ? "Развернуть звонок" : undefined}
      >
        <div className="meeting-persist__stage" aria-hidden={mini ? "true" : undefined}>
          <ErrorBoundary kind="room" homeHref="/cabinet">
            <Suspense fallback={null}>
              <VideoMeetingPage key={view.uuid} meetingUuid={view.uuid} presentation={view.mode} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
