import { useEffect, useRef, useState } from "react";

import { RC_STATES, detectRemoteControlCapability } from "../jitsiRemoteControl";

function participantLabel(p) {
  return String(p?.displayName || p?.id || "Участник").trim() || "Участник";
}

export default function ScreenShareControlBar({
  visible = false,
  localSharing = false,
  shareActive = false,
  capability = null,
  rcState = null,
  localId = "",
  participants = [],
  controllerName = "",
  onToggleShare = null,
  onInviteControl = null,
  onRequestControl = null,
  onStopControl = null,
}) {
  const cap = capability || detectRemoteControlCapability();
  const native = Boolean(cap.remoteControlSupported);
  const status = rcState?.status || RC_STATES.IDLE;
  const active = status === RC_STATES.ACTIVE;
  const requested = status === RC_STATES.REQUESTED;
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onDoc = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen]);

  if (!visible || (!localSharing && !shareActive)) return null;

  const remotes = (participants || []).filter((p) => p?.id && p.id !== localId && !p.local);
  const othersCanReceive = remotes.filter((p) => p.remoteControlSupported !== false);
  const isController = Boolean(localId && rcState?.remoteControllerId === localId);
  const isSharer = Boolean(localSharing || (localId && rcState?.screenSharerId === localId));

  let statusText = localSharing ? "Вы демонстрируете экран" : "Идёт демонстрация экрана";
  if (active && isController) statusText = "Вы управляете экраном";
  if (active && isSharer && controllerName) statusText = `${controllerName} управляет`;
  if (active && isSharer && !controllerName) statusText = "Участник управляет экраном";
  if (requested && isSharer) statusText = "Запрос управления экраном";
  if (requested && !isSharer) statusText = "Ожидание разрешения";

  return (
    <div className="vl-ss-control" role="status">
      <span className="vl-ss-control__label">{statusText}</span>
      <div className="vl-ss-control__actions">
        {isSharer && localSharing && native && !active ? (
          <div className="vl-ss-control__picker" ref={pickerRef}>
            <button
              type="button"
              className="video-lesson-btn video-lesson-btn--secondary vl-ss-control__btn"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={!remotes.length}
            >
              Передать управление
            </button>
            {pickerOpen ? (
              <ul className="vl-ss-control__menu">
                {remotes.map((p) => {
                  const canGive = p.remoteControlSupported !== false && native;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={!canGive}
                        onClick={() => {
                          setPickerOpen(false);
                          if (canGive) onInviteControl?.(p.id, p);
                        }}
                      >
                        {participantLabel(p)}
                        {!canGive ? " · нужен клиент" : ""}
                      </button>
                    </li>
                  );
                })}
                {!othersCanReceive.length ? (
                  <li className="vl-ss-control__empty">Нет участников с приложением для управления</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        {!isSharer && shareActive && native && !active && !requested ? (
          <button
            type="button"
            className="video-lesson-btn video-lesson-btn--secondary vl-ss-control__btn"
            onClick={() => onRequestControl?.()}
          >
            Запросить управление
          </button>
        ) : null}

        {active || requested ? (
          <button
            type="button"
            className="video-lesson-btn video-lesson-btn--secondary vl-ss-control__btn"
            onClick={() => onStopControl?.()}
          >
            {isSharer ? "Остановить управление" : "Завершить"}
          </button>
        ) : null}

        {localSharing && onToggleShare ? (
          <button
            type="button"
            className="video-lesson-btn video-lesson-btn--ghost vl-ss-control__btn"
            onClick={() => onToggleShare()}
          >
            Остановить
          </button>
        ) : null}
      </div>
    </div>
  );
}
