import { interactiveMediaUrl } from "./interactiveAppearance";

let audioContext = null;
const audioCache = new Map();
let backgroundAudio = null;

/** События звуков интерактива */
export const INTERACTIVE_SOUND_EVENTS = [
  { id: "flip", label: "Переворот" },
  { id: "correct", label: "Правильно" },
  { id: "wrong", label: "Неправильно" },
  { id: "next", label: "Следующий" },
  { id: "end", label: "Конец" },
  { id: "background", label: "Фоновый" },
];

const EVENT_ALIASES = {
  tap: "next",
};

const MAX_CUSTOM_SOUND_BYTES = 600_000;
const ACCEPTED_SOUND_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
]);

export async function readInteractiveSoundFile(file) {
  if (!file) {
    throw new Error("Выберите файл");
  }
  if (!ACCEPTED_SOUND_TYPES.has(file.type) && !/\.(mp3|wav|ogg|webm)$/i.test(file.name || "")) {
    throw new Error("Поддерживаются mp3, wav, ogg и webm");
  }
  if (file.size > MAX_CUSTOM_SOUND_BYTES) {
    throw new Error("Файл слишком большой (макс. 600 КБ)");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
  }
  return audioContext;
}

export async function unlockInteractiveAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
}

function playTone(profile) {
  if (!profile || profile.url) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const duration = profile.duration || 0.1;
  const volume = profile.volume ?? 0.12;

  oscillator.type = profile.type || "sine";
  oscillator.frequency.value = profile.freq || 440;
  gain.gain.value = volume;

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + duration);
}

function resolveEventName(eventName) {
  return EVENT_ALIASES[eventName] || eventName;
}

function resolveSoundUrl(appearance, eventName) {
  const resolved = resolveEventName(eventName);
  const custom = appearance?.customSounds || {};
  if (custom[eventName]) return custom[eventName];
  if (custom[resolved]) return custom[resolved];

  const packSounds = appearance?.soundPack?.sounds || {};
  if (packSounds[eventName]) return interactiveMediaUrl(packSounds[eventName]);
  if (packSounds[resolved]) return interactiveMediaUrl(packSounds[resolved]);

  const config = appearance?.soundPack?.config || {};
  const profile = config[eventName] || config[resolved];
  if (profile?.url) return interactiveMediaUrl(profile.url);
  return null;
}

function resolveToneProfile(appearance, eventName) {
  const resolved = resolveEventName(eventName);
  const config = appearance?.soundPack?.config || {};
  return config[eventName] || config[resolved] || null;
}

function playAudioFile(url) {
  if (!url) return;
  let audio = audioCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    audioCache.set(url, audio);
  }
  audio.currentTime = 0;
  const playPromise = audio.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {});
  }
}

export function playInteractiveSound(appearance, eventName) {
  if (!appearance?.soundEnabled) return;
  if (appearance?.soundPack?.slug === "silent") return;

  const url = resolveSoundUrl(appearance, eventName);
  if (url) {
    unlockInteractiveAudio().then(() => playAudioFile(url));
    return;
  }

  const profile = resolveToneProfile(appearance, eventName);
  if (!profile) return;
  unlockInteractiveAudio().then(() => playTone(profile));
}

export function startInteractiveBackgroundSound(appearance) {
  stopInteractiveBackgroundSound();
  if (!appearance?.soundEnabled) return;
  if (appearance?.soundPack?.slug === "silent") return;

  const url = resolveSoundUrl(appearance, "background");
  if (!url) return;

  backgroundAudio = new Audio(url);
  backgroundAudio.loop = true;
  backgroundAudio.volume = 0.35;
  unlockInteractiveAudio().then(() => {
    backgroundAudio?.play()?.catch(() => {});
  });
}

export function stopInteractiveBackgroundSound() {
  if (!backgroundAudio) return;
  backgroundAudio.pause();
  backgroundAudio.currentTime = 0;
  backgroundAudio = null;
}

let previewClipAudio = null;

/** Остановить короткое прослушивание в редакторе (не фоновый loop плеера). */
export function stopInteractiveSoundPreview() {
  if (!previewClipAudio) return;
  previewClipAudio.pause();
  previewClipAudio.currentTime = 0;
  previewClipAudio = null;
}

/**
 * Короткое прослушивание пакета в редакторе.
 * Если есть фоновый трек с бэкенда — играет его (можно pause тем же вызовом),
 * иначе — эффект flip/синтез. Не запускает loop на всю страницу редактора.
 */
export function previewInteractiveSound(soundPackOrAppearance, eventName = "flip") {
  const appearance = soundPackOrAppearance?.soundEnabled !== undefined
    ? soundPackOrAppearance
    : { soundEnabled: true, soundPack: soundPackOrAppearance };
  if (appearance.soundPack?.slug === "silent" && !appearance.customSounds) return;

  const bgUrl = resolveSoundUrl(appearance, "background");
  const preferBackground = eventName === "background"
    || (eventName === "flip" && bgUrl && !appearance.customSounds?.[eventName]);

  if (preferBackground && bgUrl) {
    const src = interactiveMediaUrl(bgUrl) || bgUrl;
    const current = previewClipAudio?.getAttribute("data-preview-url") || "";
    if (previewClipAudio && !previewClipAudio.paused && current === src) {
      stopInteractiveSoundPreview();
      return "paused";
    }
    stopInteractiveSoundPreview();
    stopInteractiveBackgroundSound();
    previewClipAudio = new Audio(src);
    previewClipAudio.setAttribute("data-preview-url", src);
    previewClipAudio.loop = false;
    previewClipAudio.volume = 0.35;
    previewClipAudio.onended = () => {
      previewClipAudio = null;
    };
    unlockInteractiveAudio().then(() => {
      previewClipAudio?.play()?.catch(() => {});
    });
    return "playing";
  }

  stopInteractiveSoundPreview();
  playInteractiveSound({ ...appearance, soundEnabled: true }, eventName);
  return "played";
}

export function isInteractiveSoundPreviewPlaying(url) {
  if (!previewClipAudio || previewClipAudio.paused) return false;
  if (!url) return true;
  const current = previewClipAudio.getAttribute("data-preview-url") || "";
  const src = interactiveMediaUrl(url) || url;
  return current === src;
}
