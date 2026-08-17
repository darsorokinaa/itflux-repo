import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATTENDANCE_DELAYED_LEAVE_MS,
  buildAttendanceLeaveRequest,
  createMeetingAttendanceTracker,
  getMeetingAttendanceTracker,
  isVerifiedJitsiConferenceJoin,
  readCsrfToken,
  resetMeetingAttendanceTrackers,
} from "./meetingAttendance";

describe("isVerifiedJitsiConferenceJoin", () => {
  it("rejects iframe load, empty event and missing participant id", () => {
    expect(isVerifiedJitsiConferenceJoin(null)).toBe(false);
    expect(isVerifiedJitsiConferenceJoin({})).toBe(false);
    expect(isVerifiedJitsiConferenceJoin({ mode: "iframe", id: "abc" })).toBe(false);
    expect(isVerifiedJitsiConferenceJoin({ roomName: "r" })).toBe(false);
    expect(isVerifiedJitsiConferenceJoin({ id: "" })).toBe(false);
  });

  it("accepts videoConferenceJoined payload with Jitsi participant id", () => {
    expect(isVerifiedJitsiConferenceJoin({ id: "local-abc" })).toBe(true);
    expect(isVerifiedJitsiConferenceJoin({ participantId: "p-1", roomName: "room" })).toBe(true);
  });
});

