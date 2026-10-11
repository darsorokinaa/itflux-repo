import { useEffect, useState } from "react";

import { participantInitials } from "../participantVideo";
import "../styles/conference-chrome.css";

function Icon({ children }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

function MicIcon({ on }) {
  if (on) {
    return (
      <Icon>
        <rect x="9" y="2" width="6" height="13" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
      </Icon>
    );
  }
  return (
    <Icon>
      <path d="M4 4l16 16M9 9v3a3 3 0 0 0 5 2M16 9V6a4 4 0 0 0-7.5-2M5 10v2a7 7 0 0 0 12 4m2-4v-2M12 18v4m-4 0h8" />
    </Icon>
  );
}

function CamIcon({ on }) {
  if (on) {
    return (
      <Icon>
        <rect x="3" y="5" width="14" height="14" rx="3" />
        <path d="m17 10 4-3v10l-4-3" />
      </Icon>
    );
  }
  return (
    <Icon>
      <rect x="3" y="5" width="14" height="14" rx="3" />
      <path d="m17 10 4-3v10l-4-3M3 3l18 18" />
    </Icon>
  );
}

function formatConferenceElapsed(startedAt, now = Date.now()) {
  const started = Date.parse(startedAt || "");
  if (!startedAt || !Number.isFinite(started)) return "00:00";
  const total = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export function ConferenceTimer({ startedAt, active = true }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !startedAt) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active, startedAt]);
  return (
    <span className="cf-live">
      <i className="cf-live__dot" />
      <span>{formatConferenceElapsed(startedAt, now)}</span>
    </span>
  );
}

