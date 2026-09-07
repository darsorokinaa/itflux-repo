/** Chrome around the existing Jitsi iframe while screen sharing / compact. */

import CabinetIcon from "../CabinetIcons";

export default function MiniCallBar({
  collapsed = false,
  remoteName = "",
  remoteAudioMuted = null,
  remoteVideoMuted = null,
  localMicOn = false,
  localCamOn = false,
  sharing = false,
  stayOnTopAvailable = false,
  stayOnTopActive = false,
  onToggleCollapsed,
  onExpand,
  onToggleMic,
  onToggleCam,
  onStayOnTop,
  onHangup,
}) {
  const name = remoteName || "Участник";
  return (
    <div className="video-lesson-compact-drag mini-call-bar">
      <div className="mini-call-bar__who">
        <span className="mini-call-bar__avatar" aria-hidden="true">
          <CabinetIcon name="user" />
        </span>
        <span className="mini-call-bar__meta">
          <span className="mini-call-bar__name">{collapsed ? "Звонок скрыт" : name}</span>
          <span className="mini-call-bar__flags">
            {sharing ? <span className="mini-call-bar__share">Демонстрация</span> : null}
            {remoteAudioMuted === true ? <span>микрофон выкл.</span> : null}
            {remoteVideoMuted === true ? <span>камера выкл.</span> : null}
          </span>
        </span>
      </div>
      <div className="video-lesson-compact-drag__actions mini-call-bar__actions">
        {collapsed ? (
          <button
            type="button"
            className="video-lesson-compact-drag__expand"
            onClick={onToggleCollapsed}
          >
            Показать
          </button>
        ) : (
          <>
            <button
              type="button"
              className={`mini-call-bar__iconbtn${localMicOn ? "" : " is-off"}`}
              aria-label={localMicOn ? "Выключить микрофон" : "Включить микрофон"}
              title={localMicOn ? "Выключить микрофон" : "Включить микрофон"}
              onClick={onToggleMic}
            >
              <CabinetIcon name={localMicOn ? "mic" : "micOff"} />
            </button>
            <button
              type="button"
              className={`mini-call-bar__iconbtn${localCamOn ? "" : " is-off"}`}
              aria-label={localCamOn ? "Выключить камеру" : "Включить камеру"}
              title={localCamOn ? "Выключить камеру" : "Включить камеру"}
              onClick={onToggleCam}
            >
              <CabinetIcon name={localCamOn ? "video" : "videoOff"} />
            </button>
            {stayOnTopAvailable ? (
              <button
                type="button"
                className={`video-lesson-compact-drag__expand${stayOnTopActive ? " is-active" : ""}`}
                onClick={onStayOnTop}
                title="Показывать звонок поверх других окон"
              >
                {stayOnTopActive ? "Скрыть окно" : "Поверх окон"}
              </button>
            ) : null}
            <button
              type="button"
              className="video-lesson-compact-drag__expand"
              onClick={onToggleCollapsed}
            >
              Скрыть
            </button>
            <button
              type="button"
              className="video-lesson-compact-drag__expand"
              onClick={onExpand}
            >
              На весь экран
            </button>
            <button
              type="button"
              className="mini-call-bar__iconbtn mini-call-bar__iconbtn--hangup"
              aria-label="Завершить звонок"
              title="Завершить звонок"
              onClick={onHangup}
            >
              <CabinetIcon name="close" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
