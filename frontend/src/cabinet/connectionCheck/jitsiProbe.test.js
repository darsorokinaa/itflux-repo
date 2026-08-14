import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../utils/cabinetAuth", () => ({
  fetchVideoMeetingConnectionProbe: vi.fn(),
  reportVideoMeetingConnectionProbe: vi.fn(async () => null),
}));

import { classifyJitsiProbe, probeJitsiInfrastructure } from "./jitsiProbe";

describe("classifyJitsiProbe", () => {
  it("reports offline separately from jitsi failure", () => {
    const result = classifyJitsiProbe({ online: false, errorCode: "offline" });
    expect(result.code).toBe("offline");
    expect(result.label).toMatch(/интернет/i);
  });

  it("does not treat a homepage-like config error as bad internet", () => {
    const result = classifyJitsiProbe({ online: true, errorCode: "config" });
    expect(result.code).toBe("config");
    expect(result.label).toMatch(/видеосвязи/);
  });

  it("marks a fast conference join as ok", () => {
    const result = classifyJitsiProbe({
      online: true,
      scriptLoaded: true,
      scriptMs: 800,
      iframeLoaded: true,
      conferenceJoined: true,
      conferenceMs: 4200,
      authMode: "jwt",
      jwtReady: true,
    });
    expect(result.status).toBe("ok");
    expect(result.label).toMatch(/быстро/);
  });

  it("marks a join close to the lesson timeout as slow", () => {
    const result = classifyJitsiProbe({
      online: true,
      scriptLoaded: true,
      scriptMs: 4000,
      iframeLoaded: true,
      conferenceJoined: true,
      conferenceMs: 12000,
      authMode: "jwt",
      jwtReady: true,
    });
    expect(result.status).toBe("fair");
    expect(result.label).toMatch(/медленнее/);
  });

  it("treats jwt join timeout as a jitsi problem", () => {
    const result = classifyJitsiProbe({
      online: true,
      scriptLoaded: true,
      scriptMs: 900,
      iframeLoaded: true,
      conferenceJoined: false,
      authMode: "jwt",
      jwtReady: true,
    });
    expect(result.status).toBe("fail");
    expect(result.message).toMatch(/сервер видеосвязи/);
    expect(result.message).not.toMatch(/плохой интернет/i);
  });
});

describe("probeJitsiInfrastructure", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { onLine: true, userAgent: "vitest" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("loads the script and joins a diagnostic room without calling lesson APIs", async () => {
    const fetchConfig = vi.fn(async () => ({
      domain: "meet.example.test",
      roomName: "diagabc123",
      jwt: "token",
      authMode: "jwt",
      jwtReady: true,
      userInfo: { displayName: "Тест" },
    }));
    const loadApi = vi.fn(async () => {});
    const listeners = {};
    function ExternalApi() {
      this.executeCommand = vi.fn();
      this.dispose = vi.fn();
      this.getIFrame = () => null;
      this.addListener = (name, handler) => {
        listeners[name] = handler;
        if (name === "videoConferenceJoined") {
          queueMicrotask(() => handler({}));
        }
      };
    }

    const result = await probeJitsiInfrastructure({
      fetchConfig,
      loadApi,
      ExternalApi,
      timeoutMs: 500,
    });

    expect(fetchConfig).toHaveBeenCalledTimes(1);
    expect(loadApi).toHaveBeenCalledWith("meet.example.test", expect.any(Object));
    expect(result.status).toBe("ok");
    expect(result.aborted).toBeFalsy();
  });

  it("returns a jitsi-unreachable status when the script cannot load", async () => {
    const result = await probeJitsiInfrastructure({
      fetchConfig: async () => ({
        domain: "meet.example.test",
        roomName: "diagabc123",
        authMode: "jwt",
        jwtReady: true,
      }),
      loadApi: async () => {
        const err = new Error("Не удалось загрузить Jitsi Meet");
        err.code = "jitsi_script";
        throw err;
      },
      timeoutMs: 200,
    });
    expect(result.status).toBe("fail");
    expect(result.code).toBe("jitsi_unreachable");
  });
});
