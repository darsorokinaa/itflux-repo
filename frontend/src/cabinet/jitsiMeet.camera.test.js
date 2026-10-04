import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
  applyJitsiCallChrome,
  applyJitsiCameraResolution,
  buildJitsiAppData,
  buildJitsiConfigOverwrite,
  buildJitsiEmbedUrl,
  buildJitsiExternalApiOptions,
  buildJitsiHostsOverwrite,
  buildJitsiInterfaceConfigOverwrite,
  jitsiCallChromeConfig,
  getMeetingCameraEnabled,
  hasValidJitsiLocalStorageContent,
  installJitsiIframeCreateSanitizer,
  setMeetingCameraEnabled,
  showCallTilesSideBySide,
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

  it("starts the camera on the highest Jitsi resolution", () => {
    const cfg = buildJitsiConfigOverwrite();
    expect(cfg.resolution).toBe(1080);
    expect(cfg.constraints.video.height).toEqual({ ideal: 1080, max: 1080, min: 180 });
    expect(cfg.constraints.video.width).toEqual({ ideal: 1920, max: 1920 });
    expect(cfg.videoQuality.maxFullResolution).toBe(1080);
    const commands = [];
    applyJitsiCameraResolution({
      executeCommand: (name, value) => commands.push([name, value]),
    });
    expect(commands).toEqual([["setVideoQuality", 1080]]);
    const url = buildJitsiEmbedUrl({
      domain: "8x8.vc",
      roomName: "digitalstreamroom",
    });
    expect(url).toContain("config.resolution=1080");
    expect(url).toContain("config.constraints.video.height.ideal=1080");
    expect(url).toContain("config.constraints.video.height.max=1080");
  });

  it("keeps lobby off and forces JVB (no P2P) for school NAT", () => {
    const cfg = buildJitsiConfigOverwrite();
    expect(cfg.disableLobbyMode).toBe(true);
    expect(cfg.p2p).toEqual({ enabled: false });
    expect(cfg.preferBosh).toBe(true);
    expect(cfg.replaceParticipant).toBe(true);
    expect(cfg.channelLastN).toBe(8);
    expect(cfg.enableNoAudioDetection).toBe(true);
    expect(cfg.enableIceRestart).toBe(true);
    expect(cfg.disableRemoteControl).toBe(false);
    expect(cfg.disableSelfView).toBeUndefined();
    expect(cfg.startAudioOnly).toBeUndefined();
    expect(cfg.disableTileEnlargement).toBeUndefined();
    expect(cfg.filmstrip?.disableStageFilmstrip).not.toBe(true);
    expect(cfg.toolbarButtons).toEqual(["microphone", "camera", "desktop", "hangup"]);
    expect(cfg.toolbarButtons).not.toContain("chat");
  });

  it("opens every Jitsi toolbar action only in the expanded call", () => {
    const compact = jitsiCallChromeConfig(false);
    const expanded = jitsiCallChromeConfig(true);
    expect(compact.toolbarButtons).toEqual(["microphone", "camera", "desktop", "hangup"]);
    expect(compact.toolbarConfig.alwaysVisible).toBe(false);
    expect(expanded.toolbarConfig.alwaysVisible).toBe(true);
    ["chat", "raisehand", "participants-pane", "tileview", "settings", "whiteboard", "recording"].forEach((name) => {
      expect(expanded.toolbarButtons).toContain(name);
      expect(compact.toolbarButtons).not.toContain(name);
    });
    const commands = [];
    const api = { executeCommand: (name, value) => commands.push([name, value]) };
    applyJitsiCallChrome(api, { expanded: true });
    applyJitsiCallChrome(api, { expanded: false });
    expect(commands.map((entry) => entry[0])).toEqual(["overwriteConfig", "overwriteConfig"]);
    expect(commands[0][1].toolbarButtons).toContain("chat");
    expect(commands[1][1].toolbarButtons).not.toContain("chat");
    expect(commands[1][1].toolbarConfig.alwaysVisible).toBe(false);
  });

  it("keeps both participants visible side by side", () => {
    const cfg = buildJitsiConfigOverwrite({ startWithVideoMuted: false, domain: "8x8.vc" });
    expect(cfg.disableSelfView).not.toBe(true);
    expect(cfg.filmstrip?.disabled).not.toBe(true);
    expect(cfg.filmstrip?.disableStageFilmstrip).not.toBe(true);
    expect(cfg.disableTileEnlargement).toBeUndefined();
    const url = buildJitsiEmbedUrl({
      domain: "8x8.vc",
      roomName: "digitalstreamroom",
      startWithVideoMuted: false,
    });
    expect(url).not.toContain("disableSelfView");
    expect(url).not.toContain("disableStageFilmstrip=true");
    expect(url).not.toContain("disableTileEnlargement");
  });

  it("keeps a solo camera on the large stage and puts two cameras side by side", () => {
    const commands = [];
    const api = {
      getContentSharingParticipants: () => [],
      getParticipantsInfo: () => [{ participantId: "me" }],
      executeCommand: (name, value) => commands.push([name, value]),
    };
    showCallTilesSideBySide(api);
    expect(commands).toEqual([["setTileView", false]]);

    commands.length = 0;
    api.getParticipantsInfo = () => [{ participantId: "me" }, { participantId: "student" }];
    showCallTilesSideBySide(api);
    expect(commands).toEqual([["setTileView", true]]);

    commands.length = 0;
    api.getContentSharingParticipants = () => [{ id: "share" }];
    showCallTilesSideBySide(api);
    expect(commands).toEqual([]);
  });

  it("pins MUC host to conference.<domain> so JWT sub matches the room", () => {
    expect(buildJitsiHostsOverwrite("lesson.itflux-academy.ru")).toEqual({
      domain: "lesson.itflux-academy.ru",
      muc: "conference.lesson.itflux-academy.ru",
    });
    expect(buildJitsiConfigOverwrite({ domain: "lesson.itflux-academy.ru" }).hosts).toEqual({
      domain: "lesson.itflux-academy.ru",
      muc: "conference.lesson.itflux-academy.ru",
    });
    expect(buildJitsiConfigOverwrite({ domain: "meet.jit.si" }).hosts).toBeUndefined();
    expect(buildJitsiConfigOverwrite({ domain: "8x8.vc" }).hosts).toBeUndefined();
    expect(buildJitsiConfigOverwrite({ domain: "8x8.vc" }).preferBosh).toBe(false);
    const embed = buildJitsiEmbedUrl({
      domain: "lesson.itflux-academy.ru",
      roomName: "digitalstreamroom",
    });
    expect(embed).toContain("config.hosts.domain=");
    expect(embed).toContain("conference.lesson.itflux-academy.ru");
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
    expect(url).toContain("config.enableIceRestart=true");
    expect(url).toContain("config.preferBosh=true");
    expect(url).toContain("config.replaceParticipant=true");
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
