/** Компактная панель синхронизации активного материала. */

export default function MaterialCollabBar({
  canManage,
  title,
  typeLabel,
  interactionMode = "view_only",
  followPolicy = "strict",
  syncStatus = "synced",
  collaborative = false,
  isController = true,
  controllerLabel = "",
  onToggleCollaborative,
  onAllowIndependent,
  onReturnToLeader,
  onTransferControl,
  onClose,
  onCloseLocal,
  tools = null,
  notice = "",
  presenceLabel = "",
}) {
  const statusLabel = {
    synced: "Синхронизировано",
    reconnecting: "Подключение восстанавливается",
    offline: "Ученик не подключён",
    error: "Ошибка синхронизации",
    saved: "Состояние сохранено",
  }[syncStatus] || "Синхронизировано";

  const independent = followPolicy === "independent";
  const modeLabel = collaborative || interactionMode === "collaborative"
    ? "Совместная работа (рисование)"
    : (independent
      ? (canManage ? "Самостоятельный просмотр" : "Самостоятельный режим")
      : (canManage ? "Ученики следуют за вами" : "Вы следуете за учителем"));

  return (
    <div className="vl-collab-bar">
      <div className="vl-collab-bar__main">
        <div className="vl-collab-bar__titles">
          <strong className="vl-collab-bar__title">{title || "Материал"}</strong>
          <span className="vl-collab-bar__meta">
            {typeLabel || "Материал"}
            {" · "}
            {modeLabel}
            {" · "}
            <span className={`vl-collab-bar__sync is-${syncStatus}`}>{statusLabel}</span>
            {presenceLabel ? ` · ${presenceLabel}` : ""}
            {controllerLabel ? ` · Ведёт: ${controllerLabel}` : ""}
          </span>
        </div>
        {notice ? <p className="vl-collab-bar__notice">{notice}</p> : null}
        {!canManage && !independent ? (
          <p className="vl-collab-bar__notice">Вы следуете за учителем · можно отвечать на текущем слайде</p>
        ) : null}
      </div>
      <div className="vl-collab-bar__actions">
        {tools}
        {canManage ? (
          <>
            <button
              type="button"
              className="video-lesson-btn video-lesson-btn--secondary"
              onClick={() => (independent ? onReturnToLeader?.() : onAllowIndependent?.())}
              disabled={!isController}
              title={!isController ? "Сначала получите управление материалом" : undefined}
            >
              {independent ? "Вернуть к моему экрану" : "Разрешить самостоятельный просмотр"}
            </button>
            <label className="vl-collab-bar__toggle">
              <input
                type="checkbox"
                checked={Boolean(collaborative || interactionMode === "collaborative")}
                onChange={(e) => onToggleCollaborative?.(e.target.checked)}
                disabled={!isController}
              />
              <span>Рисование вместе</span>
            </label>
            {onTransferControl ? (
              <button
                type="button"
                className="video-lesson-btn video-lesson-btn--ghost"
                onClick={() => onTransferControl()}
              >
                Передать управление
              </button>
            ) : null}
          </>
        ) : (
          <span className="vl-collab-bar__student-mode">
            {independent
              ? "Самостоятельный просмотр"
              : "Вы следуете за учителем · можно отвечать"}
          </span>
        )}
        {canManage && onClose ? (
          <button
            type="button"
            className="video-lesson-btn video-lesson-btn--secondary"
            onClick={onClose}
          >
            Закрыть для всех
          </button>
        ) : null}
        {onCloseLocal ? (
          <button
            type="button"
            className="video-lesson-icon-btn"
            aria-label="Закрыть материал"
            title="Закрыть"
            onClick={onCloseLocal}
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