describe("createMeetingAttendanceTracker", () => {
  let recordJoin;
  let recordLeave;
  let sendBeacon;

  beforeEach(() => {
    resetMeetingAttendanceTrackers();
    vi.useFakeTimers();
    recordJoin = vi.fn().mockResolvedValue({ id: 1 });
    recordLeave = vi.fn().mockResolvedValue({ ok: true });
    sendBeacon = vi.fn().mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetMeetingAttendanceTrackers();
  });

  function makeTracker() {
    return createMeetingAttendanceTracker({
      meetingUuid: "meet-1",
      recordJoin,
      recordLeave,
      sendBeacon,
    });
  }

  it("does not record join when iframe appeared without videoConferenceJoined", async () => {
    const t = makeTracker();
    const result = await t.onVerifiedJoin({ mode: "iframe", roomName: "r" });
    expect(result.recorded).toBe(false);
    expect(recordJoin).not.toHaveBeenCalled();
    expect(t.hasJoined()).toBe(false);
  });

  it("does not treat participants>=1 as presence of a second user", async () => {
    const t = makeTracker();
    const result = await t.onVerifiedJoin({ count: 1, participants: 1 });
    expect(result.recorded).toBe(false);
    expect(recordJoin).not.toHaveBeenCalled();
  });

  it("records join after videoConferenceJoined with participant id", async () => {
    const t = makeTracker();
    const result = await t.onVerifiedJoin({ id: "jitsi-local-1", roomName: "room" });
    expect(result.recorded).toBe(true);
    expect(result.jitsiParticipantId).toBe("jitsi-local-1");
    expect(recordJoin).toHaveBeenCalledTimes(1);
    expect(recordJoin).toHaveBeenCalledWith("meet-1", { jitsiParticipantId: "jitsi-local-1" });
  });

  it("does not treat missing jitsi participant id as a successful join", async () => {
    const t = makeTracker();
    await t.onVerifiedJoin({ roomName: "room", mode: "external-api" });
    expect(recordJoin).not.toHaveBeenCalled();
  });

  it("repeat videoConferenceJoined does not create a second in-flight join storm", async () => {
    let resolveJoin;
    recordJoin.mockReturnValue(new Promise((resolve) => {
      resolveJoin = resolve;
    }));
    const t = makeTracker();
    const first = t.onVerifiedJoin({ id: "p1" });
    const second = t.onVerifiedJoin({ id: "p1" });
    resolveJoin({ id: 1 });
    const a = await first;
    const b = await second;
    expect(a.recorded).toBe(true);
    expect(b.recorded).toBe(true);
    expect(recordJoin).toHaveBeenCalledTimes(1);
  });

  it("second join after the first completed is idempotent at the tracker (backend reuses session)", async () => {
    const t = makeTracker();
    await t.onVerifiedJoin({ id: "p1" });
    await t.onVerifiedJoin({ id: "p1" });
    expect(recordJoin).toHaveBeenCalledTimes(2);
    expect(recordJoin.mock.calls.every((call) => call[1].jitsiParticipantId === "p1")).toBe(true);
  });

  it("Jitsi leave schedules attendance close", async () => {
    const t = makeTracker();
    await t.onVerifiedJoin({ id: "p1" });
    t.onConferenceLeft();
    expect(sendBeacon).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ATTENDANCE_DELAYED_LEAVE_MS);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(String(sendBeacon.mock.calls[0][0])).toContain("/attendance/leave/");
  });

  it("tab close / pagehide sends leave immediately via beacon", async () => {
    const t = makeTracker();
    await t.onVerifiedJoin({ id: "p1" });
    t.onPageHide();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    t.onPageHide();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("refresh: delayed leave is cancelled when join returns", async () => {
    const t = makeTracker();
    await t.onVerifiedJoin({ id: "p1" });
    t.onUnmount();
    await t.onVerifiedJoin({ id: "p1" });
    await vi.advanceTimersByTimeAsync(ATTENDANCE_DELAYED_LEAVE_MS + 50);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(recordLeave).not.toHaveBeenCalled();
    expect(recordJoin).toHaveBeenCalledTimes(2);
  });

  it("reconnect after leave still records join without requiring a new tracker", async () => {
    const t = makeTracker();
    await t.onVerifiedJoin({ id: "p1" });
    t.leaveImmediate();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    await t.onVerifiedJoin({ id: "p1" });
    expect(recordJoin).toHaveBeenCalledTimes(2);
    t.leaveImmediate();
    expect(sendBeacon).toHaveBeenCalledTimes(2);
  });

  it("teacher and student trackers are independent", async () => {
    const teacherJoin = vi.fn().mockResolvedValue({ id: 1 });
    const studentJoin = vi.fn().mockResolvedValue({ id: 2 });
    const teacher = createMeetingAttendanceTracker({
      meetingUuid: "meet-1",
      recordJoin: teacherJoin,
      recordLeave,
      sendBeacon,
    });
    const student = createMeetingAttendanceTracker({
      meetingUuid: "meet-1",
      recordJoin: studentJoin,
      recordLeave,
      sendBeacon,
    });
    await teacher.onVerifiedJoin({ id: "teacher-jitsi" });
    await student.onVerifiedJoin({ id: "student-jitsi" });
    expect(teacherJoin).toHaveBeenCalledWith("meet-1", { jitsiParticipantId: "teacher-jitsi" });
    expect(studentJoin).toHaveBeenCalledWith("meet-1", { jitsiParticipantId: "student-jitsi" });
    expect(teacher.getParticipantId()).toBe("teacher-jitsi");
    expect(student.getParticipantId()).toBe("student-jitsi");
  });

  it("shared tracker: dock delayed leave is cancelled by meeting-page join", async () => {
    const shared = getMeetingAttendanceTracker("meet-shared", {
      recordJoin,
      recordLeave,
      sendBeacon,
    });
    await shared.onVerifiedJoin({ id: "p1" });
    shared.onUnmount();
    const same = getMeetingAttendanceTracker("meet-shared");
    expect(same).toBe(shared);
    await same.onVerifiedJoin({ id: "p1" });
    await vi.advanceTimersByTimeAsync(ATTENDANCE_DELAYED_LEAVE_MS + 20);
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("reads csrf and builds leave beacon body", () => {
    expect(readCsrfToken("foo=1; csrftoken=abc%2Fde; other=2")).toBe("abc/de");
    const req = buildAttendanceLeaveRequest("u1", {
      jitsiParticipantId: "p9",
      csrfToken: "tok",
    });
    expect(req.url).toBe("/api/video-meetings/u1/attendance/leave/");
    expect(req.body).toBeInstanceOf(FormData);
    expect(req.body.get("csrfmiddlewaretoken")).toBe("tok");
    expect(req.body.get("jitsiParticipantId")).toBe("p9");
  });
});
