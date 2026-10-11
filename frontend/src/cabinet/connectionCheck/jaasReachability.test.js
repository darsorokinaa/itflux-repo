import { describe, expect, it, vi } from "vitest";

import { classifyJaasReachability, loadJaasScriptByFetch, probeJaasReachability } from "./jaasReachability";

describe("classifyJaasReachability", () => {
  it("does not treat a loaded script as a working call", () => {
    const result = classifyJaasReachability({
      online: true,
      scriptLoaded: true,
      signaling: "open",
      microphone: "granted",
      camera: "granted",
    });
    expect(result.mediaConfirmed).toBe(false);
    expect(result.conferenceJoined).toBe(false);
    expect(result.status).not.toBe("ok");
    expect(result.label).not.toMatch(/хорош/i);
    expect(result.message).toMatch(/не подтверждает/i);
  });

  it("separates a missing script from a denied microphone", () => {
    const missing = classifyJaasReachability({ online: true, scriptLoaded: false });
    expect(missing.code).toBe("script");
    expect(missing.failureClass).toBe("dns_or_https");
    expect(missing.dnsSeparated).toBe(false);
    expect(missing.label).toMatch(/недоступен/i);
    const mic = classifyJaasReachability({
      online: true,
      scriptLoaded: true,
      microphone: "denied",
    });
    expect(mic.status).toBe("fair");
    expect(mic.message).toMatch(/микрофон/i);
  });
});

describe("probeJaasReachability", () => {
  it("loads the script and does not construct a conference", async () => {
    const loadApi = vi.fn(async () => ({}));
    const ExternalApi = vi.fn();
    const result = await probeJaasReachability({
      fetchConfig: async () => ({
        domain: "8x8.vc",
        scriptUrl: "https://8x8.vc/app/external_api.js",
        jwt: "must-not-be-used",
        roomName: "must-not-be-used",
      }),
      loadApi,
      openSocket: async () => "open",
      queryPermission: async () => "granted",
      checkSignaling: true,
    });
    expect(loadApi).toHaveBeenCalledWith("8x8.vc", "https://8x8.vc/app/external_api.js", expect.any(Number));
    expect(ExternalApi).not.toHaveBeenCalled();
    expect(result.code).toBe("script_only");
    expect(result.mediaConfirmed).toBe(false);
    expect(result.conferenceJoined).toBe(false);
  });

  it("does not insert a script tag when checking by fetch", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchImpl);
    await loadJaasScriptByFetch("8x8.vc", "https://8x8.vc/app/external_api.js", 1000);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://8x8.vc/app/external_api.js",
      expect.objectContaining({ mode: "no-cors" }),
    );
    expect(document.getElementById("jitsi-external-api-script")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("stops when aborted before reporting success", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await probeJaasReachability({
      fetchConfig: async () => ({ domain: "8x8.vc", scriptUrl: "https://8x8.vc/external_api.js" }),
      loadApi: async () => {
        throw new Error("should not load");
      },
      signal: controller.signal,
    });
    expect(result.code).toBe("aborted");
  });
});
