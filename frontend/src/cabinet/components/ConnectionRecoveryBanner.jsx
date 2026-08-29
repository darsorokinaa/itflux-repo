/** Non-blocking resume banner. Never covers the whole lesson UI. */

export default function ConnectionRecoveryBanner({
  phase = "hidden",
  title = "",
  showReconnect = false,
  showReload = false,
  onReconnect,
  onReload,
  testId = "connection-recovery",
}) {
  if (phase === "hidden" || !title) return null;
  const reconnecting = phase === "reconnecting";
  return (
    <div
      className={`itflux-recovery-banner itflux-recovery-banner--${phase}`}
      role={phase === "failed" ? "alert" : "status"}
      data-testid={testId}
    >
      <div className="itflux-recovery-banner__row">
        {reconnecting ? (
          <span className="itflux-recovery-banner__spinner" aria-hidden="true" />
        ) : null}
        <p className="itflux-recovery-banner__title">{title}</p>
      </div>
      {showReconnect || showReload ? (
        <div className="itflux-recovery-banner__actions">
          {showReconnect ? (
            <button
              type="button"
              className="itflux-recovery-banner__btn itflux-recovery-banner__btn--primary"
              data-testid={`${testId}-reconnect`}
              onClick={onReconnect}
            >
              Переподключиться
            </button>
          ) : null}
          {showReload ? (
            <button
              type="button"
              className="itflux-recovery-banner__btn"
              data-testid={`${testId}-reload`}
              onClick={onReload}
            >
              Обновить комнату
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
