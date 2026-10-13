/**
 * Команды официального Jitsi External API.
 * Состояние кнопок после вызова читается из API, а не из локального клика.
 */

function sessionApi(api) {
  return api?.api || api || null;
}

export function runConferenceCommand(api, command, ...args) {
  const session = sessionApi(api);
  if (!session || typeof session.executeCommand !== "function" || !command) return false;
  try {
    session.executeCommand(command, ...args);
    return true;
  } catch {
    return false;
  }
}

export function screenShareSupported() {
  return typeof navigator !== "undefined"
    && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/**
 * Ставит mute явно. toggleAudio только если текущее состояние другое:
 * повторный вызов из клика и watchdog не должен глушить уже включённый микрофон.
 * Не вызывает getUserMedia само и не включает микрофон без этого вызова.
 */
export async function setConferenceAudioMuted(api, muted) {
  const session = sessionApi(api);
  if (!session || typeof session.executeCommand !== "function") return false;
  const wantMuted = Boolean(muted);
  try {
    if (typeof session.isAudioMuted === "function") {
      const current = Boolean(await session.isAudioMuted());
      if (current === wantMuted) return true;
    }
  } catch {
    /* одно переключение, если состояние не прочиталось */
  }
  return runConferenceCommand(session, "toggleAudio");
}

export async function readMuteState(api) {
  const session = sessionApi(api);
  let audioMuted = null;
  let videoMuted = null;
  try {
    if (typeof session?.isAudioMuted === "function") {
      audioMuted = Boolean(await session.isAudioMuted());
    }
  } catch {
    audioMuted = null;
  }
  try {
    if (typeof session?.isVideoMuted === "function") {
      videoMuted = Boolean(await session.isVideoMuted());
    }
  } catch {
    videoMuted = null;
  }
  return { audioMuted, videoMuted };
}

export function setConferenceDevice(api, kind, device) {
  const id = String(device?.deviceId || "");
  const label = String(device?.label || "");
  if (!id) return false;
  if (kind === "audioInput") return runConferenceCommand(api, "setAudioInputDevice", label, id);
  if (kind === "videoInput") return runConferenceCommand(api, "setVideoInputDevice", label, id);
  if (kind === "audioOutput") return runConferenceCommand(api, "setAudioOutputDevice", id);
  return false;
}

export async function loadConferenceDevices(api) {
  const session = sessionApi(api);
  if (typeof session?.getAvailableDevices !== "function") return null;
  try {
    const list = await session.getAvailableDevices();
    if (!list || typeof list !== "object") return null;
    return {
      audioInput: Array.isArray(list.audioInput) ? list.audioInput : [],
      audioOutput: Array.isArray(list.audioOutput) ? list.audioOutput : [],
      videoInput: Array.isArray(list.videoInput) ? list.videoInput : [],
    };
  } catch {
    return null;
  }
}
