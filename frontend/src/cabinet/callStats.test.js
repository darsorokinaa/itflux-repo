import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/cabinetAuth", () => ({
  ensureCsrfCookie: vi.fn(async () => {}),
  getCsrfToken: vi.fn(() => "csrf-test"),
}));

import { collectLiveKitStats, sendCallStats, startCallStats } from "./callStats";
import { hasCallMetrics, summarizeCallStats } from "./callStatsSummary";

function report(stats) {
  return new Map(stats.map((stat) => [stat.id, stat]));
}

function transportStats({ relay = false } = {}) {
  return [
    { id: "T1", type: "transport", selectedCandidatePairId: "CP1" },
    { id: "CP1", type: "candidate-pair", localCandidateId: "L1", currentRoundTripTime: 0.12, state: "succeeded", nominated: true },
    relay
      ? { id: "L1", type: "local-candidate", candidateType: "relay", protocol: "udp", relayProtocol: "tls" }
      : { id: "L1", type: "local-candidate", candidateType: "host", protocol: "udp" },
  ];
}

function screenSend(ts, bytes) {
  return {
    source: "screen_share",
    direction: "send",
    report: report([
      ...transportStats({ relay: true }),
      { id: "OV-f", type: "outbound-rtp", kind: "video", timestamp: ts, bytesSent: bytes, framesPerSecond: 7.6, frameWidth: 1920, frameHeight: 1080, qualityLimitationReason: "bandwidth" },
      { id: "OV-q", type: "outbound-rtp", kind: "video", timestamp: ts, bytesSent: bytes / 10, framesPerSecond: 3, frameWidth: 640, frameHeight: 360, qualityLimitationReason: "none" },
      { id: "RI1", type: "remote-inbound-rtp", fractionLost: 0.04, roundTripTime: 0.14 },
    ]),
  };
}

function micSend(ts, bytes) {
  return {
    source: "microphone",
    direction: "send",
    report: report([
      ...transportStats({ relay: true }),
      { id: "OA", type: "outbound-rtp", kind: "audio", timestamp: ts, bytesSent: bytes },
    ]),
  };
}

function cameraRecv(ts, bytes, lost, received) {
  return {
    source: "camera",
    direction: "recv",
    report: report([
      { id: "IV", type: "inbound-rtp", kind: "video", timestamp: ts, bytesReceived: bytes, packetsLost: lost, packetsReceived: received, jitter: 0.03 },
    ]),
  };
}

describe("summarizeCallStats", () => {
  it("turns two snapshots into rates, loss, rtt and screen-share facts", () => {
    const first = summarizeCallStats([screenSend(0, 0), micSend(0, 0), cameraRecv(0, 0, 0, 0)]);
    expect(first.sample.bitrate_out_kbps).toBeUndefined();
    const { sample } = summarizeCallStats(
      [screenSend(20_000, 5_000_000), micSend(20_000, 120_000), cameraRecv(20_000, 2_500_000, 30, 970)],
      first.counters,
    );
    expect(sample.audio_out_kbps).toBe(48);
    expect(sample.bitrate_out_kbps).toBe(2000 + 200 + 48);
    expect(sample.bitrate_in_kbps).toBe(1000);
    expect(sample.loss_in_pct).toBe(3);
    expect(sample.loss_out_pct).toBe(4);
    expect(sample.jitter_ms).toBe(30);
    expect(sample.rtt_ms).toBe(120);
    expect(sample.share_direction).toBe("send");
    expect(sample).toMatchObject({ share_width: 1920, share_height: 1080, share_fps: 7.6 });
    expect(sample.quality_limitation).toBe("bandwidth");
    expect(sample.connection_type).toBe("relay");
    expect(sample.transport).toBe("tls");
    expect(hasCallMetrics(sample)).toBe(true);
  });

  it("reports a received screen share and a direct connection", () => {
    const entry = {
      source: "screen_share",
      direction: "recv",
      report: report([
        ...transportStats(),
        { id: "IS", type: "inbound-rtp", kind: "video", timestamp: 1, bytesReceived: 10, framesPerSecond: 5, frameWidth: 1280, frameHeight: 720 },
      ]),
    };
    const { sample } = summarizeCallStats([entry]);
    expect(sample).toMatchObject({ share_direction: "recv", share_height: 720, share_fps: 5, connection_type: "direct", transport: "udp" });
  });

  it("ignores empty or broken input", () => {
    expect(summarizeCallStats(null).sample).toEqual({});
    expect(summarizeCallStats([{ report: null }]).sample).toEqual({});
    expect(hasCallMetrics({ connection_type: "relay" })).toBe(false);
  });
});

describe("collectLiveKitStats", () => {
  it("collects local and remote tracks and survives a failing track", async () => {
    const ok = { getRTCStatsReport: vi.fn(async () => report([{ id: "x", type: "transport" }])) };
    const broken = { getRTCStatsReport: vi.fn(async () => { throw new Error("gone"); }) };
    const room = {
      localParticipant: { trackPublications: new Map([["a", { source: "microphone", track: ok }]]) },
      remoteParticipants: new Map([["s", { trackPublications: new Map([["b", { source: "screen_share", track: broken }], ["c", { source: "camera" }]]) }]]),
    };
    const entries = await collectLiveKitStats(room);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: "microphone", direction: "send" });
  });
});

describe("startCallStats", () => {
  afterEach(() => vi.useRealTimers());

  it("sends from the second snapshot every interval and stops cleanly", async () => {
    vi.useFakeTimers();
    let ts = 0;
    let bytes = 0;
    const collect = vi.fn(async () => {
      ts += 20_000;
      bytes += 120_000;
      return [micSend(ts, bytes)];
    });
    const send = vi.fn(async () => null);
    const stop = startCallStats({
      meetingUuid: "m-1",
      provider: "livekit",
      collect,
      send,
      getMeta: () => ({ reconnects: 2, connection_quality: "Poor", email: "x@example.test" }),
      intervalMs: 20_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(1);
    const [uuid, payload] = send.mock.calls[0];
    expect(uuid).toBe("m-1");
    expect(payload).toMatchObject({ provider: "livekit", audio_out_kbps: 48, reconnects: 2, connection_quality: "poor" });
    expect(payload).not.toHaveProperty("email");
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a meeting", () => {
    const collect = vi.fn();
    startCallStats({ collect })();
    expect(collect).not.toHaveBeenCalled();
  });
});

describe("sendCallStats", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts a small JSON with CSRF and swallows network errors", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendCallStats("m-1", { rtt_ms: 80 })).toBe(true);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/video-meetings/m-1/call-stats/");
    expect(options.method).toBe("POST");
    expect(options.headers["X-CSRFToken"]).toBe("csrf-test");
    expect(JSON.parse(options.body)).toEqual({ rtt_ms: 80 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await sendCallStats("m-1", { rtt_ms: 80 })).toBe(false);
  });
});
