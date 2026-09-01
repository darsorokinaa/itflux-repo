import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RESUME_STATES,
  RESUME_TIMING,
  classifyResumeUi,
  createPwaResumeController,
  isResumeMessage,
  nextResumeAttemptId,
  probeAuthSession,
  reloadSameOriginRoom,
  shouldVerifyAfterBackground,
} from "./pwaResumeLifecycle";

describe("shouldVerifyAfterBackground", () => {
  it("skips a brief hide", () => {
    expect(shouldVerifyAfterBackground(400, "visibility")).toBe(false);
    expect(shouldVerifyAfterBackground(RESUME_TIMING.MIN_BACKGROUND_MS - 1, "pageshow")).toBe(false);
  });

  it("verifies after a meaningful hide, unknown duration, online, or manual", () => {
    expect(shouldVerifyAfterBackground(RESUME_TIMING.MIN_BACKGROUND_MS, "visibility")).toBe(true);
    expect(shouldVerifyAfterBackground(30_000, "pageshow")).toBe(true);
    expect(shouldVerifyAfterBackground(null, "pageshow")).toBe(true);
    expect(shouldVerifyAfterBackground(200, "online")).toBe(true);
    expect(shouldVerifyAfterBackground(200, "manual")).toBe(true);
  });
});

describe("classifyResumeUi", () => {
  it("keeps a silent health check hidden until reconnect is confirmed", () => {
    expect(classifyResumeUi(RESUME_STATES.RESUMING, 0).phase).toBe("hidden");
    expect(classifyResumeUi(RESUME_STATES.RESUMING, 1_000).phase).toBe("hidden");
    expect(classifyResumeUi(RESUME_STATES.RESUMING, RESUME_TIMING.SLOW_MS).phase).toBe("slow");
  });

  it("does not flash reconnecting for a brief socket blip", () => {
    expect(classifyResumeUi(RESUME_STATES.RECONNECTING, 500).phase).toBe("hidden");
    expect(classifyResumeUi(RESUME_STATES.DEGRADED, 0).phase).toBe("hidden");
  });

  it("shows reconnecting, then slow, then failed", () => {
    expect(classifyResumeUi(RESUME_STATES.RECONNECTING, RESUME_TIMING.SHOW_MS).phase).toBe("reconnecting");
    expect(classifyResumeUi(RESUME_STATES.RECONNECTING, RESUME_TIMING.SLOW_MS).phase).toBe("slow");
    expect(classifyResumeUi(RESUME_STATES.RECONNECTING, RESUME_TIMING.SLOW_MS).showReconnect).toBe(true);
    expect(classifyResumeUi(RESUME_STATES.DEGRADED, RESUME_TIMING.SLOW_MS).phase).toBe("slow");
    expect(classifyResumeUi(RESUME_STATES.FAILED, 0).phase).toBe("failed");
    expect(classifyResumeUi(RESUME_STATES.FAILED, 0).showReload).toBe(true);
    expect(classifyResumeUi(RESUME_STATES.ACTIVE, 0).phase).toBe("hidden");
  });

  it("does not hide the banner while offline during resume", () => {
    const ui = classifyResumeUi(RESUME_STATES.RECONNECTING, 500, false);
    expect(ui.offline).toBe(true);
    expect(ui.phase).toBe("reconnecting");
    expect(ui.showReconnect).toBe(false);
  });
});

describe("probeAuthSession", () => {
  it("treats 401 as expired without calling it a generic network error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(probeAuthSession({ fetchImpl })).resolves.toEqual({
      ok: false,
      code: "auth_expired",
    });
  });

  it("returns ok on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await expect(probeAuthSession({ fetchImpl })).resolves.toEqual({ ok: true });
  });
});

describe("reloadSameOriginRoom", () => {
  it("reloads the same-origin parent when embedded", () => {
    const parentReload = vi.fn();
    const selfReload = vi.fn();
    const win = {
      location: { origin: "https://app.test", reload: selfReload },
      top: { location: { origin: "https://app.test", reload: parentReload } },
    };
    win.top !== win;
    expect(reloadSameOriginRoom({ win })).toBe("parent");
    expect(parentReload).toHaveBeenCalledTimes(1);
    expect(selfReload).not.toHaveBeenCalled();
  });

  it("reloads self when it is the top window", () => {
    const selfReload = vi.fn();
    const win = {
      location: { origin: "https://app.test", reload: selfReload },
    };
    win.top = win;
    expect(reloadSameOriginRoom({ win })).toBe("self");
    expect(selfReload).toHaveBeenCalledTimes(1);
  });
});

