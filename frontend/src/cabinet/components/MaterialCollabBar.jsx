/** Компактная панель синхронизации активного материала. */

import { COLLAB_PERMISSIONS } from "../materials/collab/constants";

const PERMISSION_LABELS = {
  [COLLAB_PERMISSIONS.ANSWERS_ONLY]: "Только ответы",
  [COLLAB_PERMISSIONS.ANNOTATE]: "Комментарии и рисование",
  [COLLAB_PERMISSIONS.EDIT_CONTENT]: "Редактирование содержимого",
  [COLLAB_PERMISSIONS.FULL]: "Полный совместный доступ",
};

export default function MaterialCollabBar({
  canManage,
  title,
  typeLabel,
  interactionMode = "view_only",
  followPolicy = "strict",
  syncStatus = "synced",
  collaborative = false,
  collaborationPermission = COLLAB_PERMISSIONS.ANNOTATE,
  isController = true,
  controllerLabel = "",
  localBrowsingAway = false,
  onToggleCollaborative,
  onConfigurePermissions,
  onAllowIndependent,
  onReturnToLeader,
  onTransferControl,
  onClose,
  onCloseLocal,
  tools = null,
  notice = "",
  presenceLabel = "",
  capabilities = null,
}) {
  const statusLabel = {
    synced: "Синхронизировано",
    reconnecting: "Соединение восстанавливается",
    offline: "Соединение потеряно",
    error: "Ошибка синхронизации",
    saved: "Состояние сохранено",
  }[syncStatus] || "Синхронизировано";

  const independent = followPolicy === "independent";
  const isCollab = collaborative || interactionMode === "collaborative";

  const modeLabel = isCollab
    ? `Совместная работа · ${PERMISSION_LABELS[collaborationPermission] || collaborationPermission}`
    : (localBrowsingAway
      ? "Временно не следуете за учителем"
      : (independent
        ? (canManage ? "Самостоятельный просмотр" : "Самостоятельный режим")
        : (canManage ? "Ученики следуют за вами" : "Следовать за учителем")));

  return (
    <div className="vl-collab-bar">
      <div className="vl-collab-bar__main">
        <div className="vl-collab-bar__titles">
          <strong className="vl-collab-bar__title">{title || "Материал"}</strong>
          <span className="vl-collab-bar__meta">
            {typeLabel || "Материал"}
            {" · "}
            <span className={`vl-collab-bar__mode${isCollab ? " is-collab" : " is-follow"}`}>
              {modeLabel}
            </span>
            {" · "}
            <span className={`vl-collab-bar__sync is-${syncStatus}`}>{statusLabel}</span>
            {presenceLabel ? ` · ${presenceLabel}` : ""}
            {controllerLabel ? ` · Ведёт: ${controllerLabel}` : ""}
          </span>
        </div>
        {notice ? <p className="vl-collab-bar__notice">{notice}</p> : null}
        {!canManage && !independent && !localBrowsingAway && !isCollab ? (
          <p className="vl-collab-bar__notice">Режим: следовать за учителем · можно отвечать на задания</p>
        ) : null}
        {capabilities?.cellEditing ? (
          <p className="vl-collab-bar__notice">Таблица: изменения ячеек синхронизируются операциями</p>
        ) : null}
      </div>
      <div className="vl-collab-bar__actions">
        {tools}
        {canManage ? (
          <>
            <div className="vl-collab-bar__mode-switch" role="group" aria-label="Режим работы">
              <button
                type="button"
                className={`video-lesson-btn${!isCollab ? " video-lesson-btn--primary" : " video-lesson-btn--ghost"}`}
                disabled={!isController || !isCollab}
                onClick={() => onToggleCollaborative?.(false)}
                title="Вернуть режим следования за учителем"
              >
                Следовать за учителем
              </button>
              <button
                type="button"
                className={`video-lesson-btn${isCollab ? " video-lesson-btn--primary" : " video-lesson-btn--secondary"}`}
                disabled={!isController}
                onClick={() => {
                  if (isCollab) onConfigurePermissions?.();
                  else onToggleCollaborative?.(true);
                }}
              >
                {isCollab ? "Настроить права" : "Включить совместную работу"}
              </button>
            </div>
            {isCollab ? (
              <button
                type="button"
                className="video-lesson-btn video-lesson-btn--secondary"
                disabled={!isController}
                onClick={() => onToggleCollaborative?.(false)}
              >
                Завершить совместную работу
              </button>
            ) : null}
            <button
              type="button"
              className="video-lesson-btn video-lesson-btn--secondary"
              onClick={() => (independent ? onReturnToLeader?.() : onAllowIndependent?.())}
              disabled={!isController}
              title={!isController ? "Сначала получите управление материалом" : undefined}
            >
              {independent ? "Вернуть к моему экрану" : "Разрешить самостоятельный просмотр"}
            </button>
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
            {localBrowsingAway
              ? (
                <button type="button" className="video-lesson-btn video-lesson-btn--primary" onClick={() => onReturnToLeader?.()}>
                  Вернуться к учителю
                </button>
              )
              : (isCollab
                ? `Совместная работа · ${PERMISSION_LABELS[collaborationPermission] || ""}`
                : (independent ? "Самостоятельный просмотр" : "Вы следуете за учителем"))}
          </span>
        )}
        {canManage && onClose ? (
          <button type="button" className="video-lesson-btn video-lesson-btn--secondary" onClick={onClose}>
            Закрыть для всех
          </button>
        ) : null}
        {!canManage && onCloseLocal ? (
          <button type="button" className="video-lesson-btn video-lesson-btn--ghost" onClick={onCloseLocal}>
            Свернуть
          </button>
        ) : null}
      </div>
    </div>
  );
}
