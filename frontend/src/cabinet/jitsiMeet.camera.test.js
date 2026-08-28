import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
  buildJitsiAppData,
  buildJitsiConfigOverwrite,
  buildJitsiEmbedUrl,
  buildJitsiExternalApiOptions,
  buildJitsiInterfaceConfigOverwrite,
  getMeetingCameraEnabled,
  hasValidJitsiLocalStorageContent,
  installJitsiIframeCreateSanitizer,
  setMeetingCameraEnabled,
  stripNullJitsiLocalStorageContentFromUrl,
} from "./jitsiMeet";

describe("meeting camera preference", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("stores and reads camera preference per meeting", () => {
    expect(getMeetingCameraEnabled("m1")).toBeNull();
    setMeetingCameraEnabled("m1", true);
    expect(getMeetingCameraEnabled("m1")).toBe(true);
    setMeetingCameraEnabled("m1", false);
    expect(getMeetingCameraEnabled("m1")).toBe(false);
    expect(getMeetingCameraEnabled("m2")).toBeNull();
  });

  it("passes startWithVideoMuted into config overwrite", () => {
    expect(buildJitsiConfigOverwrite({ startWithVideoMuted: true }).startWithVideoMuted).toBe(true);
    expect(buildJitsiConfigOverwrite({ startWithVideoMuted: false }).startWithVideoMuted).toBe(false);
  });

  it("keeps lobby off and forces JVB (no P2P) for school NAT", () => {
    const cfg = buildJitsiConfigOverwrite();
    expect(cfg.disableLobbyMode).toBe(true);
    expect(cfg.p2p).toEqual({ enabled: false });
    expect(cfg.preferBosh).toBe(true);
    expect(cfg.channelLastN).toBe(8);
    expect(cfg.enableNoAudioDetection).toBe(true);
  });

  it("encodes startWithVideoMuted in embed URL", () => {
    const urlOn = buildJitsiEmbedUrl({
      domain: "meet.example.com",
      roomName: "room-a",
      startWithVideoMuted: false,
    });
    const urlOff = buildJitsiEmbedUrl({
      domain: "meet.example.com",
      roomName: "room-a",
      startWithVideoMuted: true,
    });
    expect(urlOn).toContain("config.startWithVideoMuted=false");
    expect(urlOff).toContain("config.startWithVideoMuted=true");
  });

  it("hides Jitsi branding in interface overwrite and embed URL", () => {
    const iface = buildJitsiInterfaceConfigOverwrite();
    expect(iface.SHOW_JITSI_WATERMARK).toBe(false);
    expect(iface.SHOW_WATERMARK_FOR_GUESTS).toBe(false);
    expect(iface.SHOW_POWERED_BY).toBe(false);
    expect(iface.APP_NAME).toBe("Цифровой поток");
    expect(iface.PROVIDER_NAME).toBe("Цифровой поток");

    const url = buildJitsiEmbedUrl({
      domain: "meet.example.com",
      roomName: "room-a",
    });
    expect(url).toContain("interfaceConfig.SHOW_JITSI_WATERMARK=false");
    expect(url).toContain("interfaceConfig.SHOW_POWERED_BY=false");
    expect(url).toContain("config.inviteAppName=");
    expect(url).toContain("config.p2p.enabled=false");
    expect(url).toContain("config.preferBosh=true");
  });

  it("keeps audio muted by default for Без камеры / first join", () => {
    expect(buildJitsiConfigOverwrite({ startWithVideoMuted: true }).startWithAudioMuted).toBe(true);
    expect(buildJitsiConfigOverwrite({ startWithVideoMuted: true, startWithAudioMuted: true }).startWithVideoMuted).toBe(true);
  });
});

describe("E: Jitsi appData.localStorageContent", () => {
  beforeEach(() => {
    window.localStorage.removeItem("jitsiLocalStorage");
  });

  afterEach(() => {
    window.localStorage.removeItem("jitsiLocalStorage");
  });

  it("does not treat null or missing storage as valid content", () => {
    expect(hasValidJitsiLocalStorageContent(null)).toBe(false);
    expect(hasValidJitsiLocalStorageContent(undefined)).toBe(false);
    expect(hasValidJitsiLocalStorageContent("null")).toBe(false);
    expect(hasValidJitsiLocalStorageContent("{}")).toBe(true);
    expect(buildJitsiAppData(null)).toBeUndefined();
    expect(buildJitsiAppData("null")).toBeUndefined();
  });

  it("omits appData.localStorageContent when storage is absent", () => {
    const options = buildJitsiExternalApiOptions({
      roomName: "digitalstreamroom",
      parentNode: document.createElement("div"),
      configOverwrite: {},
      interfaceConfigOverwrite: {},
    });
    expect(options).not.toHaveProperty("appData");
    expect(options.appData?.localStorageContent).toBeUndefined();

    const withNull = buildJitsiExternalApiOptions({
      roomName: "digitalstreamroom",
      parentNode: document.createElement("div"),
      configOverwrite: {},
      interfaceConfigOverwrite: {},
      localStorageContent: null,
    });
    expect(withNull).not.toHaveProperty("appData");
  });

  it("does not put localStorageContent=null into embed URL", () => {
    const url = buildJitsiEmbedUrl({
      domain: "meet.example.com",
      roomName: "room-a",
    });
    expect(url).not.toContain("localStorageContent");
    expect(url).not.toContain("appData.");
  });

  it("strips null localStorageContent from iframe hash", () => {
    expect(stripNullJitsiLocalStorageContentFromUrl(
      "https://meet.example.test/room#appData.localStorageContent=null&config.prejoinPageEnabled=false",
    )).toBe("https://meet.example.test/room#config.prejoinPageEnabled=false");
    expect(stripNullJitsiLocalStorageContentFromUrl(
      "https://meet.example.test/room#appData.localStorageContent=%22null%22",
    )).not.toContain("localStorageContent");
  });

  it("sanitizes iframe src before the first navigation", () => {
    const restore = installJitsiIframeCreateSanitizer();
    try {
      const iframe = document.createElement("iframe");
      iframe.src = "https://meet.example.test/room#appData.localStorageContent=null&config.x=1";
      expect(iframe.src).not.toContain("localStorageContent=null");
      expect(iframe.src).not.toMatch(/appData\.localStorageContent=/);
      expect(iframe.src).toContain("config.x=1");
    } finally {
      restore();
    }
  });
});
