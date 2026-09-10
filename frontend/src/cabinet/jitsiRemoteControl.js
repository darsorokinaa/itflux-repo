/**
 * Jitsi screen-share remote control — capability, state machine, official SDK hook.
 *
 * Native mouse/keyboard are executed only by @jitsi/electron-sdk in Electron.
 * This module never synthesizes DOM clicks, pointer coordinates, or a second WS.
 */

export const RC_STATES = Object.freeze({
  IDLE: "idle",
  REQUESTED: "requested",
  DENIED: "denied",
  ACTIVE: "active",
  STOPPING: "stopping",
});

export const RC_ENDPOINT_TYPE = "itflux.remote-control";

export function detectRemoteControlCapability(win = typeof window !== "undefined" ? window : undefined) {
  const supported = win?.itfluxDesktop?.remoteControlSupported === true;
  return {
    platform: supported ? "desktop" : "web",
    remoteControlSupported: supported,
    screenShareSupported: true,
  };
}

export function emptyRemoteControlSnapshot() {
  return {
    status: RC_STATES.IDLE,
    screenSharerId: "",
    remoteControllerId: "",
    sessionId: "",
    reason: "init",
  };
}

function newSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * One screen sharer + at most one remote controller.
 * Remote control cannot exist without screen sharing.
 */
export function createRemoteControlMachine() {
  let snap = emptyRemoteControlSnapshot();
  const listeners = new Set();

  const emit = () => {
    const copy = { ...snap };
    listeners.forEach((fn) => {
      try {
        fn(copy);
      } catch {
        /* ignore */
      }
    });
    return copy;
  };

  const set = (patch, reason) => {
    snap = {
      ...snap,
      ...patch,
      reason: reason || snap.reason,
    };
    return emit();
  };

  return {
    snapshot: () => ({ ...snap }),
    subscribe(fn) {
      listeners.add(fn);
      fn({ ...snap });
      return () => listeners.delete(fn);
    },
    shareStarted(sharerId, reason = "share_started") {
      const id = String(sharerId || "").trim();
      if (snap.screenSharerId && snap.screenSharerId !== id && snap.status !== RC_STATES.IDLE) {
        return set({
          status: RC_STATES.IDLE,
          screenSharerId: id,
          remoteControllerId: "",
          sessionId: "",
        }, "sharer_changed");
      }
      return set({
        screenSharerId: id,
        status: snap.status === RC_STATES.DENIED ? RC_STATES.IDLE : snap.status,
        ...(snap.status === RC_STATES.DENIED ? { remoteControllerId: "", sessionId: "" } : {}),
      }, reason);
    },
    shareStopped(reason = "share_stopped") {
      return set({
        status: RC_STATES.IDLE,
        screenSharerId: "",
        remoteControllerId: "",
        sessionId: "",
      }, reason);
    },
    request(controllerId, reason = "request_sent") {
      if (!snap.screenSharerId) {
        return set({ status: RC_STATES.IDLE, remoteControllerId: "", sessionId: "" }, "no_share");
      }
      if (snap.status === RC_STATES.ACTIVE) {
        return emit();
      }
      const controller = String(controllerId || "").trim();
      if (!controller) return emit();
      if (controller === snap.screenSharerId) return emit();
      return set({
        status: RC_STATES.REQUESTED,
        remoteControllerId: controller,
        sessionId: snap.sessionId || newSessionId(),
      }, reason);
    },
    invite(controllerId, reason = "invite_sent") {
      return this.request(controllerId, reason);
    },
    approve(reason = "approved") {
      if (snap.status !== RC_STATES.REQUESTED && snap.status !== RC_STATES.ACTIVE) {
        return emit();
      }
      if (!snap.screenSharerId || !snap.remoteControllerId) {
        return set({
          status: RC_STATES.IDLE,
          remoteControllerId: "",
          sessionId: "",
        }, "invalid_approve");
      }
      return set({ status: RC_STATES.ACTIVE }, reason);
    },
    deny(reason = "denied") {
      return set({
        status: RC_STATES.DENIED,
        remoteControllerId: "",
        sessionId: "",
      }, reason);
    },
    beginStop(reason = "stop_requested") {
      if (snap.status === RC_STATES.IDLE) return emit();
      return set({ status: RC_STATES.STOPPING }, reason);
    },
    stopped(reason = "stopped") {
      return set({
        status: RC_STATES.IDLE,
        remoteControllerId: "",
        sessionId: "",
      }, reason);
    },
    participantLeft(participantId, reason = "participant_left") {
      const id = String(participantId || "").trim();
      if (!id) return emit();
      if (id === snap.screenSharerId) {
        return this.shareStopped("sharer_left");
      }
      if (id === snap.remoteControllerId) {
        return set({
          status: RC_STATES.IDLE,
          remoteControllerId: "",
          sessionId: "",
        }, reason);
      }
      return emit();
    },
    markActiveFromJitsi(controllerId, reason = "jitsi_active") {
      const controller = String(controllerId || "").trim();
      if (!snap.screenSharerId || !controller) return emit();
      return set({
        status: RC_STATES.ACTIVE,
        remoteControllerId: controller,
        sessionId: snap.sessionId || newSessionId(),
      }, reason);
    },
  };
}

