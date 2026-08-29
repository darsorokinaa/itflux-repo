import { describe, expect, it, vi } from "vitest";
import {
  STUDENT_HOME_ROUTE,
  createLeaveOnce,
  isIntentionalJitsiHangup,
  shouldIgnoreReconnect,
  shouldStudentLeaveOnJitsiHangup,
} from "./jitsiLeave";

describe("isIntentionalJitsiHangup", () => {
  const hangup = {
    eventName: "readyToClose",
    joinedOnce: true,
    visibilityState: "visible",
  };

  it("treats readyToClose after join as the Jitsi hangup button", () => {
    expect(isIntentionalJitsiHangup(hangup)).toBe(true);
  });

  it("does not redirect on videoConferenceLeft alone (iOS/PWA drop)", () => {
    expect(isIntentionalJitsiHangup({
      eventName: "videoConferenceLeft",
      joinedOnce: true,
      visibilityState: "visible",
    })).toBe(false);
  });

  it("does not treat network or conference failure as hangup", () => {
    expect(isIntentionalJitsiHangup({
      ...hangup,
      eventName: "connectionFailed",
    })).toBe(false);
    expect(isIntentionalJitsiHangup({
      ...hangup,
      eventName: "conferenceFailed",
    })).toBe(false);
  });

  it("still treats readyToClose as hangup if a reconnect toast already started", () => {
    expect(isIntentionalJitsiHangup({
      ...hangup,
      reconnecting: true,
    })).toBe(true);
  });

  it("ignores programmatic dispose hangup (remount / unmount)", () => {
    expect(isIntentionalJitsiHangup({
      ...hangup,
      programmaticDispose: true,
    })).toBe(false);
  });

  it("does not redirect on background or someone else leaving", () => {
    expect(isIntentionalJitsiHangup({
      ...hangup,
      visibilityState: "hidden",
    })).toBe(false);
    expect(isIntentionalJitsiHangup({
      eventName: "participantLeft",
      joinedOnce: true,
    })).toBe(false);
    expect(isIntentionalJitsiHangup({
      eventName: "visibilitychange",
      joinedOnce: true,
    })).toBe(false);
  });

  it("ignores readyToClose before the student actually joined", () => {
    expect(isIntentionalJitsiHangup({
      eventName: "readyToClose",
      joinedOnce: false,
    })).toBe(false);
  });
});

describe("createLeaveOnce", () => {
  it("runs cleanup/navigation only once when Jitsi emits left + readyToClose", () => {
    const fn = vi.fn();
    const once = createLeaveOnce(fn);
    expect(once({ source: "videoConferenceLeft" })).toBe(true);
    expect(once({ source: "readyToClose" })).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("student hangup redirects once when Jitsi emits both lifecycle events", () => {
    const navigate = vi.fn();
    const once = createLeaveOnce(() => {
      navigate(STUDENT_HOME_ROUTE, { replace: true });
    });
    const handle = (eventName) => {
      if (!shouldStudentLeaveOnJitsiHangup({
        canManage: false,
        eventName,
        joinedOnce: true,
        visibilityState: "visible",
      })) {
        return;
      }
      once();
    };
    handle("videoConferenceLeft");
    handle("readyToClose");
    handle("readyToClose");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/cabinet/student", { replace: true });
  });
});

describe("shouldStudentLeaveOnJitsiHangup", () => {
  const hangup = {
    eventName: "readyToClose",
    joinedOnce: true,
    visibilityState: "visible",
  };

  it("redirects student after Jitsi hangup", () => {
    expect(shouldStudentLeaveOnJitsiHangup({ ...hangup, canManage: false })).toBe(true);
  });

  it("keeps teacher in the room after Jitsi hangup", () => {
    expect(shouldStudentLeaveOnJitsiHangup({ ...hangup, canManage: true })).toBe(false);
  });

  it("does not redirect on network drop, PWA background, or videoConferenceLeft", () => {
    expect(shouldStudentLeaveOnJitsiHangup({
      canManage: false,
      eventName: "connectionFailed",
      joinedOnce: true,
    })).toBe(false);
    expect(shouldStudentLeaveOnJitsiHangup({
      canManage: false,
      eventName: "visibilitychange",
      joinedOnce: true,
    })).toBe(false);
    expect(shouldStudentLeaveOnJitsiHangup({
      canManage: false,
      eventName: "videoConferenceLeft",
      joinedOnce: true,
      visibilityState: "visible",
    })).toBe(false);
  });
});

describe("student home", () => {
  it("is a same-origin cabinet dashboard path", () => {
    expect(STUDENT_HOME_ROUTE).toBe("/cabinet/student");
    expect(STUDENT_HOME_ROUTE.startsWith("/")).toBe(true);
    expect(STUDENT_HOME_ROUTE).not.toContain("lesson.");
  });

  it("blocks reconnect after manual hangup", () => {
    expect(shouldIgnoreReconnect(true)).toBe(true);
    expect(shouldIgnoreReconnect(false)).toBe(false);
  });
});
