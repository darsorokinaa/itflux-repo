import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mapMediaError, mediaApiSupported } from "./mediaErrors";
import {
  connectionCheckStreamCount,
  stopAllConnectionCheckStreams,
  stopMediaStream,
  trackMediaStream,
} from "./mediaCleanup";
import {
  isConnectionCheckFresh,
  readConnectionCheckResult,
  writeConnectionCheckResult,
  CONNECTION_CHECK_STORAGE_KEY,
} from "./storage";
import { probeConnectionQuality } from "./connectionProbe";

describe("mapMediaError", () => {
  it("does not expose raw DOMException names", () => {
    const mapped = mapMediaError({ name: "NotAllowedError" }, "microphone");
    expect(mapped.message).not.toMatch(/NotAllowedError/);
    expect(mapped.title).toMatch(/микрофон/i);
  });

  it("explains a busy device", () => {
    const mapped = mapMediaError({ name: "NotReadableError" }, "camera");
    expect(mapped.code).toBe("busy");
    expect(mapped.message).toMatch(/другое приложение/i);
  });

  it("explains a missing device", () => {
    const mapped = mapMediaError({ name: "NotFoundError" }, "camera");
    expect(mapped.code).toBe("not-found");
  });

  it("explains a dismissed permission prompt", () => {
    const mapped = mapMediaError({ name: "NotAllowedError", message: "Permission dismissed" }, "camera");
    expect(mapped.code).toBe("dismissed");
    expect(mapped.message).toMatch(/Проверить ещё раз/i);
  });
});

describe("mediaCleanup", () => {
  it("stops tracks and clears the registry", () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    trackMediaStream(stream);
    expect(connectionCheckStreamCount()).toBe(1);
    stopMediaStream(stream);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(connectionCheckStreamCount()).toBe(0);
  });

  it("stopAllConnectionCheckStreams releases leftover streams", () => {
    const track = { stop: vi.fn() };
    trackMediaStream({ getTracks: () => [track] });
    stopAllConnectionCheckStreams();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(connectionCheckStreamCount()).toBe(0);
  });
});

describe("connection check storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores today's result and treats it as fresh", () => {
    const saved = writeConnectionCheckResult({
      camera: "ok",
      microphone: "ok",
      speaker: "ok",
      connection: "good",
    });
    expect(readConnectionCheckResult()?.camera).toBe("ok");
    expect(isConnectionCheckFresh(saved)).toBe(true);
  });

  it("treats yesterday's result as stale", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    localStorage.setItem(CONNECTION_CHECK_STORAGE_KEY, JSON.stringify({
      checked_at: yesterday.toISOString(),
      camera: "ok",
      microphone: "ok",
      speaker: "ok",
      connection: "good",
      browser: "chrome",
      device_type: "desktop",
    }));
    expect(isConnectionCheckFresh(readConnectionCheckResult())).toBe(false);
  });
});

describe("probeConnectionQuality", () => {
  afterEach(() => {
    vi.unstubAllGlobals?.();
  });

  it("classifies a fast stable probe as good", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await probeConnectionQuality({ fetchImpl });
    expect(result.status).toBe("good");
    expect(result.label).not.toMatch(/packet loss|ICE|WebRTC/i);
  });

  it("classifies total failure as poor without using only navigator.onLine", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await probeConnectionQuality({ fetchImpl });
    expect(result.status).toBe("poor");
    expect(result.failureCount).toBeGreaterThan(0);
  });
});

describe("mediaApiSupported", () => {
  it("is false without mediaDevices", () => {
    expect(mediaApiSupported()).toBe(false);
  });
});
