/** Компактная панель синхронизации активного материала. */

import { useEffect, useRef, useState } from "react";

import { COLLAB_PERMISSIONS } from "../materials/collab/constants";
import { PRESENTATION_MODES, derivePresentationMode } from "../materials/collab/modes";
import {
  COLLAB_STATUS_GRACE_MS,
  COLLAB_UI,
  classifyCollabConnection,
  presenceCountLabel,
} from "../collabConnectionUi";
import { MATERIAL_COLLABORATION_ENABLED } from "../featureFlags";

const PERMISSION_LABELS = {
  [COLLAB_PERMISSIONS.ANSWERS_ONLY]: "Только ответы",
  [COLLAB_PERMISSIONS.ANNOTATE]: "Комментарии и рисование",
  [COLLAB_PERMISSIONS.EDIT_CONTENT]: "Редактирование содержимого",
  [COLLAB_PERMISSIONS.FULL]: "Полный совместный доступ",
};

const MODE_OPTIONS = [
  { id: PRESENTATION_MODES.INDEPENDENT, label: "Самостоятельно" },
  { id: PRESENTATION_MODES.PRESENTATION, label: "Презентация" },
  { id: PRESENTATION_MODES.COLLABORATION, label: "Совместная работа" },
];

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
  presentationMode: presentationModeProp = null,
  syncStatus = "synced",
  collaborative = false,
  collaborationPermission = COLLAB_PERMISSIONS.ANNOTATE,
  isController = true,
  controllerLabel = "",
  localBrowsingAway = false,
  onToggleCollaborative,
  onSetPresentationMode,
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
  pointerActive = false,
  onTogglePointer = null,
}) {
  const isCollab = collaborative || interactionMode === "collaborative";
  const presentationMode = presentationModeProp || derivePresentationMode({
    interactionMode,
    followPolicy: isCollab ? "strict" : followPolicy,
  });
  const connection = classifyCollabConnection({
    transport: transportFromSync(syncStatus),
    peerCount: Math.max(0, Number(presenceCount) || 0),
    collaborative: isCollab,
    reconnectElapsedMs: syncStatus === "reconnecting"
      ? Math.max(reconnectElapsedMs, COLLAB_STATUS_GRACE_MS)
      : reconnectElapsedMs,
  });
  const statusKind = connection.kind;
  const showSyncStatus =
    statusKind === COLLAB_UI.CONNECTING
    || statusKind === COLLAB_UI.RECONNECTING
    || statusKind === COLLAB_UI.ERROR
    || statusKind === COLLAB_UI.OFFLINE;
  const statusLabel = connection.label;
  const peopleLabel = presenceCountLabel((Number(presenceCount) || 0) + 1);
  const independent = presentationMode === PRESENTATION_MODES.INDEPENDENT;
  const [modeOpen, setModeOpen] = useState(false);
  const modeRef = useRef(null);

  useEffect(() => {
    if (!modeOpen) return undefined;
    const onDoc = (e) => {
      if (modeRef.current && !modeRef.current.contains(e.target)) setModeOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [modeOpen]);

  const activeModeLabel = MODE_OPTIONS.find((m) => m.id === presentationMode)?.label || "Режим";

  const studentBanner = !canManage && !independent
    ? (isCollab ? "Совместная работа включена" : "Вы следуете за учителем")
    : "";

  const modeLabel = isCollab
    ? `Совместная работа · ${PERMISSION_LABELS[collaborationPermission] || collaborationPermission}`
    : (localBrowsingAway
      ? "Временно не следуете за учителем"
      : (independent
        ? (canManage ? "Самостоятельный просмотр" : "Самостоятельный режим")
        : (canManage ? "Ученики следуют за вами" : "Следовать за учителем")));

  const setMode = (mode) => {
    setModeOpen(false);
    if (onSetPresentationMode) {
      onSetPresentationMode(mode);
      return;
    }
    if (mode === PRESENTATION_MODES.COLLABORATION) onToggleCollaborative?.(true);
    else onToggleCollaborative?.(false);
    if (mode === PRESENTATION_MODES.INDEPENDENT) onAllowIndependent?.();
    if (mode === PRESENTATION_MODES.PRESENTATION) onReturnToLeader?.();
  };

  return (
    <div className="vl-collab-bar">
      <div className="vl-collab-bar__main">
        <div className="vl-collab-bar__titles">
          <strong className="vl-collab-bar__title">{title || "Материал"}</strong>
          <span className="vl-collab-bar__meta">
            {typeLabel || "Материал"}
            {" · "}
            <span className={`vl-collab-bar__mode${isCollab ? " is-collab" : independent ? " is-independent" : " is-follow"}`}>
              {modeLabel}
            </span>
            {showSyncStatus ? (
              <>
                {" · "}
                <span className={`vl-collab-bar__sync is-${statusKind}`}>{statusLabel}</span>
              </>
            ) : (
              <>
                {" · "}
                <span className={`vl-collab-bar__sync is-${statusKind}`} title="Связь с комнатой">
                  {statusKind === COLLAB_UI.CONNECTED || statusKind === COLLAB_UI.COLLAB_ACTIVE ? "онлайн" : statusLabel}
                </span>
              </>
            )}
            {peopleLabel ? ` · ${peopleLabel}` : ""}
            {presenceLabel ? ` · ${presenceLabel}` : ""}
            {controllerLabel ? ` · Ведёт: ${controllerLabel}` : ""}
          </span>
        </div>
        {notice ? <p className="vl-collab-bar__notice">{notice}</p> : null}
        {studentBanner ? <p className="vl-collab-bar__follow-chip" role="status">{studentBanner}</p> : null}
        {statusKind === COLLAB_UI.ERROR && onRetrySync ? (
          <button
            type="button"
            className="video-lesson-btn video-lesson-btn--primary"
            onClick={() => onRetrySync()}
          >
            Попробовать снова
          </button>
        ) : null}
        {capabilities?.cellEditing ? (
          <p className="vl-collab-bar__notice">Таблица: изменения ячеек синхронизируются операциями</p>
        ) : null}
      </div>
      <div className="vl-collab-bar__actions">
        {tools}
        {canManage && MATERIAL_COLLABORATION_ENABLED ? (
          <>
            <div className="vl-collab-bar__mode-menu" ref={modeRef}>
              <button
                type="button"
                className="video-lesson-btn video-lesson-btn--secondary"
                disabled={!isController}
                aria-haspopup="menu"
                aria-expanded={modeOpen}
                onClick={() => setModeOpen((v) => !v)}
              >
                Режим: {activeModeLabel}
              </button>
              {modeOpen ? (
                <div className="vl-collab-bar__mode-dropdown" role="menu">
                  {MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitem"
                      className={opt.id === presentationMode ? "is-active" : ""}
                      onClick={() => setMode(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {presentationMode === PRESENTATION_MODES.PRESENTATION ? (
              <button
                type="button"
                className="video-lesson-btn video-lesson-btn--secondary"
                disabled={!isController}
                onClick={() => setMode(PRESENTATION_MODES.COLLABORATION)}
              >
                Разрешить ученику взаимодействовать
              </button>
            ) : null}
            {presentationMode === PRESENTATION_MODES.COLLABORATION ? (
              <>
                <button
                  type="button"
                  className="video-lesson-btn video-lesson-btn--secondary"
                  disabled={!isController}
                  onClick={() => setMode(PRESENTATION_MODES.PRESENTATION)}
                >
                  Запретить взаимодействие
                </button>
                <button
                  type="button"
                  className="video-lesson-btn video-lesson-btn--ghost"
                  disabled={!isController}
                  onClick={() => onConfigurePermissions?.()}
                >
                  Права
                </button>
              </>
            ) : null}
            {onTogglePointer ? (
              <button
                type="button"
                className={`video-lesson-btn${pointerActive ? " video-lesson-btn--primary" : " video-lesson-btn--ghost"}`}
                onClick={() => onTogglePointer()}
                title="Указатель преподавателя"
              >
                Указатель
              </button>
            ) : null}
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
        ) : canManage ? (
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
            <button
              type="button"
              className="video-lesson-btn video-lesson-btn--secondary"
              onClick={() => (independent ? onReturnToLeader?.() : onAllowIndependent?.())}
              disabled={!isController}
            >
              {independent ? "Вернуть к моему экрану" : "Разрешить самостоятельный просмотр"}
            </button>
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
