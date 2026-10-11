/** Компактное состояние звонка. Не перекрывает доску и не обещает качество сети. */

export default function CallLinkControls({
  title = "",
  indicator = "hidden",
  showReconnect = false,
  audioOnly = false,
  weakLink = false,
  micNote = "",
  askHearing = false,
  hearNo = false,
  onHearYes,
  onHearNo,
  onReconnect,
  onToggleAudioOnly,
  onToggleWeak,
  onCheckMic,
  controlsEnabled = false,
}) {
  if (!title && !controlsEnabled) return null;
  return (
    <div className="call-link-bar" role="status" data-testid="call-link-bar">
      {title ? (
        <span className="call-link-bar__state">
          <span className={`call-link-bar__dot call-link-bar__dot--${indicator}`} aria-hidden="true" />
          <span>{title}</span>
        </span>
      ) : null}
      {controlsEnabled ? (
        <span className="call-link-bar__actions">
          <button type="button" onClick={onToggleAudioOnly}>
            {audioOnly ? "Вернуть видео" : "Только звук"}
          </button>
          <button type="button" onClick={onToggleWeak} disabled={audioOnly}>
            {weakLink ? "Обычное видео" : "Слабое соединение"}
          </button>
          <button type="button" onClick={onCheckMic}>
            Проверить микрофон
          </button>
          {showReconnect ? (
            <button type="button" onClick={onReconnect}>
              Переподключиться
            </button>
          ) : null}
        </span>
      ) : null}
      {askHearing ? (
        <span className="call-link-bar__actions">
          <span>Слышите собеседника?</span>
          <button type="button" onClick={onHearYes}>Слышу</button>
          <button type="button" onClick={onHearNo}>Не слышу</button>
        </span>
      ) : null}
      {hearNo ? (
        <span className="call-link-bar__note">
          Автоматически это не проверить. Посмотрите, включён ли микрофон собеседника и не выключен ли звук у вас.
        </span>
      ) : null}
      {micNote ? <span className="call-link-bar__note">{micNote}</span> : null}
    </div>
  );
}
