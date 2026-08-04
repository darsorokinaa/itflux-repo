import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { getInteractiveDisplayTitle, getStatusMeta, getTypeMeta } from "../interactivesData";
import { appearancePageClass, appearancePageStyle } from "../interactiveAppearance";
import { cloneInteractiveForPlay } from "../interactiveNormalize";
import InteractivePlayer from "./InteractivePlayer";
import ConfirmActionModal from "./ConfirmActionModal";

/**
 * Shared chrome for playing an interactive:
 * top bar, restart, exit, loading/error, session remount via sessionKey.
 */
export default function InteractiveShell({
  interactive,
  appearance,
  mode = "play",
  exitHref,
  exitLabel = "Выйти",
  onExit,
  onComplete,
  showIntro,
  bare = true,
  playing = true,
  canRestart = true,
  status,
  authorName,
  editHref,
  error,
  loading,
  children,
}) {
  const interactiveId = interactive?.id ?? null;
  const [sessionKey, setSessionKey] = useState(0);
  const [phase, setPhase] = useState("ready");
  const [hasProgress, setHasProgress] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [boundId, setBoundId] = useState(interactiveId);

  if (boundId !== interactiveId) {
    setBoundId(interactiveId);
    setSessionKey(0);
    setPhase("ready");
    setHasProgress(false);
  }

  const playData = interactive ? cloneInteractiveForPlay(interactive) : null;

  const markProgress = useCallback(() => {
    setHasProgress(true);
    setPhase((p) => (p === "completed" ? p : "playing"));
  }, []);

  const handleComplete = useCallback((score, details) => {
    setPhase("completed");
    setHasProgress(false);
    onComplete?.(score, details);
  }, [onComplete]);

  const doRestart = useCallback(() => {
    setHasProgress(false);
    setPhase("playing");
    setSessionKey((k) => k + 1);
    setConfirmRestart(false);
  }, []);

  const requestRestart = useCallback(() => {
    if (!canRestart) return;
    if (phase === "playing" && hasProgress) {
      setConfirmRestart(true);
      return;
    }
    doRestart();
  }, [canRestart, phase, hasProgress, doRestart]);

  if (loading) {
    return (
      <div className="ix-shell ix-shell--loading" role="status">
        <p className="ix-shell__status">Загрузка…</p>
      </div>
    );
  }

  if (error || !interactive) {
    return (
      <div className="ix-shell ix-shell--error" role="alert">
        <p className="ix-shell__status">{error || "Интерактив не найден"}</p>
        {exitHref ? (
          <Link to={exitHref} className="cb-btn cb-btn--outline">{exitLabel}</Link>
        ) : onExit ? (
          <button type="button" className="cb-btn cb-btn--outline" onClick={onExit}>{exitLabel}</button>
        ) : null}
      </div>
    );
  }

  const typeMeta = getTypeMeta(interactive.type);
  const statusMeta = status ? getStatusMeta(status) : null;
  const title = getInteractiveDisplayTitle(interactive);

  const pageClass = [
    "ix-shell",
    `ix-shell--${mode}`,
    appearance ? appearancePageClass(appearance) : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={pageClass} style={appearance ? appearancePageStyle(appearance) : undefined}>
      <header className="ix-shell__bar">
        <div className="ix-shell__bar-start">
          {exitHref ? (
            <Link to={exitHref} className="ix-shell__back" aria-label={exitLabel}>
              ← {exitLabel}
            </Link>
          ) : onExit ? (
            <button type="button" className="ix-shell__back" onClick={onExit} aria-label={exitLabel}>
              ← {exitLabel}
            </button>
          ) : null}
          <div className="ix-shell__identity">
            <p className="ix-shell__type">{typeMeta.shortLabel}</p>
            <h1 className="ix-shell__title">{title}</h1>
            <p className="ix-shell__meta">
              {authorName ? <span>{authorName}</span> : null}
              {statusMeta ? (
                <span className={`ix-status-badge ix-status-badge--${statusMeta.tone}`}>
                  {statusMeta.label}
                </span>
              ) : null}
            </p>
          </div>
        </div>
        <div className="ix-shell__bar-actions">
          {canRestart ? (
            <button
              type="button"
              className="cb-btn cb-btn--outline cb-btn--sm ix-shell__restart"
              onClick={requestRestart}
            >
              {phase === "completed" ? "Пройти ещё раз" : "Начать заново"}
            </button>
          ) : null}
          {editHref ? (
            <Link to={editHref} className="cb-btn cb-btn--outline cb-btn--sm">
              Редактировать
            </Link>
          ) : null}
        </div>
      </header>

      <div
        className="ix-shell__body"
        onPointerDown={markProgress}
        onKeyDown={markProgress}
      >
        {children || (
          <InteractivePlayer
            key={sessionKey}
            interactive={playData}
            appearance={appearance}
            bare={bare}
            playing={playing}
            showIntro={showIntro}
            onComplete={handleComplete}
            onProgress={markProgress}
            sessionKey={sessionKey}
          />
        )}
      </div>

      <ConfirmActionModal
        open={confirmRestart}
        title="Начать заново?"
        text="Текущий прогресс будет сброшен. Начать заново?"
        confirmLabel="Начать заново"
        onClose={() => setConfirmRestart(false)}
        onConfirm={doRestart}
      />
    </div>
  );
}
