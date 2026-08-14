import { stopMediaStream, trackMediaStream } from "./mediaCleanup";
import { mapMediaError, mediaApiSupported } from "./mediaErrors";

let primedStream = null;
let primedError = null;
let priming = null;
let primeToken = 0;

export function consumePrimedMedia() {
  const stream = primedStream;
  const error = primedError;
  primedStream = null;
  primedError = null;
  priming = null;
  return { stream, error };
}

export function clearPrimedMedia() {
  primeToken += 1;
  if (primedStream) {
    stopMediaStream(primedStream);
  }
  primedStream = null;
  primedError = null;
  priming = null;
}

export async function awaitPrimedMedia() {
  if (priming) {
    try {
      await priming;
    } catch {
      /* consumePrimedMedia reads primedError */
    }
  }
  return consumePrimedMedia();
}

export function primeConnectionCheckMedia() {
  if (priming) return priming;
  if (!mediaApiSupported()) {
    primedError = Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
    return Promise.resolve(null);
  }
  const token = primeToken + 1;
  primeToken = token;
  priming = requestMedia({ video: true, audio: true })
    .then((stream) => {
      if (token !== primeToken) {
        stopMediaStream(stream);
        return null;
      }
      primedStream = stream;
      primedError = null;
      return stream;
    })
    .catch((error) => {
      if (token !== primeToken) return null;
      primedError = error;
      primedStream = null;
      return null;
    });
  return priming;
}

export async function listMediaDevices() {
  if (!mediaApiSupported() || typeof navigator.mediaDevices.enumerateDevices !== "function") {
    return { cameras: [], microphones: [] };
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((device) => device.kind === "videoinput"),
    microphones: devices.filter((device) => device.kind === "audioinput"),
  };
}

function videoConstraints(deviceId) {
  if (deviceId) return { deviceId: { ideal: deviceId } };
  return { facingMode: "user" };
}

function audioConstraints(deviceId) {
  if (deviceId) return { deviceId: { ideal: deviceId } };
  return true;
}

export async function requestMedia({ video = false, audio = false, videoDeviceId, audioDeviceId } = {}) {
  if (!mediaApiSupported()) {
    throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
  }
  const constraints = {};
  if (video) constraints.video = videoConstraints(videoDeviceId);
  if (audio) constraints.audio = audioConstraints(audioDeviceId);
  try {
    return trackMediaStream(await navigator.mediaDevices.getUserMedia(constraints));
  } catch (error) {
    if (video && audio) {
      try {
        return trackMediaStream(await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(videoDeviceId),
        }));
      } catch {
        throw error;
      }
    }
    throw error;
  }
}

export function describeMediaError(error, kind) {
  if (error?.name === "NotSupportedError") {
    return mapMediaError({ name: "TypeError" }, kind);
  }
  return mapMediaError(error, kind);
}

export function attachVideoPreview(videoEl, stream) {
  if (!videoEl || !stream) return;
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.setAttribute("playsinline", "");
  videoEl.setAttribute("muted", "");
  const play = videoEl.play();
  if (play && typeof play.catch === "function") play.catch(() => {});
}

export function detachVideoPreview(videoEl) {
  if (!videoEl) return;
  try {
    videoEl.pause();
  } catch {
    /* ignore */
  }
  videoEl.srcObject = null;
}

export function stopAndDetach(videoEl, stream) {
  detachVideoPreview(videoEl);
  stopMediaStream(stream);
}

export function rmsFromTimeDomain(buffer) {
  if (!buffer || !buffer.length) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = (buffer[i] - 128) / 128;
    sum += value * value;
  }
  return Math.sqrt(sum / buffer.length);
}

export async function playTestTone({ durationMs = 1400, frequency = 523.25 } = {}) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" });
  }
  const ctx = new AudioCtx();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + durationMs / 1000 + 0.05);
  await new Promise((resolve) => {
    window.setTimeout(resolve, durationMs + 80);
  });
  try {
    oscillator.disconnect();
    gain.disconnect();
    await ctx.close();
  } catch {
    /* ignore */
  }
}

export function createMicMeter(stream, onLevel) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx || !stream?.getAudioTracks?.().length) {
    return { stop() {}, resume() {} };
  }
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;
  source.connect(analyser);
  const buffer = new Uint8Array(analyser.fftSize);
  let frame = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(buffer);
    onLevel?.(rmsFromTimeDomain(buffer));
    frame = window.requestAnimationFrame(tick);
  };

  const resume = () => {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  };
  resume();
  tick();

  return {
    resume,
    stop() {
      stopped = true;
      if (frame) window.cancelAnimationFrame(frame);
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* ignore */
      }
      ctx.close().catch(() => {});
    },
  };
}
