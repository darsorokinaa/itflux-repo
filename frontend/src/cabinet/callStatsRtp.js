/**
 * Разбор RTP-статов getStats: битрейт и потери за интервал, кадры демонстрации.
 */

const LIMIT_RANK = { none: 0, other: 1, cpu: 2, bandwidth: 3 };
const SCREEN_SOURCE = "screen_share";

export function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deltaKbps(stat, field, previous, counters) {
  const value = finite(stat[field]);
  const ts = finite(stat.timestamp);
  if (value == null || ts == null) return null;
  const key = `${stat.id}:${field}`;
  counters.set(key, { value, ts });
  const before = previous.get(key);
  if (!before || ts <= before.ts || value < before.value) return null;
  return ((value - before.value) * 8) / (ts - before.ts);
}

function deltaCount(stat, field, previous, counters) {
  const value = finite(stat[field]);
  if (value == null) return null;
  const key = `${stat.id}:${field}`;
  counters.set(key, { value, ts: finite(stat.timestamp) || 0 });
  const before = previous.get(key);
  if (!before || value < before.value) return null;
  return value - before.value;
}

function noteShare(acc, stat, direction) {
  const width = finite(stat.frameWidth);
  if (!width) return;
  const current = acc.share;
  if (current && current.direction === "send" && direction === "recv") return;
  if (current && current.direction === direction && current.width >= width) return;
  acc.share = {
    direction,
    width,
    height: finite(stat.frameHeight),
    fps: finite(stat.framesPerSecond),
  };
}

export function noteOutbound(acc, stat, entry, ctx) {
  const kbps = deltaKbps(stat, "bytesSent", ctx.previous, ctx.counters);
  if (kbps != null) {
    acc.hasOut = true;
    acc.bitsOut += kbps;
    if (stat.kind === "audio") {
      acc.hasAudioOut = true;
      acc.audioOut += kbps;
    }
  }
  if (stat.kind !== "video") return;
  const reason = String(stat.qualityLimitationReason || "");
  if (reason in LIMIT_RANK && (LIMIT_RANK[reason] > (LIMIT_RANK[acc.limitation] ?? -1))) {
    acc.limitation = reason;
  }
  if (entry.source === SCREEN_SOURCE) noteShare(acc, stat, "send");
}

export function noteInbound(acc, stat, entry, ctx) {
  const kbps = deltaKbps(stat, "bytesReceived", ctx.previous, ctx.counters);
  if (kbps != null) {
    acc.hasIn = true;
    acc.bitsIn += kbps;
  }
  const lost = deltaCount(stat, "packetsLost", ctx.previous, ctx.counters);
  const received = deltaCount(stat, "packetsReceived", ctx.previous, ctx.counters);
  if (lost != null && received != null) {
    acc.lostIn += lost;
    acc.receivedIn += received;
  }
  const jitter = finite(stat.jitter);
  if (jitter != null) acc.jitter.push(jitter * 1000);
  if (stat.kind === "video" && entry.source === SCREEN_SOURCE) noteShare(acc, stat, "recv");
}

export function noteRemoteInbound(acc, stat) {
  const fraction = finite(stat.fractionLost);
  if (fraction != null) acc.lossOut.push(fraction * 100);
  const rtt = finite(stat.roundTripTime);
  if (rtt != null) acc.rtt.push(rtt * 1000);
}