export function parseRemoteControlEndpointText(raw) {
  const text = typeof raw === "string" ? raw : raw?.text || raw?.data || "";
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.type !== RC_ENDPOINT_TYPE) return null;
    const action = String(parsed.action || "").trim();
    if (!action) return null;
    return {
      type: RC_ENDPOINT_TYPE,
      action,
      sessionId: String(parsed.sessionId || "").trim(),
      fromId: String(parsed.fromId || "").trim(),
      toId: String(parsed.toId || "").trim(),
    };
  } catch {
    return null;
  }
}

export function serializeRemoteControlEndpoint({ action, sessionId, fromId, toId }) {
  return JSON.stringify({
    type: RC_ENDPOINT_TYPE,
    action,
    sessionId: sessionId || "",
    fromId: fromId || "",
    toId: toId || "",
  });
}

export function attachOfficialRemoteControl(api, setupRemoteControlRender, win = typeof window !== "undefined" ? window : undefined) {
  if (!api) return { supported: false, dispose() {} };
  if (detectRemoteControlCapability(win).remoteControlSupported !== true) {
    return { supported: false, dispose() {} };
  }
  if (typeof setupRemoteControlRender !== "function") {
    return { supported: false, dispose() {} };
  }
  const handle = setupRemoteControlRender(api);
  return {
    supported: true,
    dispose() {
      handle?.dispose?.();
    },
  };
}

function listen(api, eventName, handler, bucket) {
  if (!api || typeof api.addListener !== "function") return;
  try {
    api.addListener(eventName, handler);
    bucket.push([eventName, handler]);
  } catch {
    /* event may be missing */
  }
}

export function sendJitsiEndpointText(api, participantId, text) {
  if (!api || !participantId || !text) return false;
  try {
    api.executeCommand?.("sendEndpointTextMessage", participantId, text);
    return true;
  } catch {
    return false;
  }
}

export function postRemoteControlToJitsiIframe(api, payload) {
  try {
    const iframe = api?.getIFrame?.();
    const target = iframe?.contentWindow;
    if (!target) return false;
    let origin = "*";
    try {
      origin = new URL(iframe.src).origin || "*";
    } catch {
      origin = "*";
    }
    target.postMessage({
      source: "itflux",
      type: "itflux:remote-control",
      ...payload,
    }, origin);
    return true;
  } catch {
    return false;
  }
}

export function requestJitsiRemoteControl(api, participantId) {
  if (!api || !participantId) return false;
  try {
    api.executeCommand?.("request-remote-control", participantId);
    return true;
  } catch {
    return false;
  }
}

export function stopJitsiRemoteControl(api) {
  if (!api) return false;
  try {
    api.executeCommand?.("stop-remote-control");
    return true;
  } catch {
    return false;
  }
}

/**
 * Wires conference lifecycle to the state machine. Does not inject input.
 */
export function bindRemoteControlToJitsi(api, machine, { localId = "", getLocalId = null, onEndpoint } = {}) {
  const listeners = [];
  if (!api || !machine) {
    return () => {};
  }
  const resolveLocalId = () => String(getLocalId?.() || localId || "").trim();

  listen(api, "screenSharingStatusChanged", (event) => {
    if (event?.on) {
      machine.shareStarted(resolveLocalId() || machine.snapshot().screenSharerId, "local_share");
    } else if (machine.snapshot().screenSharerId === resolveLocalId()) {
      stopJitsiRemoteControl(api);
      machine.shareStopped("local_share_ended");
    }
  }, listeners);

  listen(api, "contentSharingParticipantsChanged", (event) => {
    const ids = Array.isArray(event)
      ? event
      : (event?.sharingParticipantIds || event?.data || []);
    const first = String(ids[0] || "").trim();
    if (!first) {
      stopJitsiRemoteControl(api);
      machine.shareStopped("no_sharer");
      return;
    }
    machine.shareStarted(first, "content_sharing");
  }, listeners);

  listen(api, "participantLeft", (event) => {
    machine.participantLeft(event?.id);
  }, listeners);

  listen(api, "videoConferenceLeft", () => {
    stopJitsiRemoteControl(api);
    machine.shareStopped("conference_left");
  }, listeners);

  listen(api, "endpointTextMessageReceived", (event) => {
    const parsed = parseRemoteControlEndpointText(event?.data || event?.eventData || event);
    if (!parsed) return;
    onEndpoint?.(parsed, event);
  }, listeners);

  listen(api, "participantPropertyChanged", (event) => {
    const key = String(event?.property || event?.key || "");
    if (key !== "remoteControlSessionStatus") return;
    const value = event?.newValue ?? event?.value;
    const id = String(event?.id || event?.participantId || "").trim();
    if (value === true || value === "true" || value === "active") {
      machine.markActiveFromJitsi(id || machine.snapshot().remoteControllerId, "participant_property");
    } else if (value === false || value === "false" || value === "idle") {
      if (machine.snapshot().status === RC_STATES.ACTIVE) {
        machine.stopped("participant_property");
      }
    }
  }, listeners);

  return () => {
    listeners.forEach(([name, handler]) => {
      try {
        api.removeListener?.(name, handler);
      } catch {
        /* ignore */
      }
    });
    listeners.length = 0;
  };
}
