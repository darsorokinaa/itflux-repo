/** Классификация сбоев видеосвязи. Неизвестное не переключает комнату. */

export const MEDIA_RESTORE_NOTICE = "Восстанавливаем видеосвязь. Урок и материалы сохранены";
export const MEDIA_RESTORED_NOTICE = "Видеосвязь восстановлена";
export const MEDIA_SCREEN_NOTE = "Демонстрацию экрана нужно запустить заново.";

const PROVIDER_CODES = new Set([
  "jitsi_script",
  "jitsi_script_timeout",
  "jitsi_public_blocked",
  "jitsi_connection_failed",
  "jitsi_conference_failed",
  "jitsi_join_timeout",
  "jwt_missing",
  "jwt_config",
  "livekit_unavailable",
  "livekit_signal",
  "ice_failed",
  "signal_failed",
  "conference_failed",
  "connection_failed",
]);

export function classifyClientFault({
  code = "",
  name = "",
  status = 0,
  online = true,
  intentionalMute = false,
  scope = "room",
} = {}) {
  const faultCode = String(code || "");
  const errorName = String(name || "");
  if (online === false) return "platform_offline";
  if (intentionalMute) return "intentional_mute";
  if (
    errorName === "NotAllowedError"
    || errorName === "NotFoundError"
    || faultCode === "device_permission"
    || faultCode === "mic_denied"
    || faultCode === "cam_denied"
  ) {
    return "device_permission";
  }
  if (status === 401 || status === 403 || faultCode === "forbidden" || faultCode === "access_revoked") {
    return "auth_denied";
  }
  if (faultCode === "not_live" || faultCode === "finished" || faultCode === "cancelled") {
    return "platform_error";
  }
  if (status >= 500 && faultCode !== "livekit_unavailable") return "platform_error";
  if (
    scope === "local"
    || faultCode === "local_audio"
    || faultCode === "audio_stalled"
  ) return "local_network";
  if (PROVIDER_CODES.has(faultCode)) return "provider_outage";
  return "local_network";
}

export function shouldReportFault({ fault, attempt = 1, maxAttempts = 3 } = {}) {
  return fault === "provider_outage" && Number(attempt) >= Number(maxAttempts);
}

export function reconnectDelayMs(attempt, { baseMs = 1000, capMs = 15000 } = {}) {
  const step = Math.max(1, Number(attempt) || 1);
  return Math.min(capMs, baseMs * (2 ** (step - 1)));
}

export function acceptGeneration(current, incoming) {
  const next = Number(incoming || 0);
  const prev = Number(current || 0);
  return Number.isFinite(next) && next > prev;
}

export const CALL_SWITCH_NOTICE = "Переключаем связь…";
export const CALL_SWITCH_DETAIL = "Переключаем связь… Звук и видео могут ненадолго прерваться. Ученик перейдёт сам.";
export const CALL_CONNECTING_NOTICE = "Подключение…";
export const CALL_READY_NOTICE = "Связь установлена";
export const CALL_SWITCH_FAILED = "Не удалось переключить связь";
export const CALL_SWITCH_RETRY = "Попробовать снова";
export const CALL_SWITCH_OFFLINE = "Нет соединения. Связь не переключена.";

/** Одна операция: повторный клик и тот же провайдер не запускают второй переход. */
export function nextProviderSwitch({ activeOp = 0, currentKind = "jaas", targetKind = "jaas" } = {}) {
  if (activeOp) return null;
  const target = targetKind === "livekit" ? "livekit" : "jaas";
  const current = currentKind === "livekit" ? "livekit" : "jaas";
  if (target === current) return null;
  return { target };
}

/** Снимать блокировку и применять ответ может только операция, которая ещё текущая. */
export function providerSwitchStillCurrent(activeOp, op) {
  return Boolean(op) && activeOp === op;
}

/**
 * Дождаться завершения или крайнего срока.
 * Срок нужен, чтобы зависший disconnect не оставлял экран в бесконечной загрузке.
 */
export function finishWithin(work, ms, schedule = setTimeout, cancel = clearTimeout) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      cancel(timer);
      resolve();
    };
    const timer = schedule(done, ms);
    Promise.resolve()
      .then(() => (typeof work === "function" ? work() : undefined))
      .then(done, done);
  });
}

/**
 * Сигнал без медиапути — ещё не «подключено».
 * Выключенный микрофон и тишина собеседника не считаются обрывом.
 */
export function describeCallReadiness({
  iceConnected = false,
  micIntended = false,
  micLive = false,
  packetsSent = null,
  timedOut = false,
} = {}) {
  if (!iceConnected) return "connecting";
  if (!micIntended) return "media";
  if (typeof packetsSent === "number" && packetsSent > 0) return "media";
  // Тишина и DTX не шлют пачки пакетов. Живой микрофон и уже открытый ICE — не обрыв.
  if (micLive && timedOut) return "media";
  if (timedOut && !micLive) return "audio-stalled";
  return "checking-audio";
}

/** После reconnect микрофон и камера остаются как выбрал участник. Экран не возобновляется. */
export function nextPublishIntent(previous = {}) {
  return {
    micOn: previous.micOn !== false,
    camOn: previous.camOn !== false,
    screenSharing: false,
  };
}
