import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { loadJitsiExternalApi } from "./jitsiMeet";

describe("loadJitsiExternalApi", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    delete window.JitsiMeetExternalAPI;
  });

  afterEach(() => {
    document.head.innerHTML = "";
    delete window.JitsiMeetExternalAPI;
  });

  it("resolves immediately if the API is already present", async () => {
    window.JitsiMeetExternalAPI = function JitsiMeetExternalAPI() {};
    await expect(loadJitsiExternalApi("meet.example.test")).resolves.toBe(window.JitsiMeetExternalAPI);
  });

  it("does not hang when an existing script already finished loading", async () => {
    const script = document.createElement("script");
    script.id = "jitsi-external-api-script";
    script.dataset.jitsiReady = "1";
    document.head.appendChild(script);
    window.JitsiMeetExternalAPI = function JitsiMeetExternalAPI() {};
    await expect(loadJitsiExternalApi("meet.example.test", { timeoutMs: 200 })).resolves.toBe(window.JitsiMeetExternalAPI);
  });

  it("times out instead of waiting forever", async () => {
    vi.useFakeTimers();
    const pending = loadJitsiExternalApi("meet.example.test", { timeoutMs: 50 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "jitsi_script_timeout" });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();
  });
});
