/** Window chrome for the floating lesson call. Does not touch the Jitsi session. */

import { useEffect, useState } from "react";

import CabinetIcon from "../CabinetIcons";
import { participantInitials } from "../participantVideo";

function formatCallElapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

function useCallElapsedLabel(startedAt, active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !startedAt) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active, startedAt]);
  const started = Date.parse(startedAt || "");
  if (!startedAt || !Number.isFinite(started)) return "";
  return formatCallElapsed(now - started);
}

function WindowButton({ label, icon, onClick }) {
  return (
    <button
      type="button"
      className="mini-call-bar__iconbtn"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <CabinetIcon name={icon} />
    </button>
  );
}

export default function MiniCallBar({
  view = "normal",
  waiting = false,
  statusLabel = "",
  remoteName = "",
  startedAt = "",
  remoteAudioMuted = null,
  stageCameraOff = false,
  onMinimize,
  onShow,
  onExpand,
  onCompact,
}) {
  const minimized = view === "minimized";
  const expanded = view === "expanded";
  const callLabel = statusLabel || (waiting ? "Ждём ученика" : remoteName || "Видеозвонок");
  const elapsedLabel = useCallElapsedLabel(startedAt, minimized);
  const name = remoteName || callLabel;
  const showAvatar = !minimized && !waiting && Boolean(stageCameraOff);

  return (
    <>
      {showAvatar ? (
        <div className="vl-participant-fallback" aria-hidden="true">
          <span className="vl-participant-fallback__avatar">{participantInitials(name)}</span>
          <span className="vl-participant-fallback__name">{name}</span>
          {remoteAudioMuted === true ? (
            <span className="vl-participant-fallback__muted" title="Микрофон выключен">
              <CabinetIcon name="micOff" />
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={`video-lesson-compact-drag mini-call-bar${minimized ? " mini-call-bar--chip" : ""}`}>
        <div className="mini-call-bar__who">
          <span
            className={`mini-call-bar__dot${waiting ? " is-wait" : " is-on"}`}
            aria-hidden="true"
          />
          <span className="mini-call-bar__name">{callLabel}</span>
          {minimized && elapsedLabel ? (
            <span className="mini-call-bar__elapsed">{elapsedLabel}</span>
          ) : null}
        </div>
        <div className="mini-call-bar__actions">
          {minimized ? (
            <WindowButton label="Показать видеозвонок" icon="video" onClick={onShow} />
          ) : null}
          {expanded ? (
            <WindowButton label="Вернуть компактный вид" icon="compress" onClick={onCompact} />
          ) : null}
          {!minimized ? (
            <WindowButton label="Свернуть" icon="minus" onClick={onMinimize} />
          ) : null}
          {!minimized && !expanded ? (
            <WindowButton label="Открыть крупнее" icon="expand" onClick={onExpand} />
          ) : null}
        </div>
      </div>
    </>
  );
}
