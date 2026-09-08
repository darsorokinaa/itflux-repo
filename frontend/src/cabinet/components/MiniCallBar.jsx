/** Chrome around the existing Jitsi iframe while screen sharing / compact. */

import CabinetIcon from "../CabinetIcons";

export default function MiniCallBar({
  collapsed = false,
  remoteName = "",
  remoteAudioMuted = null,
  remoteVideoMuted = null,
  sharing = false,
  stayOnTopAvailable = false,
  stayOnTopActive = false,
  onToggleCollapsed,
  onExpand,
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
            {stayOnTopAvailable ? (
              <button
                type="button"
                className={`video-lesson-compact-drag__expand${stayOnTopActive ? " is-active" : ""}`}
                onClick={onStayOnTop}
                title="Показывать звонок поверх других окон"
                aria-pressed={stayOnTopActive}
              >
                {stayOnTopActive ? "Вернуть в урок" : "Поверх окон"}
              </button>
            ) : null}
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
