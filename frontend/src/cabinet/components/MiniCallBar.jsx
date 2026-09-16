/** Chrome around the existing Jitsi iframe while screen sharing / compact. */

import { useRef, useState } from "react";

import CabinetIcon from "../CabinetIcons";
import CabinetFloatingMenu from "./CabinetFloatingMenu";
import { participantInitials } from "../participantVideo";

export default function MiniCallBar({
  collapsed = false,
  waiting = false,
  remoteName = "",
  remoteAudioMuted = null,
  remoteVideoMuted = null,
  sharing = false,
  shareMode = false,
  pipAvailable = false,
  pipActive = false,
  pipNeedsGesture = false,
  stayOnTopAvailable = false,
  stayOnTopActive = false,
  onToggleCollapsed,
  onExpand,
  onStayOnTop,
  onHangup,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef(null);
  const name = remoteName || "Участник";
  const status = collapsed
    ? "Звонок скрыт"
    : waiting
      ? "Ждём ученика"
      : name;
  const showPip = Boolean(pipAvailable || stayOnTopAvailable || pipNeedsGesture || pipActive);
  const pipOn = Boolean(pipActive || stayOnTopActive);
  const pipLabel = pipOn ? "Вернуть видео в урок" : "Видео поверх окон";
  const pipPromptLabel = pipNeedsGesture && !pipOn ? "Показать ученика поверх окон" : pipLabel;

  const pipButton = showPip ? (
    <button
      type="button"
      className={`mini-call-bar__iconbtn${pipOn ? " is-active" : ""}${pipNeedsGesture && !pipOn ? " is-prompt" : ""}`}
      aria-label={pipPromptLabel}
      title={pipLabel}
      aria-pressed={pipOn}
      onClick={onStayOnTop}
    >
      <CabinetIcon name="pip" />
    </button>
  ) : null;

  if (shareMode) {
    return (
      <>
        {!collapsed && (waiting || remoteVideoMuted) ? (
          <div className="vl-participant-fallback" aria-hidden="true">
            <span className="vl-participant-fallback__avatar">{participantInitials(name)}</span>
            <span className="vl-participant-fallback__name">{waiting ? "Ждём ученика" : name}</span>
          </div>
        ) : null}
        <div
          className={[
            "video-lesson-compact-drag mini-call-bar mini-call-bar--share",
            pipNeedsGesture && !pipOn ? "is-pip-prompt" : "",
          ].filter(Boolean).join(" ")}
        >
          <div className="mini-call-bar__who">
            <span className="mini-call-bar__name">{waiting ? "Ждём ученика" : name}</span>
            <span
              className={`mini-call-bar__mic${remoteAudioMuted ? " is-off" : ""}`}
              title={remoteAudioMuted ? "Микрофон выкл." : "Микрофон вкл."}
              aria-label={remoteAudioMuted ? "Микрофон выкл." : "Микрофон вкл."}
            >
              <CabinetIcon name={remoteAudioMuted ? "micOff" : "mic"} />
            </span>
          </div>
          <div className="video-lesson-compact-drag__actions mini-call-bar__actions">
            {collapsed ? (
              <button
                type="button"
                className="video-lesson-compact-drag__expand"
                aria-label="Показать"
                onClick={onToggleCollapsed}
              >
                Развернуть
              </button>
            ) : (
              <>
                {pipButton}
                <button
                  type="button"
                  className="mini-call-bar__iconbtn"
                  aria-label="Скрыть"
                  title="Свернуть"
                  onClick={onToggleCollapsed}
                >
                  <CabinetIcon name="minus" />
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="video-lesson-compact-drag mini-call-bar">
      <div className="mini-call-bar__who">
        <span
          className={`mini-call-bar__dot${waiting && !collapsed ? " is-wait" : " is-on"}`}
          aria-hidden="true"
        />
        <span className="mini-call-bar__meta">
          <span className="mini-call-bar__name">{status}</span>
          {!collapsed ? (
            <span className="mini-call-bar__flags">
              {sharing ? <span className="mini-call-bar__share">Демонстрация</span> : null}
              {remoteAudioMuted === true ? <span>микрофон выкл.</span> : null}
              {remoteVideoMuted === true ? <span>камера выкл.</span> : null}
            </span>
          ) : null}
        </span>
      </div>
      <div className="video-lesson-compact-drag__actions mini-call-bar__actions">
        {collapsed ? (
          <button
            type="button"
            className="video-lesson-compact-drag__expand"
            aria-label="Показать"
            onClick={onToggleCollapsed}
          >
            Развернуть
          </button>
        ) : (
          <>
            {pipButton}
            <button
              type="button"
              className="mini-call-bar__iconbtn"
              aria-label="Скрыть"
              title="Свернуть звонок"
              onClick={onToggleCollapsed}
            >
              <CabinetIcon name="minus" />
            </button>
            <button
              ref={moreBtnRef}
              type="button"
              className={`mini-call-bar__iconbtn${moreOpen ? " is-active" : ""}`}
              aria-label="Ещё"
              title="Ещё"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <CabinetIcon name="more" />
            </button>
            <CabinetFloatingMenu
              open={moreOpen}
              anchorEl={moreBtnRef.current}
              onClose={() => setMoreOpen(false)}
              className="vl-dropdown mini-call-bar__menu"
              width={220}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  onExpand?.();
                }}
              >
                На весь экран
              </button>
            </CabinetFloatingMenu>
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
