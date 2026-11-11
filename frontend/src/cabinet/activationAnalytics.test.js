import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  captureAcquisition,
  INTENT_EVENTS,
  readAcquisition,
  trackActivationIntent,
} from "./activationAnalytics";

describe("activationAnalytics", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.cookie = "csrftoken=test-csrf";
    vi.restoreAllMocks();
  });

  it("does not send confirmed events from the client", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    await trackActivationIntent("student_created");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dedupes intent events in the same session", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await trackActivationIntent("add_student_clicked", { source: "dashboard" });
    await trackActivationIntent("add_student_clicked", { source: "dashboard" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("captures utm without overwriting an existing source", () => {
    captureAcquisition({
      search: "?utm_source=vk&utm_campaign=potok1110&utm_content=post608&ref=608",
      referrer: "https://vk.com/",
    });
    captureAcquisition({ search: "?utm_source=google", referrer: "https://google.com/" });
    const stored = readAcquisition();
    expect(stored.utm_source).toBe("vk");
    expect(stored.utm_campaign).toBe("potok1110");
    expect(stored.utm_content).toBe("post608");
    expect(stored.ref).toBe("608");
    expect(localStorage.getItem("cabinet_acquisition")).toContain("post608");
  });

  it("lists only intent event names", () => {
    expect(INTENT_EVENTS.has("student_created")).toBe(false);
    expect(INTENT_EVENTS.has("add_student_clicked")).toBe(true);
  });
});
