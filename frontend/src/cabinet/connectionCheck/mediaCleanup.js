/**
 * Реестр диагностических MediaStream.
 * Проверка связи не должна оставлять камеру/микрофон включёнными
 * и не должна мешать настоящему уроку Jitsi.
 */

const registry = new Set();

export function trackMediaStream(stream) {
  if (stream && typeof stream.getTracks === "function") {
    registry.add(stream);
  }
  return stream;
}

export function stopMediaStream(stream) {
  if (!stream) return;
  try {
    const tracks = typeof stream.getTracks === "function" ? stream.getTracks() : [];
    tracks.forEach((track) => {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    });
  } finally {
    registry.delete(stream);
  }
}

export function stopAllConnectionCheckStreams() {
  [...registry].forEach((stream) => stopMediaStream(stream));
}

export function connectionCheckStreamCount() {
  return registry.size;
}

export function replaceTrackedStream(previous, next) {
  if (previous && previous !== next) stopMediaStream(previous);
  return trackMediaStream(next);
}
