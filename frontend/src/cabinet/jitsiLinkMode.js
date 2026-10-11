/**
 * Локальные режимы одного участника через официальный IFrame API.
 * Команда отправляется только если getSupportedCommands() её перечисляет.
 * Отсутствие исключения у executeCommand поддержкой не считается.
 * Две команды с одной целью не отправляются.
 * Это не QoS в сети провайдера и не подтверждение, что собеседник слышит.
 */

import { JITSI_CAMERA_MAX_HEIGHT } from "./jitsiMeet";

export const WEAK_VIDEO_HEIGHT = 180;

export function readSupportedCommands(api) {
  const commandApi = callCommandApi(api);
  if (!commandApi || typeof commandApi.getSupportedCommands !== "function") return [];
  try {
    const value = commandApi.getSupportedCommands();
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function hasCommand(names, ...aliases) {
  return aliases.some((name) => names.has(name));
}

/** Одна команда. setAudioOnly из справочника важнее нового имени, если сборка знает оба. */
export function selectAudioOnlyCommand(supported) {
  const names = new Set(Array.isArray(supported) ? supported.map((item) => String(item)) : []);
  if (hasCommand(names, "setAudioOnly", "set-audio-only")) return "setAudioOnly";
  if (hasCommand(names, "setLowBandwidthMode", "set-low-bandwidth-mode")) return "setLowBandwidthMode";
  return "";
}

export function selectVideoQualityCommand(supported) {
  const names = new Set(Array.isArray(supported) ? supported.map((item) => String(item)) : []);
  return hasCommand(names, "setVideoQuality", "set-video-quality") ? "setVideoQuality" : "";
}

function sendAudioOnly(commandApi, enabled) {
  const command = selectAudioOnlyCommand(readSupportedCommands(commandApi));
  if (!command) return false;
  commandApi.executeCommand(command, Boolean(enabled));
  return true;
}

/** Вопрос человеку один раз, пока он не ответил. dataChannelOpened слышимость не доказывает. */
export function shouldAskIfTheyHear({
  mediaChannelOpen = false,
  remoteCount = 0,
  answer = "",
  callState = "",
} = {}) {
  if (answer === "yes" || answer === "no") return false;
  if (callState !== "joined") return false;
  if (!mediaChannelOpen) return false;
  return remoteCount > 0;
}

export function callCommandApi(session) {
  if (!session) return null;
  if (typeof session.executeCommand === "function" && typeof session.isVideoMuted === "function") {
    return session;
  }
  if (session.api && typeof session.api.executeCommand === "function") return session.api;
  if (typeof session.executeCommand === "function") return session;
  return null;
}

export async function applyAudioOnlyMode(api, enabled, { videoMutedBefore = null } = {}) {
  const commandApi = callCommandApi(api);
  if (!commandApi) {
    return { applied: false, audioOnly: false, videoMutedBefore };
  }
  if (enabled) {
    let mutedBefore = videoMutedBefore;
    if (mutedBefore == null && typeof commandApi.isVideoMuted === "function") {
      try {
        mutedBefore = Boolean(await commandApi.isVideoMuted());
      } catch {
        mutedBefore = null;
      }
    }
    if (!sendAudioOnly(commandApi, true)) {
      return { applied: false, audioOnly: false, videoMutedBefore: mutedBefore };
    }
    return { applied: true, audioOnly: true, videoMutedBefore: mutedBefore };
  }
  if (!sendAudioOnly(commandApi, false)) {
    return { applied: false, audioOnly: true, videoMutedBefore };
  }
  if (videoMutedBefore === true) {
    try {
      const muted = typeof commandApi.isVideoMuted === "function"
        ? Boolean(await commandApi.isVideoMuted())
        : false;
      if (!muted) commandApi.executeCommand("toggleVideo");
    } catch {
      /* камера останется в том состоянии, которое выбрал Jitsi */
    }
  }
  return { applied: true, audioOnly: false, videoMutedBefore: null };
}

export function applyWeakVideo(api, enabled, { normalHeight = JITSI_CAMERA_MAX_HEIGHT } = {}) {
  const commandApi = callCommandApi(api);
  if (!commandApi) return false;
  const supported = readSupportedCommands(commandApi);
  if (!selectVideoQualityCommand(supported)) return false;
  const height = enabled ? WEAK_VIDEO_HEIGHT : normalHeight;
  commandApi.executeCommand("setVideoQuality", height);
  if (enabled && hasCommand(new Set(supported), "setBlurredBackground", "set-blurred-background")) {
    commandApi.executeCommand("setBlurredBackground", "none");
  }
  return true;
}

export async function applyStoredLinkPreferences(api, prefs = {}) {
  const next = {
    audioOnly: Boolean(prefs.audioOnly),
    weak: Boolean(prefs.weak),
    videoMutedBefore: prefs.videoMutedBefore ?? null,
  };
  if (!callCommandApi(api)) return next;
  if (next.audioOnly) {
    const result = await applyAudioOnlyMode(api, true, { videoMutedBefore: next.videoMutedBefore });
    if (!result.applied) {
      return { audioOnly: false, weak: next.weak, videoMutedBefore: next.videoMutedBefore };
    }
    return {
      audioOnly: true,
      weak: next.weak,
      videoMutedBefore: result.videoMutedBefore,
    };
  }
  if (next.weak && !applyWeakVideo(api, true)) {
    return { ...next, weak: false };
  }
  return next;
}

export async function inspectCallMicrophone(api) {
  const commandApi = callCommandApi(api);
  let permission = "unknown";
  try {
    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: "microphone" });
      permission = status?.state || "unknown";
    }
  } catch {
    permission = "unknown";
  }
  if (permission === "denied") {
    return {
      ok: false,
      message: "Нет разрешения на микрофон. Разрешите его в настройках браузера для этого сайта.",
    };
  }
  let muted = null;
  if (typeof commandApi?.isAudioMuted === "function") {
    try {
      muted = Boolean(await commandApi.isAudioMuted());
    } catch {
      muted = null;
    }
  }
  if (muted === true) {
    return {
      ok: false,
      message: "Микрофон в звонке выключен. Включите его кнопкой микрофона в окне видеосвязи.",
    };
  }
  if (muted === false) {
    return {
      ok: true,
      message: "Микрофон в звонке включён. Это не доказывает, что собеседник вас слышит.",
    };
  }
  return {
    ok: null,
    message: "Состояние микрофона сейчас не видно. Проверьте кнопку микрофона в окне видеосвязи.",
  };
}

