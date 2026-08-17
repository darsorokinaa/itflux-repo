/**
 * HTTP-посещаемость видеоурока.
 *
 * Join — только после достоверного videoConferenceJoined с id участника Jitsi.
 * Iframe load, API init, participants>=1 и timeout-recover — не join.
 * Leave идемпотентен; при закрытии вкладки — sendBeacon.
 *
 * Один tracker на meetingUuid, чтобы Dock и страница звонка не гонялись
 * leave/join при переносе звонка между вкладками.
 */

import {
  recordVideoMeetingJoin,
  recordVideoMeetingLeave,
} from "../utils/cabinetAuth";

export const ATTENDANCE_DELAYED_LEAVE_MS = 2500;

const trackers = new Map();

export function readCsrfToken(cookie = "") {
  const raw = cookie || (typeof document !== "undefined" ? document.cookie : "");
  const match = String(raw || "").match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function isVerifiedJitsiConferenceJoin(event) {
  if (!event || typeof event !== "object") return false;
  if (event.mode === "iframe") return false;
  const id = String(event.id || event.participantId || "").trim();
  return Boolean(id);
}

export function buildAttendanceLeaveRequest(meetingUuid, {
  jitsiParticipantId = "",
  csrfToken = "",
} = {}) {
  const url = `/api/video-meetings/${meetingUuid}/attendance/leave/`;
  const form = new FormData();
  if (csrfToken) form.append("csrfmiddlewaretoken", csrfToken);
  if (jitsiParticipantId) form.append("jitsiParticipantId", jitsiParticipantId);
  return { url, body: form };
}

export function createMeetingAttendanceTracker({
  meetingUuid,
  recordJoin = recordVideoMeetingJoin,
  recordLeave = recordVideoMeetingLeave,
  sendBeacon = (url, body) => {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      return navigator.sendBeacon(url, body);
    }
    return false;
  },
  delayedLeaveMs = ATTENDANCE_DELAYED_LEAVE_MS,
} = {}) {
  let participantId = "";
  let joinRecorded = false;
  let leaveTimer = null;
  let leaveSent = false;
  let joinInFlight = null;

  const clearLeaveTimer = () => {
    if (leaveTimer) {
      window.clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  };

  const sendLeaveNow = () => {
    if (!meetingUuid || !joinRecorded || leaveSent) return false;
    leaveSent = true;
    clearLeaveTimer();
    const payload = { jitsiParticipantId: participantId || "" };
    const { url, body } = buildAttendanceLeaveRequest(meetingUuid, {
      jitsiParticipantId: participantId,
      csrfToken: readCsrfToken(),
    });
    try {
      if (sendBeacon(url, body)) return true;
    } catch {
      /* fallback below */
    }
    void recordLeave(meetingUuid, payload).catch(() => {});
    return true;
  };

  const postLeave = (immediate) => {
    if (!meetingUuid || !joinRecorded || leaveSent) return;
    if (immediate) {
      sendLeaveNow();
      return;
    }
    if (leaveTimer) return;
    leaveTimer = window.setTimeout(() => {
      leaveTimer = null;
      sendLeaveNow();
    }, delayedLeaveMs);
  };

  return {
    meetingUuid,
    hasJoined: () => joinRecorded,
    getParticipantId: () => participantId,
    cancelPendingLeave() {
      clearLeaveTimer();
    },
    async onVerifiedJoin(event) {
      if (!meetingUuid) return { recorded: false, reason: "no-meeting" };
      if (!isVerifiedJitsiConferenceJoin(event)) {
        return { recorded: false, reason: "unverified" };
      }
      const id = String(event.id || event.participantId || "").trim();
      participantId = id;
      clearLeaveTimer();
      leaveSent = false;
      if (joinInFlight) {
        try {
          await joinInFlight;
        } catch {
          /* retry below if first failed */
        }
        if (joinRecorded) {
          return { recorded: true, jitsiParticipantId: id, reused: true };
        }
      }
      joinInFlight = Promise.resolve()
        .then(() => recordJoin(meetingUuid, { jitsiParticipantId: id }))
        .then(() => {
          joinRecorded = true;
        })
        .finally(() => {
          joinInFlight = null;
        });
      try {
        await joinInFlight;
      } catch {
        return { recorded: false, reason: "request-failed", jitsiParticipantId: id };
      }
      return { recorded: true, jitsiParticipantId: id };
    },
    onConferenceLeft() {
      postLeave(false);
    },
    onUnmount() {
      postLeave(false);
    },
    onPageHide() {
      postLeave(true);
    },
    leaveImmediate() {
      postLeave(true);
    },
  };
}

export function getMeetingAttendanceTracker(meetingUuid, options = {}) {
  if (!meetingUuid) {
    return createMeetingAttendanceTracker({ meetingUuid: "", ...options });
  }
  const existing = trackers.get(meetingUuid);
  if (existing && !options.fresh) return existing;
  const tracker = createMeetingAttendanceTracker({ meetingUuid, ...options });
  trackers.set(meetingUuid, tracker);
  return tracker;
}

/** Только для тестов. */
export function resetMeetingAttendanceTrackers() {
  trackers.clear();
}
