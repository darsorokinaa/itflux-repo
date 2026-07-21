/** Согласование одной Jitsi-сессии между вкладкой урока и вкладкой материала. */

import { MEETING_CALL_CHANNEL, postMeetingCallMessage } from "./meetingPresent";

function storageKey(meetingUuid) {
  return `itflux-call-owner:${meetingUuid}`;
}

export function getMeetingCallOwner(meetingUuid) {
  if (!meetingUuid) return "";
  try {
    return localStorage.getItem(storageKey(meetingUuid)) || "";
  } catch {
    return "";
  }
}

export function claimMeetingCall(meetingUuid, ownerId) {
  if (!meetingUuid || !ownerId) return;
  try {
    localStorage.setItem(storageKey(meetingUuid), ownerId);
  } catch {
    /* ignore */
  }
  postMeetingCallMessage({ type: "claim", meetingUuid, ownerId });
}

export function releaseMeetingCall(meetingUuid, ownerId) {
  if (!meetingUuid) return;
  try {
    if (!ownerId || localStorage.getItem(storageKey(meetingUuid)) === ownerId) {
      localStorage.removeItem(storageKey(meetingUuid));
    }
  } catch {
    /* ignore */
  }
  postMeetingCallMessage({ type: "release", meetingUuid, ownerId });
}

export function subscribeMeetingCall(handler) {
  let channel = null;
  try {
    channel = new BroadcastChannel(MEETING_CALL_CHANNEL);
    channel.addEventListener("message", (event) => {
      if (event?.data) handler(event.data);
    });
  } catch {
    /* ignore */
  }
  const onStorage = (event) => {
    if (!event.key || !event.key.startsWith("itflux-call-owner:")) return;
    const meetingUuid = event.key.slice("itflux-call-owner:".length);
    handler({
      type: event.newValue ? "claim" : "release",
      meetingUuid,
      ownerId: event.newValue || "",
    });
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    if (channel) {
      try {
        channel.close();
      } catch {
        /* ignore */
      }
    }
  };
}
