import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_AUTO_RECOVERY_FAILURES,
  countJitsiIframes,
  logLifecycle,
  resetRuntimeResourceState,
  resourcesGrew,
  shouldAutoResume,
  shouldRemountBoardWorkspace,
  shouldRemountJitsi,
  snapshotRuntimeResources,
  startMainThreadWatchdog,
  trackRealtimeSocket,
} from "./runtimeResources";

describe("shouldRemountJitsi / board", () => {
  it("does not remount a healthy call just because the shell is iOS PWA", () => {
    expect(shouldRemountJitsi({
      hasLiveApi: true,
      iframeConnected: true,
      iosStandalone: true,
      unknownDuration: true,
      backgroundDurationMs: 30_000,
    })).toBe(false);
    expect(shouldRemountBoardWorkspace({
      frameConnected: true,
      iosStandalone: true,
    })).toBe(false);
  });

  it("remounts only when the live instance is gone", () => {
    expect(shouldRemountJitsi({ hasLiveApi: false, iframeConnected: false })).toBe(true);
    expect(shouldRemountJitsi({ hasLiveApi: true, iframeConnected: false })).toBe(true);
    expect(shouldRemountBoardWorkspace({ frameConnected: false })).toBe(true);
  });

  it("opens the circuit after 3 automatic failures", () => {
    expect(shouldRemountJitsi({
      hasLiveApi: false,
      consecutiveFailures: MAX_AUTO_RECOVERY_FAILURES,
    })).toBe(false);
    expect(shouldAutoResume({ consecutiveFailures: 3, reason: "visibility" })).toBe(false);
    expect(shouldAutoResume({ consecutiveFailures: 3, reason: "manual" })).toBe(true);
  });
});

describe("background/foreground resource bound", () => {
  afterEach(() => {
    resetRuntimeResourceState();
  });

  it("20 healthy resume cycles do not grow Jitsi, sockets, or iframes", () => {
    const doc = document.implementation.createHTMLDocument("room");
    const jitsi = doc.createElement("iframe");
    jitsi.src = "https://lesson.example.test/room";
    jitsi.setAttribute("name", "jitsiConferenceFrame0");
    doc.body.appendChild(jitsi);
    const board = doc.createElement("iframe");
    board.className = "video-lesson-workspace__frame video-lesson-workspace__frame--board";
    doc.body.appendChild(board);
    const ws = { readyState: 1 };
    trackRealtimeSocket(ws);

    const before = snapshotRuntimeResources({ doc });
    let jitsiCreates = 1;
    let boardRemounts = 1;
    let wsCreates = 1;

    for (let i = 0; i < 20; i += 1) {
      if (shouldRemountJitsi({ hasLiveApi: true, iframeConnected: true })) {
        jitsiCreates += 1;
      }
      if (shouldRemountBoardWorkspace({ frameConnected: true })) {
        boardRemounts += 1;
      }
    }

    const after = snapshotRuntimeResources({ doc });
    expect(jitsiCreates).toBe(1);
    expect(boardRemounts).toBe(1);
    expect(wsCreates).toBe(1);
    expect(countJitsiIframes(doc)).toBe(1);
    expect(resourcesGrew(before, after)).toBe(false);
    expect(after.jitsiIframes).toBe(before.jitsiIframes);
    expect(after.webSockets).toBe(before.webSockets);
    expect(after.iframes).toBe(before.iframes);
  });

  it("sequence numbers increase and stall detector fires on a delayed tick", () => {
    vi.useFakeTimers();
    let now = 1_000;
    const stalls = [];
    const stop = startMainThreadWatchdog({
      intervalMs: 1000,
      stallMs: 2000,
      now: () => now,
      onStall: (info) => stalls.push(info),
    });
    now += 1000;
    vi.advanceTimersByTime(1000);
    expect(stalls).toHaveLength(0);
    now += 8000;
    vi.advanceTimersByTime(1000);
    expect(stalls.length).toBeGreaterThan(0);
    expect(stalls[0].delayMs).toBeGreaterThanOrEqual(3000);
    stop();
    vi.useRealTimers();
    const a = logLifecycle("PWA_BACKGROUND");
    const b = logLifecycle("PWA_FOREGROUND");
    expect(b.seq).toBe(a.seq + 1);
  });
});
