/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindAutoPictureInPicture,
  bindVideoSource,
  buildJitsiPipConfigOverwrite,
  createJitsiPipController,
  currentDocumentPipWindow,
  detectCallPipSupport,
  disableJitsiAutoIntersectionPip,
  exitAnyCallPip,
  hasTransientActivation,
  openOwnCallPip,
  requestVideoElementPip,
  setVideoAutoPip,
  unbindVideoSource,
} from "./callPip";

function makeEnv({
  documentPip = false,
  videoPip = false,
  webkit = false,
  mediaSession = false,
  activation,
  requestWindow,
} = {}) {
  const listeners = {};
  const dpip = documentPip ? {
    window: null,
    requestWindow: requestWindow || vi.fn(),
    addEventListener: vi.fn((name, fn) => { listeners[name] = fn; }),
    removeEventListener: vi.fn((name) => { delete listeners[name]; }),
  } : undefined;
  const proto = {};
  if (videoPip) proto.requestPictureInPicture = () => {};
  if (webkit) proto.webkitSetPresentationMode = () => {};
  const session = mediaSession ? { setActionHandler: vi.fn() } : undefined;
  const env = {
    document: { pictureInPictureEnabled: videoPip, pictureInPictureElement: null, exitPictureInPicture: vi.fn(async () => {}) },
    navigator: {
      mediaSession: session,
      userActivation: activation === undefined ? undefined : { isActive: activation },
    },
    HTMLVideoElement: function HTMLVideoElement() {},
    documentPictureInPicture: dpip,
    setInterval: vi.fn(() => 7),
    clearInterval: vi.fn(),
    setTimeout: vi.fn(),
    focus: vi.fn(),
  };
  env.HTMLVideoElement.prototype = proto;
  return { env, listeners, session, dpip };
}

function makePipWindow() {
  const doc = document.implementation.createHTMLDocument("pip");
  const handlers = {};
  return {
    document: doc,
    closed: false,
    close: vi.fn(function close() {
      this.closed = true;
      handlers.pagehide?.();
    }),
    addEventListener: vi.fn((name, fn) => { handlers[name] = fn; }),
    removeEventListener: vi.fn(),
    fire: (name) => handlers[name]?.(),
  };
}

function makeJitsiApi() {
  const events = {};
  return {
    showPiP: vi.fn(),
    hidePiP: vi.fn(),
    executeCommand: vi.fn(),
    _teardownIntersectionObserver: vi.fn(),
    addListener: vi.fn((name, fn) => { events[name] = fn; }),
    removeListener: vi.fn((name) => { delete events[name]; }),
    events,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectCallPipSupport", () => {
  it("reports nothing in a bare environment (Firefox-like)", () => {
    const { env } = makeEnv();
    const support = detectCallPipSupport(env);
    expect(support).toMatchObject({ documentPip: false, videoPip: false, webkitPresentation: false, any: false });
  });

  it("detects Document PiP, video PiP and media session (Chrome-like)", () => {
    const { env } = makeEnv({ documentPip: true, videoPip: true, mediaSession: true });
    const support = detectCallPipSupport(env);
    expect(support).toMatchObject({ documentPip: true, videoPip: true, mediaSession: true, any: true });
  });

  it("detects WebKit presentation mode (Safari-like)", () => {
    const { env } = makeEnv({ webkit: true, videoPip: true });
    expect(detectCallPipSupport(env)).toMatchObject({ documentPip: false, webkitPresentation: true, any: true });
  });

  it("treats pictureInPictureEnabled=false as no video PiP", () => {
    const { env } = makeEnv({ videoPip: true });
    env.document.pictureInPictureEnabled = false;
    expect(detectCallPipSupport(env).videoPip).toBe(false);
  });

  it("does not throw on a throwing getter", () => {
    const env = {
      get documentPictureInPicture() {
        throw new Error("boom");
      },
      document: {},
      navigator: {},
    };
    expect(() => detectCallPipSupport(env)).not.toThrow();
    expect(detectCallPipSupport(env).documentPip).toBe(false);
  });
});