function CtrlButton({
  label,
  pressed = false,
  off = false,
  danger = false,
  disabled = false,
  onClick,
  children,
}) {
  return (
    <button
      type="button"
      className={[
        "cf-ctrl",
        pressed ? "is-on" : "",
        off ? "is-off" : "",
        danger ? "is-end" : "",
      ].filter(Boolean).join(" ")}
      aria-label={label}
      aria-pressed={pressed || off ? true : undefined}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function deviceRows(devices) {
  if (!devices) return [];
  return [
    ["audioInput", "Микрофон", devices.audioInput],
    ["audioOutput", "Динамики", devices.audioOutput],
    ["videoInput", "Камера", devices.videoInput],
  ].filter(([, , list]) => Array.isArray(list) && list.length);
}

export function ConferenceControls({
  disabled = false,
  micOn = false,
  camOn = false,
  sharing = false,
  handRaised = false,
  tileWide = false,
  peopleOpen = false,
  chatOpen = false,
  participantCount = 0,
  unreadChat = 0,
  soundPrompt = false,
  statusPhase = "",
  statusTitle = "",
  screenShareAvailable = true,
  showReconnect = false,
  onToggleMic,
  onToggleCam,
  onToggleShare,
  onToggleHand,
  onToggleLayout,
  onTogglePeople,
  onToggleChat,
  onHangup,
  onEnableSound,
  onLoadDevices,
  onSelectDevice,
  onReconnect,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [devices, setDevices] = useState(null);
  const [deviceNote, setDeviceNote] = useState("");

  const openSettings = async () => {
    const next = !settingsOpen;
    setSettingsOpen(next);
    setDeviceNote("");
    if (!next) return;
    if (typeof onLoadDevices !== "function") {
      setDeviceNote("Список устройств в этой сборке недоступен.");
      return;
    }
    const list = await onLoadDevices();
    if (!list) {
      setDeviceNote("Браузер не отдал список устройств.");
      setDevices(null);
      return;
    }
    setDevices(list);
  };

  const rows = deviceRows(devices);
  const peopleLabel = participantCount > 0 ? `Участники, ${participantCount}` : "Участники";

  return (
    <div className="cf-dock">
      {statusTitle ? (
        <div className={`cf-status cf-status--${statusPhase || "info"}`} role="status">
          <span>{statusTitle}</span>
          {statusPhase === "failed" && showReconnect ? (
            <button type="button" onClick={onReconnect}>Повторить</button>
          ) : null}
          {soundPrompt ? (
            <button type="button" onClick={onEnableSound}>Включить звук</button>
          ) : null}
        </div>
      ) : null}
      {!statusTitle && soundPrompt ? (
        <div className="cf-status cf-status--info" role="status">
          <span>Если собеседника не слышно после возвращения на экран, нажмите кнопку.</span>
          <button type="button" onClick={onEnableSound}>Включить звук</button>
        </div>
      ) : null}
      <div className="cf-controls">
        <div className="cf-controls__group">
          <CtrlButton
            label={micOn ? "Выключить микрофон" : "Включить микрофон"}
            off={!micOn}
            disabled={disabled}
            onClick={onToggleMic}
          >
            <MicIcon on={micOn} />
          </CtrlButton>
          <CtrlButton
            label={camOn ? "Выключить камеру" : "Включить камеру"}
            off={!camOn}
            disabled={disabled}
            onClick={onToggleCam}
          >
            <CamIcon on={camOn} />
          </CtrlButton>
          <CtrlButton
            label={screenShareAvailable ? (sharing ? "Остановить демонстрацию" : "Демонстрация экрана") : "Демонстрация экрана недоступна"}
            pressed={sharing}
            disabled={disabled || !screenShareAvailable}
            onClick={onToggleShare}
          >
            <Icon>
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <path d="M8 22h8m-4-4v4m-4-11 4-4 4 4m-4-4v8" />
            </Icon>
          </CtrlButton>
          <CtrlButton
            label={handRaised ? "Опустить руку" : "Поднять руку"}
            pressed={handRaised}
            disabled={disabled}
            onClick={onToggleHand}
          >
            <Icon>
              <path d="M8 13V6a2 2 0 0 1 4 0v5M12 4a2 2 0 0 1 4 0v8M16 7a2 2 0 0 1 4 0v9a6 6 0 0 1-6 6h-3a7 7 0 0 1-5-2l-3-4a2 2 0 0 1 3-3l2 2" />
            </Icon>
          </CtrlButton>
        </div>
        <div className="cf-controls__group">
          <CtrlButton
            label={peopleLabel}
            pressed={peopleOpen}
            disabled={disabled}
            onClick={onTogglePeople}
          >
            <Icon>
              <circle cx="9" cy="8" r="3" />
              <path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5" />
            </Icon>
          </CtrlButton>
          <CtrlButton
            label={unreadChat > 0 ? `Чат, новых сообщений ${unreadChat}` : "Чат"}
            pressed={chatOpen}
            disabled={disabled}
            onClick={onToggleChat}
          >
            <Icon>
              <path d="M20 11a8 8 0 0 1-8 8 9 9 0 0 1-4-.9L3 20l1.8-4A8 8 0 1 1 20 11Z" />
            </Icon>
            {unreadChat > 0 ? <span className="cf-ctrl__badge">{unreadChat > 9 ? "9+" : unreadChat}</span> : null}
          </CtrlButton>
          <CtrlButton label="Завершить звонок" danger disabled={disabled} onClick={onHangup}>
            <Icon>
              <path d="M3 15c5-4 13-4 18 0l-3 4-3-2v-3H9v3l-3 2-3-4Z" />
            </Icon>
          </CtrlButton>
        </div>
        <div className="cf-controls__group">
          <CtrlButton
            label={tileWide ? "Крупный кадр" : "Плитки"}
            pressed={tileWide}
            disabled={disabled}
            onClick={onToggleLayout}
          >
            <Icon>
              <rect x="3" y="3" width="8" height="8" rx="1" />
              <rect x="13" y="3" width="8" height="8" rx="1" />
              <rect x="3" y="13" width="8" height="8" rx="1" />
              <rect x="13" y="13" width="8" height="8" rx="1" />
            </Icon>
          </CtrlButton>
          <CtrlButton
            label="Устройства"
            pressed={settingsOpen}
            disabled={disabled}
            onClick={() => void openSettings()}
          >
            <Icon>
              <circle cx="12" cy="12" r="3" />
              <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.3 1a8 8 0 0 0-1.8-1L14.5 3h-4L10 6a8 8 0 0 0-1.8 1L6 6l-2 3.5L6 11a7 7 0 0 0 0 2l-2 1.5L6 18l2.2-1a8 8 0 0 0 1.8 1l.5 3h4l.5-3a8 8 0 0 0 1.8-1L19 18l2-3.5-2-1.5a7 7 0 0 0 .1-1Z" />
            </Icon>
          </CtrlButton>
        </div>
      </div>
      {settingsOpen ? (
        <div className="cf-settings" role="dialog" aria-label="Устройства">
          {deviceNote ? <p className="cf-settings__note">{deviceNote}</p> : null}
          {rows.map(([kind, title, list]) => (
            <label key={kind} className="cf-settings__row">
              <span>{title}</span>
              <select
                defaultValue=""
                onChange={(event) => {
                  const device = list.find((item) => item.deviceId === event.target.value);
                  if (device) onSelectDevice?.(kind, device);
                }}
              >
                <option value="" disabled>Выбрать</option>
                {list.map((item) => (
                  <option key={item.deviceId} value={item.deviceId}>
                    {item.label || "Устройство"}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PersonRow({ person, speaking, you = false }) {
  const name = person?.displayName || (you ? "Вы" : "Участник");
  const muted = person?.audioMuted === true;
  return (
    <div className={`cf-person${speaking ? " is-speaking" : ""}`}>
      <div className={`cf-person__avatar${you ? "" : " is-peer"}`}>{participantInitials(name)}</div>
      <div className="cf-person__text">
        <div className="cf-person__name">{you ? `${name} (вы)` : name}</div>
        <div className="cf-person__role">{person?.roleLabel || (you ? "Вы в конференции" : "Участник")}</div>
      </div>
      <span className={`cf-person__mic${muted ? " is-off" : ""}`} title={muted ? "Микрофон выключен" : "Микрофон включён"}>
        {muted ? "выкл" : "вкл"}
      </span>
    </div>
  );
}

export function ConferenceSide({
  open = false,
  tab = "people",
  local = null,
  remotes = [],
  dominantId = "",
  messages = [],
  onTab,
  onClose,
  onSend,
}) {
  const [draft, setDraft] = useState("");
  if (!open) return null;
  const count = (local ? 1 : 0) + remotes.length;
  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend?.(text.slice(0, 500));
    setDraft("");
  };
  return (
    <aside className="cf-side" aria-label="Комната урока">
      <div className="cf-side__head">
        <div className="cf-side__title-row">
          <div className="cf-side__title">Комната урока</div>
          <button type="button" className="cf-pill" onClick={onClose}>Закрыть</button>
        </div>
        <div className="cf-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "people"}
            className={tab === "people" ? "is-selected" : ""}
            onClick={() => onTab?.("people")}
          >
            Участники ({count})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "chat"}
            className={tab === "chat" ? "is-selected" : ""}
            onClick={() => onTab?.("chat")}
          >
            Чат
          </button>
        </div>
      </div>
      {tab === "people" ? (
        <div className="cf-panel" role="tabpanel">
          <div className="cf-people">
            {local ? (
              <PersonRow person={local} you speaking={Boolean(dominantId && dominantId === local.id)} />
            ) : null}
            {remotes.map((person) => (
              <PersonRow
                key={person.id || person.displayName}
                person={person}
                speaking={Boolean(dominantId && dominantId === person.id)}
              />
            ))}
            {!local && remotes.length === 0 ? (
              <p className="cf-settings__note">Участники появятся после входа в комнату.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="cf-panel cf-chat" role="tabpanel">
            {messages.length === 0 ? (
              <div className="cf-message">
                <b>Цифровой поток</b>
                <div className="cf-bubble">Сообщения участников занятия появятся здесь.</div>
              </div>
            ) : messages.map((message) => (
              <div key={message.id} className={`cf-message${message.mine ? " is-me" : ""}`}>
                <b>{message.author || "Участник"}</b>
                <div className="cf-bubble">{message.text}</div>
              </div>
            ))}
          </div>
          <form
            className="cf-send"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <input
              value={draft}
              maxLength={500}
              placeholder="Написать сообщение…"
              aria-label="Сообщение"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" aria-label="Отправить">➤</button>
          </form>
        </>
      )}
    </aside>
  );
}
