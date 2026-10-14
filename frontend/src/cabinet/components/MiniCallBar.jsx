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

function WindowButton({ label, icon, onClick, pressed = false, off = false, danger = false, disabled = false }) {
  return (
    <button
      type="button"
      className={[
        "mini-call-bar__iconbtn",
        pressed ? "is-active" : "",
        off ? "is-off" : "",
        danger ? "mini-call-bar__iconbtn--hangup" : "",
      ].filter(Boolean).join(" ")}
      aria-label={label}
      aria-pressed={pressed || off ? "true" : undefined}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <CabinetIcon name={icon} />
    </button>
  );
}

export default function MiniCallBar({
  view = "normal",
  micOn = false,
  micDisabled = false,
  onToggleMic,
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
  callSwitch = null,
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
          {minimized && typeof onToggleMic === "function" ? (
            <button
              type="button"
              className={`mini-call-bar__iconbtn mini-call-bar__mic${micOn ? "" : " is-off"}`}
              aria-label={micOn ? "Выключить микрофон" : "Включить микрофон"}
              aria-pressed={micOn ? "true" : "false"}
              title={micOn ? "Выключить микрофон" : "Включить микрофон"}
              disabled={micDisabled}
              onClick={onToggleMic}
            >
              <CabinetIcon name={micOn ? "mic" : "micOff"} />
            </button>
          ) : null}
        </div>
        <div className="mini-call-bar__actions">
          {callSwitch}
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

export function FloatingCallTools({
  expanded = false,
  micOn = false,
  micDisabled = false,
  camOn = false,
  sharing = false,
  handRaised = false,
  tileWide = false,
  controlsDisabled = false,
  screenShareAvailable = true,
  onToggleMic,
  onToggleCam,
  onToggleShare,
  onToggleHand,
  onToggleLayout,
  onHangup,
}) {
  return (
    <div className="mini-call-tools" role="toolbar" aria-label="Кнопки звонка">
      {typeof onToggleMic === "function" ? (
        <WindowButton
          label={micOn ? "Выключить микрофон" : "Включить микрофон"}
          icon={micOn ? "mic" : "micOff"}
          off={!micOn}
          disabled={micDisabled || controlsDisabled}
          onClick={onToggleMic}
        />
      ) : null}
      {typeof onToggleCam === "function" ? (
        <WindowButton
          label={camOn ? "Выключить камеру" : "Включить камеру"}
          icon={camOn ? "video" : "videoOff"}
          off={!camOn}
          disabled={controlsDisabled}
          onClick={onToggleCam}
        />
      ) : null}
      {typeof onToggleShare === "function" ? (
        <WindowButton
          label={screenShareAvailable ? (sharing ? "Остановить демонстрацию" : "Демонстрация экрана") : "Демонстрация экрана недоступна"}
          icon="display"
          pressed={sharing}
          disabled={controlsDisabled || !screenShareAvailable}
          onClick={onToggleShare}
        />
      ) : null}
      {expanded && typeof onToggleHand === "function" ? (
        <WindowButton
          label={handRaised ? "Опустить руку" : "Поднять руку"}
          icon="hand"
          pressed={handRaised}
          disabled={controlsDisabled}
          onClick={onToggleHand}
        />
      ) : null}
      {expanded && typeof onToggleLayout === "function" ? (
        <WindowButton
          label={tileWide ? "Крупный кадр" : "Плитки"}
          icon="tiles"
          pressed={tileWide}
          disabled={controlsDisabled}
          onClick={onToggleLayout}
        />
      ) : null}
      {typeof onHangup === "function" ? (
        <WindowButton
          label="Завершить звонок"
          icon="hangup"
          danger
          disabled={controlsDisabled}
          onClick={onHangup}
        />
      ) : null}
    </div>
  );
}