describe("hasTransientActivation", () => {
  it("reads navigator.userActivation.isActive", () => {
    expect(hasTransientActivation(makeEnv({ activation: true }).env)).toBe(true);
    expect(hasTransientActivation(makeEnv({ activation: false }).env)).toBe(false);
  });
  it("assumes a gesture where the API is missing", () => {
    expect(hasTransientActivation(makeEnv().env)).toBe(true);
  });
});

describe("buildJitsiPipConfigOverwrite", () => {
  it("is null without Document PiP (Safari/Firefox stay as before)", () => {
    expect(buildJitsiPipConfigOverwrite(makeEnv({ webkit: true, videoPip: true }).env)).toBeNull();
    expect(buildJitsiPipConfigOverwrite(makeEnv().env)).toBeNull();
  });
  it("enables browser PiP without a Jitsi toolbar button", () => {
    const cfg = buildJitsiPipConfigOverwrite(makeEnv({ documentPip: true }).env);
    expect(cfg.pip.enableBrowserPiP).toBe(true);
    expect(cfg.pip.showToolbarButton).toBe(false);
    expect(cfg.pip.showOnPrejoin).toBe(false);
    expect(cfg.pip.documentPiP.windowOptions.width).toBeGreaterThan(200);
  });
});

describe("disableJitsiAutoIntersectionPip", () => {
  it("tears down the External API observer when present", () => {
    const api = makeJitsiApi();
    expect(disableJitsiAutoIntersectionPip(api)).toBe(true);
    expect(api._teardownIntersectionObserver).toHaveBeenCalledTimes(1);
  });
  it("is a no-op for older APIs and swallows errors", () => {
    expect(disableJitsiAutoIntersectionPip({})).toBe(false);
    expect(disableJitsiAutoIntersectionPip(null)).toBe(false);
    expect(disableJitsiAutoIntersectionPip({ _teardownIntersectionObserver: () => { throw new Error("x"); } })).toBe(false);
  });
});

describe("bindAutoPictureInPicture", () => {
  it("registers and clears enterpictureinpicture", () => {
    const { env, session } = makeEnv({ mediaSession: true });
    const handler = vi.fn(() => Promise.reject(new Error("no gesture")));
    const unbind = bindAutoPictureInPicture(handler, env);
    expect(session.setActionHandler).toHaveBeenCalledWith("enterpictureinpicture", expect.any(Function));
    const registered = session.setActionHandler.mock.calls[0][1];
    expect(() => registered({ enterPictureInPictureReason: "contentoccluded" })).not.toThrow();
    expect(handler).toHaveBeenCalledWith({ enterPictureInPictureReason: "contentoccluded" });
    unbind();
    expect(session.setActionHandler).toHaveBeenLastCalledWith("enterpictureinpicture", null);
  });

  it("is safe when the action is unknown to the browser", () => {
    const { env, session } = makeEnv({ mediaSession: true });
    session.setActionHandler.mockImplementation(() => {
      throw new TypeError("unknown action");
    });
    const unbind = bindAutoPictureInPicture(() => {}, env);
    expect(() => unbind()).not.toThrow();
  });

  it("is a no-op without media session", () => {
    expect(() => bindAutoPictureInPicture(() => {}, makeEnv().env)()).not.toThrow();
  });
});

