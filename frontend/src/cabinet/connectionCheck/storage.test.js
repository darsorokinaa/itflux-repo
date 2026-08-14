import { describe, expect, it, beforeEach } from "vitest";

import {
  CONNECTION_CHECK_STORAGE_KEY,
  isConnectionCheckFresh,
  readConnectionCheckResult,
  writeConnectionCheckResult,
} from "./storage";

describe("connection check storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores jitsi status locally without server fields", () => {
    const payload = writeConnectionCheckResult({
      camera: "ok",
      microphone: "ok",
      speaker: "ok",
      connection: "good",
      jitsi: "ok",
    });
    expect(payload.jitsi).toBe("ok");
    expect(readConnectionCheckResult().jitsi).toBe("ok");
    expect(localStorage.getItem(CONNECTION_CHECK_STORAGE_KEY)).toContain("jitsi");
  });

  it("treats yesterday as stale", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    writeConnectionCheckResult({
      checked_at: yesterday.toISOString(),
      camera: "ok",
      microphone: "ok",
      speaker: "ok",
      connection: "good",
      jitsi: "ok",
    });
    expect(isConnectionCheckFresh()).toBe(false);
  });
});
