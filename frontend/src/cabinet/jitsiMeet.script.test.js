import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  JITSI_SCRIPT_LOAD_TIMEOUT_MS,
  JOIN_SLOW_THRESHOLD_MS,
  jitsiExternalApiScriptUrl,
  loadJitsiExternalApi,
  resolveJitsiApiRoomName,
} from "./jitsiMeet";

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

  it("loads the JaaS external API from the backend script URL", () => {
    expect(jitsiExternalApiScriptUrl(
      "8x8.vc",
      "https://8x8.vc/vpaas-magic-cookie-test/external_api.js",
    )).toBe("https://8x8.vc/vpaas-magic-cookie-test/external_api.js");
    expect(jitsiExternalApiScriptUrl("meet.example.test", "")).toBe(
      "https://meet.example.test/libs/external_api.min.js",
    );
    expect(jitsiExternalApiScriptUrl("8x8.vc", "https://evil.example/external_api.js")).toBe(
      "https://8x8.vc/libs/external_api.min.js",
    );
  });

  it("gives the JaaS script longer than the 15s join hint", () => {
    expect(JITSI_SCRIPT_LOAD_TIMEOUT_MS).toBeGreaterThan(JOIN_SLOW_THRESHOLD_MS);
    expect(JITSI_SCRIPT_LOAD_TIMEOUT_MS).toBeLessThanOrEqual(60000);
  });

  it("keeps the lesson room and prefixes it for JaaS", () => {
    expect(resolveJitsiApiRoomName({
      roomName: "digitalstreamroom",
      externalRoomName: "vpaas-magic-cookie-test/digitalstreamroom",
    })).toBe("vpaas-magic-cookie-test/digitalstreamroom");
    expect(resolveJitsiApiRoomName({ roomName: "digitalstreamroom" })).toBe("digitalstreamroom");
  });

  it("times out instead of waiting forever and does not call that a DNS failure", async () => {
    vi.useFakeTimers();
    const pending = loadJitsiExternalApi("meet.example.test", { timeoutMs: 50 });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "jitsi_script_timeout",
      scriptLoadEvent: false,
      scriptErrorEvent: false,
      apiGlobal: false,
      iframeCreated: false,
    });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    expect(document.getElementById("jitsi-external-api-script")).toBeNull();
    vi.useRealTimers();
  });

  it("does not attach a second wait to a script element that never loaded", async () => {
    const stuck = document.createElement("script");
    stuck.id = "jitsi-external-api-script";
    stuck.src = "https://meet.example.test/libs/external_api.min.js";
    document.head.appendChild(stuck);
    vi.useFakeTimers();
    const pending = loadJitsiExternalApi("meet.example.test", { timeoutMs: 5000 });
    window.JitsiMeetExternalAPI = function JitsiMeetExternalAPI() {};
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBe(window.JitsiMeetExternalAPI);
    expect(document.getElementById("jitsi-external-api-script")).not.toBe(stuck);
    vi.useRealTimers();
  });

  it("resolves when the script runs but Safari does not fire load", async () => {
    vi.useFakeTimers();
    const pending = loadJitsiExternalApi("meet.example.test", { timeoutMs: 5000 });
    window.JitsiMeetExternalAPI = function JitsiMeetExternalAPI() {};
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBe(window.JitsiMeetExternalAPI);
    vi.useRealTimers();
  });
});
