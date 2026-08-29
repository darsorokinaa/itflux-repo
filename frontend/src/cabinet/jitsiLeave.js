/**
 * Jitsi hangup vs disconnect.
 *
 * readyToClose — пользователь нажал стандартный hangup (красная кнопка).
 * videoConferenceLeft приходит и при hangup, и при обрыве / iOS background.
 * connectionFailed / conferenceFailed / visibility / programmatic dispose — не hangup.
 */

export const STUDENT_HOME_ROUTE = "/cabinet/student";

export function isIntentionalJitsiHangup({
  eventName = "",
  joinedOnce = false,
  programmaticDispose = false,
  visibilityState = "visible",
} = {}) {
  if (programmaticDispose) return false;
  if (eventName === "connectionFailed" || eventName === "conferenceFailed") {
    return false;
  }
  if (eventName === "participantLeft") return false;
  if (eventName === "visibilitychange" || eventName === "pagehide") return false;
  if (eventName === "videoConferenceLeft") return false;
  if (!joinedOnce) return false;
  if (visibilityState === "hidden") return false;
  return eventName === "readyToClose";
}

export function shouldStudentLeaveOnJitsiHangup({
  canManage = false,
  ...rest
} = {}) {
  if (canManage) return false;
  return isIntentionalJitsiHangup(rest);
}

export function createLeaveOnce(handler) {
  let leaving = false;
  return (...args) => {
    if (leaving) return false;
    leaving = true;
    handler(...args);
    return true;
  };
}

export function shouldIgnoreReconnect(intentionalLeave) {
  return Boolean(intentionalLeave);
}
