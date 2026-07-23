/** Компактная панель синхронизации активного материала. */

export default function MaterialCollabBar({
  canManage,
  title,
  typeLabel,
  interactionMode = "view_only",
  syncStatus = "synced",
  collaborative = false,
  onToggleCollaborative,
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

  const modeLabel = collaborative || interactionMode === "collaborative"
    ? "Совместная работа"
    : "Только просмотр";

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
          </span>
        </div>
        {notice ? <p className="vl-collab-bar__notice">{notice}</p> : null}
      </div>
      <div className="vl-collab-bar__actions">
        {tools}
        {canManage ? (
          <label className="vl-collab-bar__toggle">
            <input
              type="checkbox"
              checked={Boolean(collaborative || interactionMode === "collaborative")}
              onChange={(e) => onToggleCollaborative?.(e.target.checked)}
            />
            <span>Совместное управление</span>
          </label>
        ) : (
          <span className="vl-collab-bar__student-mode">
            {interactionMode === "collaborative"
              ? "Совместная работа"
              : "Преподаватель управляет материалом"}
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