describe("createPwaResumeController", () => {
  let nowValue;
  let reportEvent;

  beforeEach(() => {
    nowValue = 1_000_000;
    reportEvent = vi.fn();
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }),
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function make(onResume) {
    return createPwaResumeController({
      now: () => nowValue,
      onResume,
      reportEvent,
      getContext: () => ({ meetingId: "meet-1", role: "teacher" }),
    });
  }

  it("does not start recovery on a brief hide", () => {
    const onResume = vi.fn();
    const ctl = make(onResume);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    nowValue += 400;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onResume).not.toHaveBeenCalled();
    ctl.detach();
  });

  it("starts one resume after a meaningful background", async () => {
    const onResume = vi.fn();
    const ctl = make(onResume);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    nowValue += RESUME_TIMING.MIN_BACKGROUND_MS + 10;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(ctl.isInProgress()).toBe(true);
    expect(ctl.getState()).toBe(RESUME_STATES.RESUMING);
    expect(reportEvent).toHaveBeenCalledWith("PWA_BACKGROUND", expect.any(Object));
    expect(reportEvent).toHaveBeenCalledWith("RESUME_START", expect.any(Object));
    ctl.detach();
  });

  it("moves to FAILED after the resume timeout", () => {
    const states = [];
    const ctl = createPwaResumeController({
      now: () => nowValue,
      reportEvent,
      onResume: () => new Promise(() => {}),
      onStateChange: (state) => states.push(state),
      getContext: () => ({ meetingId: "m" }),
    });
    ctl.considerResume("manual");
    vi.advanceTimersByTime(RESUME_TIMING.SLOW_MS);
    expect(states).toContain(RESUME_STATES.DEGRADED);
    vi.advanceTimersByTime(RESUME_TIMING.FAIL_MS - RESUME_TIMING.SLOW_MS);
    expect(states).toContain(RESUME_STATES.FAILED);
    expect(reportEvent).toHaveBeenCalledWith("RESUME_TIMEOUT", expect.any(Object));
    ctl.detach();
  });

  it("manual reconnect starts a single new attempt", () => {
    const onResume = vi.fn();
    const ctl = make(onResume);
    ctl.considerResume("manual");
    const firstId = ctl.getAttemptId();
    ctl.manualReconnect();
    expect(onResume).toHaveBeenCalledTimes(2);
    expect(ctl.getAttemptId()).not.toBe(firstId);
    expect(reportEvent).toHaveBeenCalledWith("MANUAL_RECONNECT_CLICK", expect.any(Object));
    ctl.detach();
  });

  it("stops automatic resume after 3 failed attempts until manual", () => {
    const onResume = vi.fn(() => new Promise(() => {}));
    const ctl = make(onResume);
    ctl.considerResume("manual");
    ctl.fail("timeout");
    ctl.considerResume("visibility");
    ctl.fail("timeout");
    ctl.considerResume("pageshow");
    ctl.fail("timeout");
    expect(onResume).toHaveBeenCalledTimes(3);
    ctl.considerResume("visibility");
    ctl.considerResume("pageshow");
    ctl.considerResume("focus");
    expect(onResume).toHaveBeenCalledTimes(3);
    expect(ctl.getState()).toBe(RESUME_STATES.FAILED);
    ctl.manualReconnect();
    expect(onResume).toHaveBeenCalledTimes(4);
    ctl.detach();
  });

  it("pageshow without a recorded hide does not start a false recovery", () => {
    const onResume = vi.fn();
    const ctl = make(onResume);
    window.dispatchEvent(new Event("pageshow"));
    expect(onResume).not.toHaveBeenCalled();
    ctl.detach();
  });

  it("healthy resume stays silent and does not claim the connection is lost", () => {
    let ctl;
    const states = [];
    ctl = createPwaResumeController({
      now: () => nowValue,
      reportEvent,
      onResume: () => {
        ctl.succeed();
      },
      onStateChange: (state) => states.push(state),
      getContext: () => ({ meetingId: "m" }),
    });
    ctl.considerResume("manual");
    expect(states).toContain(RESUME_STATES.RESUMING);
    expect(states).not.toContain(RESUME_STATES.RECONNECTING);
    expect(ctl.getState()).toBe(RESUME_STATES.ACTIVE);
    expect(classifyResumeUi(RESUME_STATES.RESUMING, 0).phase).toBe("hidden");
    ctl.detach();
  });

  it("markReconnecting is required before the lost-connection banner", () => {
    const ctl = make(() => {});
    ctl.considerResume("manual");
    expect(ctl.getState()).toBe(RESUME_STATES.RESUMING);
    expect(classifyResumeUi(ctl.getState(), 0).phase).toBe("hidden");
    ctl.markReconnecting();
    expect(ctl.getState()).toBe(RESUME_STATES.RECONNECTING);
    expect(classifyResumeUi(ctl.getState(), RESUME_TIMING.SHOW_MS).phase).toBe("reconnecting");
    ctl.detach();
  });

  it("succeed clears elapsed so a later offline blip is not 'taking longer'", () => {
    const extras = [];
    const ctl = createPwaResumeController({
      now: () => nowValue,
      reportEvent,
      onResume: () => {},
      onStateChange: (state, extra) => extras.push({ state, elapsedMs: extra?.elapsedMs }),
      getContext: () => ({ meetingId: "m" }),
    });
    ctl.considerResume("manual");
    nowValue += 30_000;
    ctl.succeed();
    ctl.markDegraded("offline");
    const last = extras[extras.length - 1];
    expect(last.state).toBe(RESUME_STATES.DEGRADED);
    expect(last.elapsedMs).toBe(0);
    expect(classifyResumeUi(last.state, last.elapsedMs).phase).toBe("hidden");
    ctl.detach();
  });

  it("bfcache pageshow still verifies", () => {
    const onResume = vi.fn();
    const ctl = make(onResume);
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    window.dispatchEvent(event);
    expect(onResume).toHaveBeenCalledTimes(1);
    ctl.detach();
  });
});

describe("helpers", () => {
  it("builds unique attempt ids", () => {
    expect(nextResumeAttemptId()).not.toBe(nextResumeAttemptId());
  });

  it("recognizes the board resume postMessage", () => {
    expect(isResumeMessage({ type: "ITFLUX_PWA_RESUME" })).toBe(true);
    expect(isResumeMessage({ type: "other" })).toBe(false);
  });
});