describe("createJitsiPipController", () => {
  it("asks Jitsi for PiP via showPiP and disables the auto observer once", () => {
    const { env } = makeEnv({ documentPip: true });
    const api = makeJitsiApi();
    const ctl = createJitsiPipController({ getApi: () => api, env });
    const result = ctl.open();
    expect(result).toMatchObject({ ok: true, pending: true });
    expect(api.showPiP).toHaveBeenCalledTimes(1);
    expect(api._teardownIntersectionObserver).toHaveBeenCalledTimes(1);
    ctl.open();
    expect(api._teardownIntersectionObserver).toHaveBeenCalledTimes(1);
    ctl.dispose();
  });

  it("falls back to executeCommand('showPiP')", () => {
    const { env } = makeEnv({ documentPip: true });
    const api = { executeCommand: vi.fn() };
    const ctl = createJitsiPipController({ getApi: () => api, env });
    expect(ctl.open().ok).toBe(true);
    expect(api.executeCommand).toHaveBeenCalledWith("showPiP");
  });

  it("refuses without Document PiP and without a call", () => {
    const api = makeJitsiApi();
    const noPip = createJitsiPipController({ getApi: () => api, env: makeEnv().env });
    expect(noPip.open()).toMatchObject({ ok: false, reason: "unsupported" });
    expect(api.showPiP).not.toHaveBeenCalled();
    const noCall = createJitsiPipController({ getApi: () => null, env: makeEnv({ documentPip: true }).env });
    expect(noCall.open()).toMatchObject({ ok: false, reason: "no-call" });
  });

  it("does not poke Jitsi without a gesture when one is required", () => {
    const { env } = makeEnv({ documentPip: true, activation: false });
    const api = makeJitsiApi();
    const ctl = createJitsiPipController({ getApi: () => api, env });
    expect(ctl.open({ requireGesture: true })).toMatchObject({ ok: false, reason: "needs-gesture" });
    expect(api.showPiP).not.toHaveBeenCalled();
  });

  it("swallows a throwing showPiP", () => {
    const { env } = makeEnv({ documentPip: true });
    const api = makeJitsiApi();
    api.showPiP.mockImplementation(() => { throw new Error("transport"); });
    const ctl = createJitsiPipController({ getApi: () => api, env });
    expect(ctl.open()).toMatchObject({ ok: false, reason: "error" });
  });

  it("tracks the window opened by the External API and its close", () => {
    const { env, listeners, dpip } = makeEnv({ documentPip: true });
    const api = makeJitsiApi();
    const onChange = vi.fn();
    const ctl = createJitsiPipController({ getApi: () => api, onChange, env });
    ctl.open();
    const pipWin = makePipWindow();
    dpip.window = pipWin;
    listeners.enter({ window: pipWin });
    expect(ctl.isActive()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith({ active: true, supported: true });
    expect(currentDocumentPipWindow(env)).toBe(pipWin);
    // Пользователь закрыл окно крестиком.
    pipWin.closed = true;
    pipWin.fire("pagehide");
    expect(ctl.isActive()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith({ active: false, supported: true });
  });

  it("ignores Document PiP windows before a call is bound", () => {
    const { env, listeners } = makeEnv({ documentPip: true });
    const ctl = createJitsiPipController({ getApi: () => null, env });
    listeners.enter({ window: makePipWindow() });
    expect(ctl.isActive()).toBe(false);
  });

  it("toggle closes an open window via hidePiP and window.close", () => {
    const { env, listeners, dpip } = makeEnv({ documentPip: true });
    const api = makeJitsiApi();
    const ctl = createJitsiPipController({ getApi: () => api, env });
    ctl.open();
    const pipWin = makePipWindow();
    dpip.window = pipWin;
    listeners.enter({ window: pipWin });
    const res = ctl.toggle();
    expect(res).toMatchObject({ ok: true, closed: true });
    expect(api.hidePiP).toHaveBeenCalled();
    expect(pipWin.close).toHaveBeenCalled();
    expect(ctl.isActive()).toBe(false);
  });

  it("listens to pipEntered/pipLeft and removes listeners on dispose", () => {
    const { env, dpip } = makeEnv({ documentPip: true });
    const api = makeJitsiApi();
    const ctl = createJitsiPipController({ getApi: () => api, env });
    ctl.attach();
    api.events.pipEntered();
    expect(ctl.isActive()).toBe(true);
    api.events.pipLeft();
    expect(ctl.isActive()).toBe(false);
    ctl.dispose();
    expect(api.removeListener).toHaveBeenCalledWith("pipEntered", expect.any(Function));
    expect(api.removeListener).toHaveBeenCalledWith("pipLeft", expect.any(Function));
    expect(dpip.removeEventListener).toHaveBeenCalledWith("enter", expect.any(Function));
    expect(ctl.open()).toMatchObject({ ok: false, reason: "disposed" });
  });

  it("re-binds after reconnect (new api object)", () => {
    const { env } = makeEnv({ documentPip: true });
    let api = makeJitsiApi();
    const ctl = createJitsiPipController({ getApi: () => api, env });
    ctl.attach();
    const second = makeJitsiApi();
    api = second;
    ctl.open();
    expect(second.showPiP).toHaveBeenCalled();
    expect(second._teardownIntersectionObserver).toHaveBeenCalled();
  });
});

describe("bindVideoSource", () => {
  it("uses attach/detach of LiveKit tracks and keeps the video muted", () => {
    const video = document.createElement("video");
    video.play = vi.fn(() => Promise.resolve());
    const track = { attach: vi.fn(), detach: vi.fn() };
    expect(bindVideoSource(video, track)).toBe(track);
    expect(track.attach).toHaveBeenCalledWith(video);
    expect(video.muted).toBe(true);
    // Повторная привязка того же трека ничего не делает.
    bindVideoSource(video, track, track);
    expect(track.attach).toHaveBeenCalledTimes(1);
    unbindVideoSource(video, track);
    expect(track.detach).toHaveBeenCalledWith(video);
  });

  it("wraps a raw MediaStreamTrack without clone() and never stops it", () => {
    const created = [];
    class FakeStream {
      constructor(tracks) {
        this.tracks = tracks;
        created.push(this);
      }
    }
    vi.stubGlobal("MediaStream", FakeStream);
    const video = document.createElement("video");
    video.play = vi.fn(() => Promise.resolve());
    const track = { kind: "video", clone: vi.fn(), stop: vi.fn() };
    bindVideoSource(video, track);
    expect(created).toHaveLength(1);
    expect(created[0].tracks).toEqual([track]);
    expect(track.clone).not.toHaveBeenCalled();
    unbindVideoSource(video, track);
    expect(track.stop).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("openOwnCallPip", () => {
  function setup({ reject } = {}) {
    const pipWin = makePipWindow();
    const requestWindow = reject
      ? vi.fn(() => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" })))
      : vi.fn(() => Promise.resolve(pipWin));
    const { env, dpip } = makeEnv({ documentPip: true, requestWindow });
    dpip.window = pipWin;
    return { env, pipWin, requestWindow };
  }

  it("returns needs-gesture when the browser refuses", async () => {
    const { env } = setup({ reject: true });
    await expect(openOwnCallPip({ env, getMedia: () => ({}) })).resolves.toMatchObject({ ok: false, reason: "needs-gesture" });
  });

  it("is unsupported without Document PiP", async () => {
    await expect(openOwnCallPip({ env: makeEnv().env })).resolves.toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("renders remote + self video, wires controls and cleans up on close", async () => {
    const { env, pipWin } = setup();
    const remote = { attach: vi.fn(), detach: vi.fn() };
    const local = { attach: vi.fn(), detach: vi.fn() };
    let micOn = true;
    const media = () => ({
      remote: { source: remote, name: "Иван Петров" },
      local: { source: local },
      micOn,
      camOn: true,
    });
    const actions = { onToggleMic: vi.fn(() => { micOn = !micOn; }), onToggleCam: vi.fn(), onHangup: vi.fn(), onReturn: vi.fn() };
    const onClose = vi.fn();
    const handle = await openOwnCallPip({ env, getMedia: media, actions, onClose });
    expect(handle.ok).toBe(true);
    const doc = pipWin.document;
    const remoteVideo = doc.querySelector('[data-role="remote"]');
    const localVideo = doc.querySelector('[data-role="local"]');
    expect(remote.attach).toHaveBeenCalledWith(remoteVideo);
    expect(local.attach).toHaveBeenCalledWith(localVideo);
    expect(remoteVideo.muted).toBe(true);
    expect(localVideo.muted).toBe(true);
    expect(doc.querySelector('[data-role="name"]').textContent).toBe("Иван Петров");
    expect(doc.querySelector('[data-role="self"]').dataset.off).toBe("false");

    doc.querySelector('[data-action="mic"]').click();
    expect(actions.onToggleMic).toHaveBeenCalled();
    handle.refresh();
    expect(doc.querySelector('[data-action="mic"]').dataset.off).toBe("true");
    doc.querySelector('[data-action="cam"]').click();
    expect(actions.onToggleCam).toHaveBeenCalled();
    doc.querySelector('[data-action="hangup"]').click();
    expect(actions.onHangup).toHaveBeenCalled();

    doc.querySelector('[data-action="back"]').click();
    expect(actions.onReturn).toHaveBeenCalled();
    expect(env.focus).toHaveBeenCalled();
    expect(pipWin.close).toHaveBeenCalled();
    expect(remote.detach).toHaveBeenCalledWith(remoteVideo);
    expect(local.detach).toHaveBeenCalledWith(localVideo);
    expect(env.clearInterval).toHaveBeenCalledWith(7);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(handle.isOpen()).toBe(false);
  });

  it("shows initials when the remote camera is off and cleans up on user close", async () => {
    const { env, pipWin } = setup();
    const remote = { attach: vi.fn(), detach: vi.fn() };
    const handle = await openOwnCallPip({
      env,
      getMedia: () => ({ remote: { source: remote, name: "Мария", cameraOff: true }, local: { cameraOff: true } }),
    });
    const doc = pipWin.document;
    expect(remote.attach).not.toHaveBeenCalled();
    expect(doc.querySelector('[data-role="avatar"]').hidden).toBe(false);
    expect(doc.querySelector('[data-role="initials"]').textContent).toBe("МА");
    expect(doc.querySelector('[data-role="self"]').dataset.off).toBe("true");
    pipWin.fire("pagehide");
    expect(handle.isOpen()).toBe(false);
  });

  it("survives a throwing getMedia", async () => {
    const { env } = setup();
    const handle = await openOwnCallPip({ env, getMedia: () => { throw new Error("gone"); } });
    expect(handle.ok).toBe(true);
    expect(() => handle.refresh()).not.toThrow();
    handle.close();
  });
});

describe("requestVideoElementPip", () => {
  it("uses the standard API", async () => {
    const { env } = makeEnv({ videoPip: true });
    const video = { requestPictureInPicture: vi.fn(async () => ({})) };
    await expect(requestVideoElementPip(video, env)).resolves.toMatchObject({ ok: true, mode: "video" });
  });

  it("falls back to WebKit presentation mode", async () => {
    const { env } = makeEnv({ webkit: true });
    const video = {
      webkitSupportsPresentationMode: () => true,
      webkitSetPresentationMode: vi.fn(),
    };
    await expect(requestVideoElementPip(video, env)).resolves.toMatchObject({ ok: true, mode: "webkit" });
    expect(video.webkitSetPresentationMode).toHaveBeenCalledWith("picture-in-picture");
  });

  it("maps NotAllowedError to needs-gesture and handles no video", async () => {
    const { env } = makeEnv({ videoPip: true });
    const video = {
      requestPictureInPicture: vi.fn(async () => {
        throw Object.assign(new Error("gesture"), { name: "NotAllowedError" });
      }),
    };
    await expect(requestVideoElementPip(video, env)).resolves.toMatchObject({ ok: false, reason: "needs-gesture" });
    await expect(requestVideoElementPip(null, env)).resolves.toMatchObject({ ok: false, reason: "no-video" });
  });
});

describe("setVideoAutoPip / exitAnyCallPip", () => {
  it("sets autoPictureInPicture only where supported", () => {
    expect(setVideoAutoPip({ autoPictureInPicture: false }, true)).toBe(true);
    expect(setVideoAutoPip({}, true)).toBe(false);
    expect(setVideoAutoPip(null, true)).toBe(false);
  });

  it("closes both kinds of PiP and ignores errors", async () => {
    const { env, dpip } = makeEnv({ documentPip: true, videoPip: true });
    const pipWin = makePipWindow();
    dpip.window = pipWin;
    env.document.pictureInPictureElement = {};
    env.document.exitPictureInPicture = vi.fn(async () => {
      throw new Error("x");
    });
    await expect(exitAnyCallPip(env)).resolves.toBeUndefined();
    expect(pipWin.close).toHaveBeenCalled();
    expect(env.document.exitPictureInPicture).toHaveBeenCalled();
  });
});

describe("own PiP styles", () => {
  it("keep the hidden attribute stronger than component display rules", async () => {
    const pipWin = makePipWindow();
    const { env, dpip } = makeEnv({ documentPip: true, requestWindow: vi.fn(async () => pipWin) });
    dpip.window = pipWin;
    await openOwnCallPip({ env, getMedia: () => ({ remote: { source: { attach() {}, detach() {} }, name: "А" } }) });
    const css = pipWin.document.querySelector("style").textContent;
    expect(css).toContain("[hidden]{display:none!important}");
    expect(pipWin.document.querySelector('[data-role="avatar"]').hidden).toBe(true);
  });
});
