/**
 * Сводка WebRTC getStats в один маленький снимок качества звонка.
 * Чистые функции без сети: на вход отчёты дорожек, на выход числа.
 */

import { finite, noteInbound, noteOutbound, noteRemoteInbound } from "./callStatsRtp";

function eachStat(report, fn) {
  if (report && typeof report.forEach === "function") report.forEach((stat) => stat && fn(stat));
}

function indexById(report) {
  const byId = new Map();
  eachStat(report, (stat) => {
    if (stat.id) byId.set(stat.id, stat);
  });
  return byId;
}

function selectedPair(byId) {
  let pair = null;
  byId.forEach((stat) => {
    if (stat.type === "transport" && stat.selectedCandidatePairId) {
      pair = byId.get(stat.selectedCandidatePairId) || pair;
    }
  });
  if (pair) return pair;
  byId.forEach((stat) => {
    if (!pair && stat.type === "candidate-pair" && stat.nominated && stat.state === "succeeded") pair = stat;
  });
  return pair;
}

function createAccumulator() {
  return {
    rtt: [],
    jitter: [],
    lossOut: [],
    bitsIn: 0,
    bitsOut: 0,
    audioOut: 0,
    hasIn: false,
    hasOut: false,
    hasAudioOut: false,
    lostIn: 0,
    receivedIn: 0,
    limitation: "",
    connectionType: "",
    transport: "",
    share: null,
  };
}

function notePair(acc, pair, byId) {
  if (!pair) return;
  const rtt = finite(pair.currentRoundTripTime);
  if (rtt != null) acc.rtt.push(rtt * 1000);
  const local = byId.get(pair.localCandidateId);
  if (!local || acc.connectionType) return;
  const relay = local.candidateType === "relay";
  acc.connectionType = relay ? "relay" : "direct";
  acc.transport = String((relay && local.relayProtocol) || local.protocol || "").toLowerCase();
}

function noteEntry(acc, entry, ctx) {
  const byId = indexById(entry?.report);
  notePair(acc, selectedPair(byId), byId);
  byId.forEach((stat) => {
    if (ctx.seen.has(stat.id)) return;
    ctx.seen.add(stat.id);
    if (stat.type === "outbound-rtp") noteOutbound(acc, stat, entry, ctx);
    else if (stat.type === "inbound-rtp") noteInbound(acc, stat, entry, ctx);
    else if (stat.type === "remote-inbound-rtp") noteRemoteInbound(acc, stat);
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function round(value, digits = 0) {
  if (value == null) return undefined;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function buildSample(acc) {
  const sample = {
    rtt_ms: round(median(acc.rtt)),
    jitter_ms: round(acc.jitter.length ? Math.max(...acc.jitter) : null),
    loss_out_pct: round(acc.lossOut.length ? Math.max(...acc.lossOut) : null, 2),
    loss_in_pct: acc.lostIn + acc.receivedIn > 0
      ? round((100 * acc.lostIn) / (acc.lostIn + acc.receivedIn), 2)
      : undefined,
    bitrate_in_kbps: acc.hasIn ? round(acc.bitsIn) : undefined,
    bitrate_out_kbps: acc.hasOut ? round(acc.bitsOut) : undefined,
    audio_out_kbps: acc.hasAudioOut ? round(acc.audioOut) : undefined,
    quality_limitation: acc.limitation || undefined,
    connection_type: acc.connectionType || undefined,
    transport: acc.transport || undefined,
  };
  if (acc.share) {
    sample.share_direction = acc.share.direction;
    sample.share_width = acc.share.width;
    sample.share_height = acc.share.height ?? undefined;
    sample.share_fps = round(acc.share.fps, 1);
  }
  return Object.fromEntries(Object.entries(sample).filter(([, value]) => value !== undefined));
}

/**
 * entries: [{ source, direction, report }], report — RTCStatsReport (или массив статов).
 * previous — счётчики прошлого снимка (для битрейта и потерь за интервал).
 */
export function summarizeCallStats(entries, previous = new Map()) {
  const ctx = { previous, counters: new Map(), seen: new Set() };
  const acc = createAccumulator();
  (Array.isArray(entries) ? entries : []).forEach((entry) => noteEntry(acc, entry, ctx));
  return { sample: buildSample(acc), counters: ctx.counters };
}

export function hasCallMetrics(sample) {
  return Object.keys(sample || {}).some((key) => key.endsWith("_ms") || key.endsWith("_pct") || key.endsWith("_kbps") || key.startsWith("share_"));
}
