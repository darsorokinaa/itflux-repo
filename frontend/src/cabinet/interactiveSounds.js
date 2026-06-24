let audioContext = null;

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
  if (!profile) return;
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

export function playInteractiveSound(appearance, eventName) {
  if (!appearance?.soundEnabled) return;
  const config = appearance?.soundPack?.config || {};
  const profile = config[eventName];
  if (!profile) return;
  unlockInteractiveAudio().then(() => playTone(profile));
}

export function previewInteractiveSound(soundPack) {
  if (!soundPack || soundPack.slug === "silent") return;
  playTone(soundPack.config?.tap || soundPack.config?.flip);
}
