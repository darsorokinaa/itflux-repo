/** Компактная панель синхронизации активного материала. */

import { COLLAB_PERMISSIONS } from "../materials/collab/constants";
import {
  COLLAB_STATUS_GRACE_MS,
  COLLAB_UI,
  classifyCollabConnection,
  presenceCountLabel,
} from "../collabConnectionUi";

const PERMISSION_LABELS = {
  [COLLAB_PERMISSIONS.ANSWERS_ONLY]: "Только ответы",
  [COLLAB_PERMISSIONS.ANNOTATE]: "Комментарии и рисование",
  [COLLAB_PERMISSIONS.EDIT_CONTENT]: "Редактирование содержимого",
  [COLLAB_PERMISSIONS.FULL]: "Полный совместный доступ",
};

function transportFromSync(syncStatus) {
  if (syncStatus === "synced" || syncStatus === "saved") return "open";
  if (syncStatus === "reconnecting") return "reconnecting";
  if (syncStatus === "offline") return "closed";
  if (syncStatus === "error") return "failed";
  if (syncStatus === "connecting") return "connecting_initial";
  return "open";
}

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
  onRetrySync,
  reconnectElapsedMs = 0,
  tools = null,
  notice = "",
  presenceLabel = "",
  presenceCount = 0,
  capabilities = null,
}) {
  const isCollab = collaborative || interactionMode === "collaborative";
  const connection = classifyCollabConnection({
    transport: transportFromSync(syncStatus),
    peerCount: Math.max(0, Number(presenceCount) || 0),
    collaborative: isCollab,
    reconnectElapsedMs: syncStatus === "reconnecting"
      ? Math.max(reconnectElapsedMs, COLLAB_STATUS_GRACE_MS)
      : reconnectElapsedMs,
  });
  const statusKind = connection.kind;
  const statusLabel = connection.label;
  const peopleLabel = presenceCountLabel((Number(presenceCount) || 0) + 1);
  const independent = followPolicy === "independent";

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
            <span className={`vl-collab-bar__sync is-${statusKind}`}>{statusLabel}</span>
            {peopleLabel ? ` · ${peopleLabel}` : ""}
            {presenceLabel ? ` · ${presenceLabel}` : ""}
            {controllerLabel ? ` · Ведёт: ${controllerLabel}` : ""}
          </span>
        </div>
        {notice ? <p className="vl-collab-bar__notice">{notice}</p> : null}
        {statusKind === COLLAB_UI.ERROR && onRetrySync ? (
          <button
            type="button"
            className="video-lesson-btn video-lesson-btn--primary"
            onClick={() => onRetrySync()}
          >
            Попробовать снова
          </button>
        ) : null}
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
