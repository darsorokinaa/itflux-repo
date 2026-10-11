import { describe, expect, it, vi } from "vitest";

import {
  classifyJaasReachability,
  loadJaasScriptByFetch,
  omitOpaqueFetchCacheMode,
  probeJaasReachability,
} from "./jaasReachability";

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

  it("does not call a slow script a network block", () => {
    const slow = classifyJaasReachability({ online: true, scriptLoaded: false, scriptTimedOut: true });
    expect(slow.code).toBe("script_timeout");
    expect(slow.label).not.toMatch(/недоступен/i);
    expect(slow.message).toMatch(/не доказательство блокировки/i);
  });

  it("tells an iPhone home-screen launch to open Safari", () => {
    const blocked = classifyJaasReachability({
      online: true,
      scriptLoaded: false,
      openedFromIosHomeScreen: true,
    });
    expect(blocked.label).toMatch(/недоступен/i);
    expect(blocked.message).toMatch(/Safari/);
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
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      platform: "Win32",
      onLine: true,
      maxTouchPoints: 0,
    });
    await loadJaasScriptByFetch("8x8.vc", "https://8x8.vc/app/external_api.js", 1000);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://8x8.vc/app/external_api.js",
      expect.objectContaining({ mode: "no-cors", cache: "no-store" }),
    );
    expect(document.getElementById("jitsi-external-api-script")).toBeNull();
    expect(document.querySelector('link[rel="preload"]')).toBeNull();
    vi.unstubAllGlobals();
  });

  it("does not use cache no-store on iPhone and falls back without executing the script", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Load failed");
    });
    vi.stubGlobal("fetch", fetchImpl);
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      onLine: true,
      maxTouchPoints: 5,
    });
    expect(omitOpaqueFetchCacheMode()).toBe(true);
    const pending = loadJaasScriptByFetch("8x8.vc", "https://8x8.vc/app/external_api.js", 1000);
    const link = await vi.waitFor(() => {
      const node = document.querySelector('link[rel="preload"][as="script"]');
      expect(node).toBeTruthy();
      return node;
    });
    expect(fetchImpl.mock.calls[0][1].cache).toBeUndefined();
    link.dispatchEvent(new Event("load"));
    await pending;
    expect(document.getElementById("jitsi-external-api-script")).toBeNull();
    expect(document.querySelector('link[rel="preload"]')).toBeNull();
    vi.unstubAllGlobals();
  });

  it("does not treat a timed-out script load as a blocked network", async () => {
    const timeout = new Error("Не удалось загрузить Jitsi Meet");
    timeout.code = "jitsi_script_timeout";
    const result = await probeJaasReachability({
      fetchConfig: async () => ({
        domain: "8x8.vc",
        scriptUrl: "https://8x8.vc/app/external_api.js",
      }),
      loadApi: async () => {
        throw timeout;
      },
      openSocket: async () => "open",
      queryPermission: async () => "granted",
      checkSignaling: false,
    });
    expect(result.code).toBe("script_timeout");
    expect(result.label).not.toMatch(/недоступен/i);
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
