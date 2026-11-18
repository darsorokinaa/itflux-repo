/**
 * Статистика качества звонка из WebRTC getStats (LiveKit).
 *
 * Раз в 20 с браузер собирает RTT, потери, джиттер, битрейт, кадры и размер
 * демонстрации, причину ограничения качества и тип соединения (relay/direct)
 * и отправляет одним маленьким JSON. Ни IP, ни имён, ни устройств не шлём.
 */

import { ensureCsrfCookie, getCsrfToken } from "../utils/cabinetAuth";
import { hasCallMetrics, summarizeCallStats } from "./callStatsSummary";

export const CALL_STATS_INTERVAL_MS = 20_000;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** POST снимка. Ошибки глотаем: урок важнее статистики. */
export async function sendCallStats(meetingUuid, payload) {
  try {
    await ensureCsrfCookie();
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRFToken"] = csrf;
    const res = await fetch(`/api/video-meetings/${meetingUuid}/call-stats/`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
      headers,
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Отчёты всех своих и чужих дорожек LiveKit. Ошибка одной дорожки не ломает снимок. */
export async function collectLiveKitStats(room) {
  const entries = [];
  const jobs = [];
  const add = (publication, direction) => {
    const track = publication?.track;
    if (!track || typeof track.getRTCStatsReport !== "function") return;
    jobs.push(
      track.getRTCStatsReport()
        .then((report) => {
          if (report) entries.push({ source: String(publication.source || track.source || ""), direction, report });
        })
        .catch(() => null),
    );
  };
  room?.localParticipant?.trackPublications?.forEach?.((publication) => add(publication, "send"));
  room?.remoteParticipants?.forEach?.((participant) => {
    participant?.trackPublications?.forEach?.((publication) => add(publication, "recv"));
  });
  await Promise.all(jobs);
  return entries;
}

function cleanMeta(meta) {
  const out = {};
  const reconnects = finite(meta?.reconnects);
  if (reconnects != null && reconnects >= 0) out.reconnects = Math.round(reconnects);
  if (typeof meta?.connection_quality === "string" && meta.connection_quality) {
    out.connection_quality = meta.connection_quality.toLowerCase().slice(0, 12);
  }
  return out;
}

/**
 * Запустить сбор. Первый снимок — только база для битрейта, отправка со второго.
 * Возвращает функцию остановки.
 */
export function startCallStats({
  meetingUuid,
  provider,
  collect,
  getMeta,
  send = sendCallStats,
  intervalMs = CALL_STATS_INTERVAL_MS,
} = {}) {
  if (!meetingUuid || typeof collect !== "function") return () => {};
  let previous = new Map();
  let stopped = false;
  let busy = false;
  let baseline = true;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const { sample, counters } = summarizeCallStats(await collect(), previous);
      previous = counters;
      if (baseline) {
        baseline = false;
        return;
      }
      if (stopped || !hasCallMetrics(sample)) return;
      await send(meetingUuid, { provider, ...sample, ...cleanMeta(getMeta?.()) });
    } catch {
      /* статистика не должна мешать уроку */
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
