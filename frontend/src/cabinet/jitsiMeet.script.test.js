import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { jitsiExternalApiScriptUrl, loadJitsiExternalApi, resolveJitsiApiRoomName } from "./jitsiMeet";

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

  it("keeps the lesson room and prefixes it for JaaS", () => {
    expect(resolveJitsiApiRoomName({
      roomName: "digitalstreamroom",
      externalRoomName: "vpaas-magic-cookie-test/digitalstreamroom",
    })).toBe("vpaas-magic-cookie-test/digitalstreamroom");
    expect(resolveJitsiApiRoomName({ roomName: "digitalstreamroom" })).toBe("digitalstreamroom");
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