/**
 * Подписи состояния.
 * Конференция, медиамост и слышимость — разные факты.
 * dataChannelOpened не подтверждает, что собеседника слышно.
 */
export function describeCallLink({
  callState = "idle",
  reconnectCount = 0,
  mediaChannelOpen = false,
  videoServiceUnreachable = false,
  hearingConfirmed = false,
} = {}) {
  if (callState === "leaving" || callState === "ended" || callState === "idle") {
    return {
      phase: "hidden",
      title: "",
      indicator: "hidden",
      showReconnect: false,
      suggestAudioOnly: false,
    };
  }
  if (videoServiceUnreachable && callState !== "joined" && callState !== "degraded" && callState !== "reconnecting") {
    return {
      phase: "unavailable",
      title: "Видеосервис недоступен с этой сети",
      indicator: "bad",
      showReconnect: true,
      suggestAudioOnly: false,
    };
  }
  if (callState === "failed") {
    if (reconnectCount > 0) {
      return {
        phase: "lost",
        title: "Соединение потеряно",
        indicator: "bad",
        showReconnect: true,
        suggestAudioOnly: true,
      };
    }
    return {
      phase: "failed",
      title: "Не удалось подключиться",
      indicator: "bad",
      showReconnect: true,
      suggestAudioOnly: false,
    };
  }
  if (callState === "reconnecting") {
    return {
      phase: "recovering",
      title: "Восстанавливаем соединение",
      indicator: "warn",
      showReconnect: false,
      suggestAudioOnly: true,
    };
  }
  if (callState === "degraded") {
    return {
      phase: "unstable",
      title: "Нестабильная связь",
      indicator: "warn",
      showReconnect: true,
      suggestAudioOnly: true,
    };
  }
  if (callState === "joined" && mediaChannelOpen && hearingConfirmed) {
    return {
      phase: "heard",
      title: "Слышимость подтверждена",
      indicator: "ok",
      showReconnect: false,
      suggestAudioOnly: false,
    };
  }
  if (callState === "joined" && mediaChannelOpen) {
    return {
      phase: "media",
      title: "Слышимость не подтверждена",
      indicator: "warn",
      showReconnect: false,
      suggestAudioOnly: false,
    };
  }
  if (callState === "joined") {
    return {
      phase: "in_room",
      title: "Подключение к медиамосту",
      indicator: "warn",
      showReconnect: false,
      suggestAudioOnly: false,
    };
  }
  return {
    phase: "connecting",
    title: "Подключение к конференции",
    indicator: "warn",
    showReconnect: false,
    suggestAudioOnly: false,
  };
}
